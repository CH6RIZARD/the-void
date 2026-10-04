// ─── NATION LIVE — that nation, nothing else ─────────────────────────────
// This used to fall back to the GLOBAL news channels whenever the proxy was absent
// (always, in production): tapping Morocco played Iranian state TV and Bloomberg.
// Chain now: Supabase places for the region -> the nation's own cameras / raw
// footage / life -> its verified IPTV -> its own news channels -> proxy. No global
// tail. A nation with nothing live hides the section instead of borrowing a feed.
import { env } from '../env.ts';
import type { Country, RegionView, StreamSource } from '../types.ts';
import { C, resolveRegion } from '../data/regions.ts';
import { CAM_SOURCES, NEWS_SOURCES, RAW_FOOTAGE, iptvFor, lifeFor } from '../data/sources.ts';
import { streamKey, usedStreamKeys } from './keys.ts';
import { ensureHealth, healthDead, healthFlaky, healthMsBucket } from './health.ts';

/** name -> sources that actually CONNECTED in that nation's live section (feeds rankNation). */
export const _nationLive: Record<string, StreamSource[]> = {};
/** Call when the nation hero reaches PLAYING. */
export function noteNationLive(name: string, src: StreamSource): void { (_nationLive[name] = _nationLive[name] || []).push(src); }

export function nationCode(c: Pick<Country, 'n' | 'iso'>): string { return ((resolveRegion(c.n) || {} as any).code) || (c.iso && c.iso !== '??' ? c.iso : ''); }

// Supabase region_view(target_code) -> {region, places, topics, posts}. One RPC feeds
// both the live section (places) and the feed (posts). Bounded at 4s so a paused
// project degrades to the direct sources instead of stalling the panel.
const _regionViewCache: Record<string, Promise<RegionView | null>> = {};
export function nationRegionView(c: Pick<Country, 'n' | 'iso'>): Promise<RegionView | null> {
  const code = nationCode(c);
  if (!code || !env.supabaseUrl) return Promise.resolve(null);
  if (Object.prototype.hasOwnProperty.call(_regionViewCache, code)) return _regionViewCache[code];
  const run = (async () => {
    const AC: any = (globalThis as any).AbortController;
    const ctl = AC ? new AC() : null, t = setTimeout(() => { try { ctl && ctl.abort(); } catch { /* */ } }, 4000);
    try {
      const r = await env.fetch(env.supabaseUrl + '/rest/v1/rpc/region_view', {
        method: 'POST', signal: ctl ? ctl.signal : undefined,
        headers: { 'apikey': env.supabaseAnonKey, 'Authorization': 'Bearer ' + env.supabaseAnonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_code: code, limit_n: 60 }),
      });
      return r.ok ? await r.json() : null;
    } catch { return null; } finally { clearTimeout(t); }
  })();
  _regionViewCache[code] = run;
  run.then(v => { if (!v) delete _regionViewCache[code]; });   // failures are retried next open
  return run;
}

export function placeToSource(pl: any): StreamSource | null {
  if (!pl || !pl.stream_url) return null;
  const type = pl.kind === 'embed' ? 'iframe' : pl.kind;
  if (type === 'youtube') {
    const id = (String(pl.stream_url).match(/(?:v=|youtu\.be\/|embed\/|live\/)([\w-]{11})/) || [])[1];
    return id ? { type: 'youtube', id, vid: id, label: pl.name } : null;
  }
  return ['hls', 'mjpeg', 'iframe'].includes(type) ? { type, url: pl.stream_url, label: pl.name } : null;
}

// Live video from the proxy's reviewed catalogue only (official embeds or
// operator-authorised direct streams; never relayed through our CDN).
export async function pullLiveStreams(country: string): Promise<StreamSource[]> {
  if (!env.proxyBase) return [];
  try {
    const used = usedStreamKeys();
    const exclude = [...used].filter(key => key.startsWith('youtube:')).map(key => key.slice('youtube:'.length)).join(',');
    const r = await env.fetch(`${env.proxyBase}/streams?country=${encodeURIComponent(country)}&query=${encodeURIComponent(country + ' live news')}&limit=12&exclude=${encodeURIComponent(exclude)}`);
    if (!r.ok) return [];
    const payload = await r.json();
    const cascade = payload.cascades || {};
    const ordered = [
      ...(cascade.reviewed || []).map((s: any) => ({ ...s, _tier: 'REVIEWED SOURCE' })),
      ...(cascade.youtubeLive || []).map((s: any) => ({ ...s, _tier: 'LIVE NOW' })),
      ...(cascade.youtubeRecent || []).map((s: any) => ({ ...s, _tier: 'RECENT VIDEO' })),
    ];
    const result = (payload.items?.length ? payload.items : ordered);
    return result.filter((s: any) => s && ((Array.isArray(s.cascade) || Array.isArray(s.sources)) || ['youtube', 'hls', 'mjpeg', 'iframe'].includes(s.type)));
  } catch { return []; }
}

const normLabel = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Reliability before speed, the wall's own ordering (wall.ts): known-dead
 *  streams are dropped, proven-flaky sink behind everything, and inside each
 *  tier the population's median connect ms rules - so the hero stops burning
 *  5.5-7s serial connect timeouts on leads the whole world already knows are
 *  dead. The health map is empty until ensureHealth's fetch lands (and always
 *  in tests), and an empty map is exactly the old order. */
function rankTier(list: StreamSource[]): StreamSource[] {
  return list
    .filter(s => !healthDead(s))
    .map((s, i) => [s, healthFlaky(s) ? 1 : 0, healthMsBucket(s), i] as const)
    .sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[3] - b[3])
    .map(x => x[0]);
}

// User-set mix for a nation: 3 city-life streams in every 10, the other 7 news /
// live TV. News leads, so the hero opens on the nation's live picture; life is
// spread evenly. Whichever pool runs out, the other fills. Portal iframes go last.
function nationOwnCascade(name: string): StreamSource[] {
  const lifeAll = [...(CAM_SOURCES[name] || []), ...(RAW_FOOTAGE[name] || []), ...lifeFor(name)];
  const life = rankTier(lifeAll.filter(x => x.type !== 'iframe')), frames = lifeAll.filter(x => x.type === 'iframe');
  const news = rankTier([...iptvFor(name), ...(NEWS_SOURCES[name] || [])]);
  const own: StreamSource[] = [];
  const NATION_LIFE_SLOTS = new Set([2, 5, 8]);                // positions 3, 6, 9 of every 10
  for (let i = 0; life.length || news.length; i++) {
    const wantLife = NATION_LIFE_SLOTS.has(i % 10);
    const pick = (wantLife ? life : news).length ? (wantLife ? life : news) : (wantLife ? news : life);
    own.push(pick.shift()!);
  }
  own.push(...frames);
  return own;
}

// Dedupe by stream key AND by label: the IPTV pool lists some channels under
// several mirror URLs, which put the same broadcast on screen twice.
function nationDedupe(name: string, srcs: Array<StreamSource | null>): StreamSource[] {
  const seen = new Set<string>(), seenLbl = new Set<string>(), out: StreamSource[] = [];
  for (const src of srcs) {
    if (!src) continue;
    const k = src.type ? streamKey(src) : JSON.stringify(src).slice(0, 160);
    const l = normLabel(src.label);
    if (seen.has(k) || (l && seenLbl.has(l))) continue;
    if (src.type && nationSourceForeign(src, name)) continue;   // another nation's stream, or a global channel
    seen.add(k); if (l) seenLbl.add(l); out.push(src);
  }
  return out;
}

/**
 * The bundled tiers, SYNCHRONOUSLY. The hero's first connect attempt used to
 * wait on Promise.all([regionView up to 4s, a /streams call the proxy does not
 * even route - a guaranteed 404]) before it could try anything; this is the
 * same cascade with zero awaits, so the first attempt starts at open.
 * Reviewed regionView sources merge in when they land (useNationHero).
 */
export function nationBundledSources(c: Pick<Country, 'n' | 'iso'>): StreamSource[] {
  ensureHealth();   // fire-and-forget; empty map = exactly the old behavior
  return nationDedupe(c.n, nationOwnCascade(c.n));
}

/**
 * The nation's own ordered stream cascade. `deps` lets tests / callers inject the
 * two network tiers. The default proxy tier is empty: GET /streams does not exist
 * on the proxy (see server.js's route table), and awaiting its 404 was part of
 * what blocked every nation open.
 */
export async function nationStreamSources(c: Pick<Country, 'n' | 'iso'>, deps?: {
  regionView?: (c: Pick<Country, 'n' | 'iso'>) => Promise<RegionView | null>;
  proxy?: (name: string) => Promise<StreamSource[]>;
}): Promise<StreamSource[]> {
  const name = c.n;
  const [rv, proxy] = await Promise.all([(deps?.regionView || nationRegionView)(c), (deps?.proxy || (async () => [] as StreamSource[]))(name)]);
  const reviewed = ((rv && rv.places) || []).map(placeToSource).filter(Boolean) as StreamSource[];
  ensureHealth();
  return nationDedupe(name, [...reviewed, ...nationOwnCascade(name), ...(proxy || [])]);
}

// Uniqueness guard. A stream is ONE nation's: a key or label another nation's own
// pool claims first is dropped, and a global channel only ever stands in for its
// home nation (DW -> Germany, NHK World -> Japan) — so a proxy / Supabase place /
// pool mistake can never put Al Jazeera on Morocco.
// Claim order: curated (CAM / RAW / NEWS), then life, then IPTV; ties go to C order.
export const NATION_GLOBAL_BRANDS: Array<[RegExp, string]> = [[/al ?jazeera/i, 'Qatar'], [/\bdw\b|deutsche welle/i, 'Germany'], [/france ?24/i, 'France'],
  [/\bbbc\b/i, 'United Kingdom'], [/bloomberg/i, 'United States'], [/aaj tak/i, 'India'], [/\bcnn\b/i, 'United States'],
  [/euronews/i, ''], [/\bsky news\b(?! arabia)/i, 'United Kingdom'], [/nhk world/i, 'Japan'], [/\bcgtn\b/i, 'China'],
  [/trt world/i, 'Turkey'], [/\bwion\b/i, 'India'], [/africanews/i, ''], [/pluto ?tv/i, '']];
let _nationOwners: { keys: Map<string, string>; labels: Map<string, string> } | null = null;
export function nationStreamOwners() {
  if (_nationOwners) return _nationOwners;
  const keys = new Map<string, string>(), labels = new Map<string, string>();
  const names = [...new Set([...C.map(x => x.n), ...Object.keys(CAM_SOURCES), ...Object.keys(RAW_FOOTAGE), ...Object.keys(NEWS_SOURCES)])];
  const claim = (n: string, list: StreamSource[]) => {
    for (const s of list || []) {
      if (!s || !s.type) continue;
      const k = streamKey(s), l = normLabel(s.label);
      if (!keys.has(k)) keys.set(k, n); if (l && !labels.has(l)) labels.set(l, n);
    }
  };
  for (const n of names) claim(n, [...(CAM_SOURCES[n] || []), ...(RAW_FOOTAGE[n] || []), ...(NEWS_SOURCES[n] || [])]);
  for (const n of names) claim(n, lifeFor(n));
  for (const n of names) claim(n, iptvFor(n));
  return (_nationOwners = { keys, labels });
}
export function nationSourceForeign(src: StreamSource, name: string): boolean {
  const label = String(src.label || '');
  for (const [re, home] of NATION_GLOBAL_BRANDS) if (re.test(label)) return home !== name;
  const o = nationStreamOwners();
  const kOwner = o.keys.get(streamKey(src));
  if (kOwner && kOwner !== name) return true;
  const l = normLabel(label);
  const lOwner = l && o.labels.get(l);
  return !!(lOwner && lOwner !== name);
}

/** A recorded walk is never labelled LIVE. */
export function nationSrcIsLive(src: StreamSource | null | undefined, c: Pick<Country, 'n'>): boolean {
  if (!src) return false;
  if (src.type !== 'youtube') return true;                     // hls / mjpeg / iframe cams are live feeds
  if (src.kind === 'livecam' || (CAM_SOURCES[c.n] || []).includes(src)) return true;
  return String(src.id || '').length !== 11 || /\blive\b/i.test(src.label || '');  // channel live_stream, or a live video
}
export function nationHeroKind(src: StreamSource, c: Pick<Country, 'n'>): 'CITY CAM' | 'WALKING TOUR' | 'DAY IN THE LIFE' | 'LIVE TV' {
  const l = String(src.label || '');
  if (src.kind === 'livecam' || (CAM_SOURCES[c.n] || []).includes(src) || /\bcam/i.test(l)) return 'CITY CAM';
  if (src.kind === 'walk' || /walk|tour|stroll/i.test(l)) return 'WALKING TOUR';
  if (src.kind === 'life' || /day in the life|vlog/i.test(l)) return 'DAY IN THE LIFE';
  return 'LIVE TV';
}
/** Hero caption/badge model (web nationHeroMeta without the DOM). */
export function nationHeroMeta(src: StreamSource | null, c: Pick<Country, 'n'>) {
  if (!src) return { caption: '', kind: '', badge: null as null | { text: string; vod: boolean } };
  const live = nationSrcIsLive(src, c);
  return { caption: src.label || c.n, kind: nationHeroKind(src, c), badge: { text: live ? '◉ LIVE' : '▷ NOW', vod: !live } };
}
