// Ported verbatim from void2-final.html (LIVE CONNECTION ENGINE / GLOBE WORLD-WALL).
import { streamKey, type StreamSource } from './core';

export const CONNECT_TIMEOUT: Record<string, number> = { hls: 8000, mjpeg: 6000, youtube: 9000, iframe: 7000 };

/** Hosts whose iframe embeds actually render (X-Frame friendly). */
export const EMBEDDABLE_IFRAME =
  /(windy\.com|viewsurf\.com|worldcams\.tv|worldcam\.eu|world-livecam\.com|worldlivecamera\.com|seoul\.go\.kr|khh\.travel|ali-nsa\.net|tw\.live|koryo\.tv|worldviewstream\.com)/i;
/** Only a player-embed URL may occupy a tile; portal pages fail in 0ms. */
export const IFRAME_PLAYER_URL = /(\/embed(\/|\?|$)|[?&]embed=|\/player(\/|\?|$)|\/iframe(\/|\?|$))/i;

/** yt-error 100/101/150/153 = removed / embedding disabled: permanent. */
export const YT_DEAD_CODES = new Set([100, 101, 150, 153]);

export const WALL_BATCH = 12;
export const WALL_HEAL_MAX = 2;
export const WALL_HEAL_COOLDOWN = 12000;
/**
 * Mobile connection lanes (web: IS_MOBILE ? 8 : 10). Native: 4. Each lane is a player
 * being created and buffering at once; eight at a time on a low-end phone starved the
 * globe's first frames and the UI thread. Playing tiles do not hold a lane.
 */
export const WALL_LANES = 4;
/** First wall batch waits this long after the build, so the globe paints first. */
export const FIRST_BATCH_DELAY_MS = 800;
/** Out of sight this long, the wall unmounts its players (see LiveWall SLEEP). */
export const SLEEP_AFTER_MS = 20000;
/** Watchdog period (web setInterval 2500). */
export const WATCHDOG_MS = 2500;
/** YouTube chrome veil hold (web ytVeil default). */
export const YT_VEIL_MS = 3200;
/** Shadow audio fallback (web 5000). */
export const YT_SHADOW_FALLBACK_MS = 5000;
/** YouTube bootstrap nudge (web 900ms) and shadow kick (web 600ms). */
export const YT_NUDGE_MS = 900;
export const YT_SHADOW_KICK_MS = 600;

/**
 * Origin the YouTube WebViews load under. YouTube needs a real https origin and a
 * Referer (CURSOR #1: without one it returns Error 153 and live_stream never
 * resolves). The HTML is loaded with this as baseUrl — nothing is fetched from it.
 */
export const YT_ORIGIN = 'https://thevoid.app';

/**
 * NATIVE-ONLY memory guard (no web equivalent — the web never unmounts a tile).
 * A phone cannot hold an unbounded number of WebViews/decoders. EVERY TILE IN VIEW
 * PLAYS; the guard only touches tiles that are off-screen.
 *
 * Tiles further than PARK_SCREENS viewport-heights from the visible window are PAUSED
 * (HLS pauses the player, YouTube gets pauseVideo — see StreamTile). Beyond
 * EVICT_SCREENS, once more than MAX_MOUNTED_WEBVIEWS YouTube/iframe players are
 * mounted, the FARTHEST are unmounted and reconnect when scrolled back.
 *
 * Measured on a Helio P35 (2026-09-20): at 3/5/18 the app held ~18 live decoders,
 * 200 MB of graphics memory and ran at 1–2 fps. One screen of parking keeps the
 * visible tiles (a 2-wide wall shows ~6) playing while everything else is idle.
 * MAX_MOUNTED_WEBVIEWS 8 -> 4 (2026-09-22): a parked WebView still keeps its renderer
 * process alive; only unmounting frees it.
 */
export const PARK_SCREENS = 1;
export const EVICT_SCREENS = 2;
export const MAX_MOUNTED_WEBVIEWS = 4;
/**
 * Players of ANY kind mounted at once (HLS decoders included). A 2-wide wall shows
 * about 6 tiles, so everything in view still plays; anything past one screen is let
 * go once the wall is at the cap. Pausing an off-screen HLS tile does NOT free its
 * decoder: with only the WebView cap the wall reached 933 MB on the test phone and
 * Android killed the app (2026-09-22).
 */
export const MAX_MOUNTED_PLAYERS = 6;

// ─── One stream, one place on screen (web claimLiveKey/releaseLiveKey) ───────
const liveClaimed = new Set<string>();
export function claimLiveKey(source: StreamSource): boolean {
  const k = streamKey(source);
  if (!k) return true;
  if (liveClaimed.has(k)) return false;
  liveClaimed.add(k);
  return true;
}
export function releaseLiveKey(source: StreamSource): void {
  const k = streamKey(source);
  if (k) liveClaimed.delete(k);
}

/** web liveUrl(): the channel/live-vid embed URL, exact param order. */
export function liveUrl(ch: string | { id: string; vid?: string | null }, mute = 1): string {
  const origin = encodeURIComponent(YT_ORIGIN);
  const obj = typeof ch === 'object' && ch ? ch : null;
  const channelId = obj ? obj.id : (ch as string);
  const vid = obj && obj.vid ? obj.vid : null;
  const common = `autoplay=1&mute=${mute}&controls=0&rel=0&playsinline=1&iv_load_policy=3&fs=0&disablekb=1&enablejsapi=1&origin=${origin}`;
  if (vid) return `https://www.youtube.com/embed/${vid}?${common}`;
  return `https://www.youtube.com/embed/live_stream?channel=${channelId}&${common}`;
}

const YT_CLEAN =
  '&autoplay=1&mute=1&playsinline=1&rel=0&controls=0&disablekb=1&fs=0&iv_load_policy=3&modestbranding=1&cc_load_policy=0';

/** attemptSource youtube branch: the exact embed src the web builds. */
export function youtubeEmbedSrc(source: StreamSource, vid: string | null | undefined): string {
  const id = source.id || '';
  const origin = encodeURIComponent(YT_ORIGIN);
  let base: string;
  if (/^(PL|UU|OLAK)/.test(id)) base = 'https://www.youtube.com/embed/videoseries?list=' + id + YT_CLEAN;
  else if (id.length === 11) base = 'https://www.youtube.com/embed/' + id + '?' + YT_CLEAN.slice(1);
  else base = liveUrl(vid ? { id, vid } : id);
  return base + (/enablejsapi/.test(base) ? '' : '&enablejsapi=1&origin=' + origin);
}

/** Instant refusals of attemptSource, before anything is mounted. */
export function iframeAllowed(source: StreamSource): boolean {
  const u = source.url || '';
  return EMBEDDABLE_IFRAME.test(u) && IFRAME_PLAYER_URL.test(u);
}
