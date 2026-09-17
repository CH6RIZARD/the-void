// Stream identity, liveness, dead-stream memory and single-mount claims.
import { env } from '../env.ts';
import type { StreamSource } from '../types.ts';
import { VOID_LIVE } from '../data/sources.ts';

// Connect budgets per type. youtube was 24000: a DIRECT /embed/<vid> of a genuinely
// live video reaches PLAYING in well under 3s, and live_stream?channel= on a channel
// not broadcasting can only time out (8/12 dead on 2026-08-02, 24s each). 4s aborted
// mid-handshake on mobile radios. Cap stays under the 10s product budget.
export const CONNECT_TIMEOUT: Record<string, number> = { hls: 8000, mjpeg: 6000, youtube: 9000, iframe: 7000 };
export const connectTimeoutFor = (s: StreamSource) => CONNECT_TIMEOUT[s.type] || 8000;

// Hosts whose iframe embeds actually render (X-Frame friendly). Any other iframe
// source fails fast so a blocked frame is NEVER shown.
export const EMBEDDABLE_IFRAME = /(windy\.com|viewsurf\.com|worldcams\.tv|worldcam\.eu|world-livecam\.com|worldlivecamera\.com|seoul\.go\.kr|khh\.travel|ali-nsa\.net|tw\.live|koryo\.tv|worldviewstream\.com)/i;
// An allowed HOST is not enough: a portal PAGE "loads" too. Only a player-embed
// URL may occupy a tile; page URLs fail in 0ms.
export const IFRAME_PLAYER_URL = /(\/embed(\/|\?|$)|[?&]embed=|\/player(\/|\?|$)|\/iframe(\/|\?|$))/i;
export function iframeAllowed(s: StreamSource): boolean { const u = String(s.url || ''); return EMBEDDABLE_IFRAME.test(u) && IFRAME_PLAYER_URL.test(u); }

// yt-error 100/101/150/153 = removed / embedding disabled: permanent. The YouTube
// onError path marks those bad so a dead VOD costs one attempt.
export const YT_DEAD_CODES = new Set([100, 101, 150, 153]);

export function streamKey(source: StreamSource): string { return source.type === 'youtube' ? `youtube:${source.id}` : `${source.type}:${source.url || ''}`; }

// ─── DEAD-SIGNAL MEMORY ─────────────────────────────────────────────────
// Keys found dead (bars / slate / removed VOD) are refused for the rest of the
// session — heal rotates past them.
export const _badStreams = new Set<string>();
export function markBadStream(src: StreamSource | null | undefined): void { const k = src && streamKey(src); if (k) _badStreams.add(k); }
export function isBadStream(src: StreamSource | null | undefined): boolean { const k = src && streamKey(src); return !!(k && _badStreams.has(k)); }

// ─── SESSION VARIETY ────────────────────────────────────────────────────
export const USED_STREAMS_KEY = 'void_used_stream_sources_v1';
export function usedStreamKeys(): Set<string> { try { return new Set(JSON.parse(env.session.getItem(USED_STREAMS_KEY) || '[]')); } catch { return new Set(); } }
/** Call when a stream actually PLAYED, so the next wall build sinks it. Keeps the last 250. */
export function rememberStream(source: StreamSource): void {
  const used = usedStreamKeys(); used.add(streamKey(source));
  try { env.session.setItem(USED_STREAMS_KEY, JSON.stringify([...used].slice(-250))); } catch { /* */ }
}

// One stream, one place on screen: reserved for whichever tile mounts it first,
// released on failure/teardown, so no two tiles anywhere hold the same stream.
// NOTE (web parity): attemptSource() in void2-final.html currently has its
// claimLiveKey call commented out on the isBadStream line; the claim API is kept.
export const _liveClaimed = new Set<string>();
export function claimLiveKey(source: StreamSource): boolean {
  const k = streamKey(source);
  if (!k) return true;
  if (_liveClaimed.has(k)) return false;
  _liveClaimed.add(k); return true;
}
export function releaseLiveKey(source: StreamSource): void { const k = streamKey(source); if (k) _liveClaimed.delete(k); }

// Only CURRENTLY LIVE content is mounted. VOID_LIVE is resolved ahead of time
// (scripts/resolve-live.js); a channel that is not live has no videoId and can
// ONLY time out — refused in 0ms instead of holding a connection lane.
export const _liveById: Record<string, string> = (() => { const m: Record<string, string> = {}; try { (VOID_LIVE.items || []).forEach(x => { if (x.vid) m[x.id] = x.vid; }); } catch { /* */ } return m; })();
/** undefined => not confirmed live (refuse); null => a video/playlist (not a channel); string => the live video id. */
export function liveVidFor(source: StreamSource | null | undefined): string | null | undefined {
  if (!source || source.type !== 'youtube') return undefined;   // non-YT handled elsewhere
  if (source.vid) return source.vid;                            // explicit id wins
  const id = source.id || '';
  if (/^(PL|UU|OLAK)/.test(id) || id.length === 11) return null; // playlist/video: not a channel
  return Object.prototype.hasOwnProperty.call(_liveById, id) ? _liveById[id] : undefined;
}

/** Pre-attempt refusal exactly as attemptSource() applies it (0ms fail). */
export function refuseBeforeAttempt(source: StreamSource): 'not-live' | 'bad' | 'iframe-blocked' | '' {
  if (source && source.type === 'youtube' && liveVidFor(source) === undefined) return 'not-live';
  if (isBadStream(source)) return 'bad';
  if (source && source.type === 'iframe' && !iframeAllowed(source)) return 'iframe-blocked';
  return '';
}

/**
 * The URL a player should load for a source. YouTube tiles carry no chrome
 * (controls=0 etc.): walking tours embedded without it showed title bar, pause
 * glyph and logo over the picture.
 */
export const YT_CLEAN = '&autoplay=1&mute=1&playsinline=1&rel=0&controls=0&disablekb=1&fs=0&iv_load_policy=3&modestbranding=1&cc_load_policy=0';
export function playerUrl(source: StreamSource, origin = ''): string {
  if (source.type !== 'youtube') return String(source.url || '');
  const id = source.id || '';
  const o = encodeURIComponent(origin);
  let base: string;
  if (/^(PL|UU|OLAK)/.test(id)) base = 'https://www.youtube.com/embed/videoseries?list=' + id + YT_CLEAN;
  else if (id.length === 11) base = 'https://www.youtube.com/embed/' + id + '?' + YT_CLEAN.slice(1);
  else {
    const v = liveVidFor(source);
    const common = `autoplay=1&mute=1&controls=0&rel=0&playsinline=1&iv_load_policy=3&fs=0&disablekb=1&enablejsapi=1&origin=${o}`;
    base = v ? `https://www.youtube.com/embed/${v}?${common}` : `https://www.youtube.com/embed/live_stream?channel=${id}&${common}`;
  }
  return base + (/enablejsapi/.test(base) ? '' : '&enablejsapi=1&origin=' + o);
}

export function sourceTier(source: StreamSource): string {
  if (source._tier === 'LIVE NOW' || source.fallback === 'youtube-live') return 'LIVE NOW';
  if (source._tier === 'RECENT VIDEO' || source.fallback === 'youtube-recent') return 'RECENT VIDEO';
  return source.category === 'news' ? 'OFFICIAL LIVE' : 'REVIEWED SOURCE';
}
/** Expand an item into its playable cascade (item.cascade | item.sources | [item]). */
export function streamCascade(item: StreamSource): StreamSource[] {
  const raw = Array.isArray(item?.cascade) ? item.cascade : (Array.isArray(item?.sources) ? item.sources : [item]);
  return raw.filter(s => s && ['youtube', 'hls', 'mjpeg', 'iframe'].includes(s.type)).map(s => ({ ...item, ...s, poster: s.poster || s.thumbnail || item.poster || item.thumbnail || item.posterUrl || '' }));
}
