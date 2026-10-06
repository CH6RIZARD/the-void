// ─── GLOBE WORLD-WALL — slot order + per-tile cascades ──────────────────
// The wall used to be fully deterministic (same streams every launch). Rank still
// decides the TIER a country sits in, but order is shuffled within each tier and
// sources within each country; streams already shown this session sink to the back.
import { env } from '../env.ts';
import type { StreamSource, WallSlot } from '../types.ts';
import { C } from '../data/regions.ts';
import { CAM_SOURCES, RAW_FOOTAGE, iptvFor, lifeFor, rankOf } from '../data/sources.ts';
import { ensureHealth, healthDead, healthFlaky, healthMsBucket } from './health.ts';
import { EMBEDDABLE_IFRAME, IFRAME_PLAYER_URL, _badStreams, isBadStream, streamKey, usedStreamKeys } from './keys.ts';
// Pure, no imports of its own - the ladder widths it measures are the only
// live decode-cost signal there is, and this module is where cost decides order.
import { widthFor } from '../../features/live/hlsVariant.ts';

// ─── DECODE COST ─────────────────────────────────────────────────────────
// One VPU, eight tiles: what a stream COSTS to decode is as real a property as
// whether it connects. widthFor() is the ladder hlsVariant actually read this
// session; `w` is the sentinel's annotation (smallest advertised RESOLUTION
// width, written onto the pool by source-sentinel.mjs); 0 is unknown.
const decodeWidth = (s: StreamSource): number => widthFor(s.url) ?? (Number(s.w) || 0);
/** Sort bucket: known-cheap (<=480) first, unknown middle, known-expensive last. */
const wBucket = (s: StreamSource): number => { const w = decodeWidth(s); return w > 0 && w <= 480 ? 0 : !w ? 1 : 2; };

// SOFT CAP: AT MOST 2 CONCURRENT >480-WIDE WALL STREAMS. The VPU affords
// roughly 8x 426x240 OR 2x 1080p, so 6 cheap + 2 expensive stays inside the
// envelope. StreamTile reports each wall player's life (noteWallMount /
// noteWallUnmount, keyed by streamKey - one stream never plays in two places);
// at the cap, cascades and heals merely REORDER their chains cheap-first.
// Never a filter: a tile with only expensive candidates still places, because
// grid-fullness beats cheapness.
// 4 = half the wall's eight, the user's mix (2026-10-06: 'half higher res, half
// lower res'). Real decoded widths now count too (hlsVariant noteDecodedWidth), so
// the cap holds for single-rendition 720p/1080p streams that advertise no ladder.
export const WALL_EXPENSIVE_MAX = 4;
const expensiveLive = new Set<string>();
export function noteWallMount(src: StreamSource, playedUrl?: string | null): void {
  const w = (playedUrl ? widthFor(playedUrl) : undefined) ?? decodeWidth(src);
  if (w > 480) { const k = streamKey(src); if (k) expensiveLive.add(k); }
}
export function noteWallUnmount(src: StreamSource): void {
  const k = streamKey(src);
  if (k) expensiveLive.delete(k);
}
/** At the cap, stable-partition a chain so <=480/unknown candidates lead. */
function capExpensive(chain: StreamSource[]): StreamSource[] {
  if (expensiveLive.size < WALL_EXPENSIVE_MAX) return chain;
  const cheap = chain.filter(s => wBucket(s) < 2);
  return cheap.length === chain.length ? chain : cheap.concat(chain.filter(s => wBucket(s) === 2));
}

// User-set ratio: windows of 10 tiles, 3 city-life at positions 3, 6, 9 and 7 news /
// live TV, so life is spread through every screenful and each window opens on an HLS
// news tile for a fast first paint. Whichever pool runs out, the other fills. Do not
// drop life to zero or put IPTV first-only again — the ratio lives here.
export const WALL_MIX = { life: 3, news: 7, lifeSlots: [2, 5, 8] };
export const WALL_BATCH = 12;          // boxes added per scroll batch
export const WALL_HEAL_MAX = 2;        // concurrent heals
export const WALL_HEAL_COOLDOWN = 12000;
/** Parallel connect lanes (mobile 8 / desktop 10) and max cascade depth per tile. */
export const WALL_LANES = { mobile: 8, desktop: 10 };
export const WALL_CASCADE_MAX = 3;

type Shuffle = <T>(a: T[]) => T[];
export const shuffleInPlace: Shuffle = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(env.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Life pool order: youtube/hls (shuffled) first; iframe webcams only if they pass the
// iframe gate, and always last — a portal page would only fail fast anyway.
export function lifeMix(list: StreamSource[], shuffle?: Shuffle | null): StreamSource[] {
  const main: StreamSource[] = [], ifr: StreamSource[] = [];
  for (const s of list) {
    if (s.type === 'iframe') { const u = s.url || ''; if (EMBEDDABLE_IFRAME.test(u) && IFRAME_PLAYER_URL.test(u)) ifr.push(s); }
    else main.push(s);
  }
  return (shuffle ? shuffle(main).concat(shuffle(ifr)) : main.concat(ifr));
}

/** The full, ordered world-wall slot list (one source per tile). */
export function wallSlots(): WallSlot[] {
  ensureHealth();   // fire-and-forget; empty map = exactly the old behavior
  const shuffle = shuffleInPlace;
  // TENSION IS A WEIGHT, NOT A GATE (web lifeMix). Rank tiers made the 28 tension
  // nations lead every session; a weighted random key (Efraimidis–Spirakis:
  // rand^(1/w)) keeps them ahead ~3x their share while every nation can open.
  const names = [...C].map(c => c.n);
  const weight = (n: string) => { const r = rankOf(n); return r < 12 ? 6 : r < 28 ? 3 : 1; };
  const ordered = names.map(n => ({ n, k: Math.pow(env.random(), 1 / weight(n)) }))
    .sort((a, b) => b.k - a.k).map(x => x.n);

  // TWO POOLS, FIXED MIX. Putting iptvFor(n) first in every country spent the first
  // ~800 slots on TV news and starved the walking tours (the point of the wall).
  //   life = CAM_SOURCES + RAW_FOOTAGE + lifeFor()   (shuffled per country)
  //   news = iptvFor()                               (shuffled per country)
  const used = usedStreamKeys(), taken = new Set<string>();
  const usable = (s: StreamSource) => {
    if (!s || isBadStream(s)) return false;             // bars/slate or removed/embed-disabled VOD
    if (healthDead(s)) return false;                    // dead for EVERYONE (server health map)
    const k = streamKey(s);
    if (!k || taken.has(k)) return false;
    taken.add(k); return true;
  };
  const per = ordered.map(n => {
    // NO YOUTUBE ON THE WALL - the web wall's rule, now native's too. A YouTube
    // tile is a full Chromium WebView wearing YouTube chrome: the user has
    // refused the look for weeks, and each one taxes the UI thread that the
    // sparkles, the globe and every gesture run on. YouTube stays available to
    // the nation cinema, which is its own surface with its own rules.
    const life = lifeMix([...(CAM_SOURCES[n] || []), ...(RAW_FOOTAGE[n] || []), ...lifeFor(n)].filter(s => s && s.type !== 'youtube' && usable(s)), shuffle);
    // Reliability before cost, cost before speed. A proven-flaky stream in the
    // lead is a cascade advance per tile per visit, whatever it costs to decode,
    // so flaky sinks behind EVERYTHING - the lead must be cheap AND reliable.
    // Then cheapest first: known <=480-wide streams lead (the ~16% of the pool
    // the sentinel annotated saturate 8 tiles many times over, and a tile
    // decoding 426x240 costs 10-20x fewer pixels/s than native 1080p), unknowns
    // in the middle, known-expensive last. Ordering only, never a filter -
    // every stream stays in the pool. Inside each bucket the POPULATION's
    // median connect ms (400ms buckets) still rules, the shuffle deciding
    // inside each, so the wall varies every visit.
    const news = shuffle(iptvFor(n).filter(usable))
      .map((s, i) => [s, healthFlaky(s) ? 1 : 0, wBucket(s), healthMsBucket(s), i] as const)
      .sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4])
      .map(x => x[0]);
    return { n, life, news };
  });
  // Round-robin each pool across countries (tiers preserved), then sink anything
  // already shown this session to the back of ITS pool (so the ratio survives).
  const robin = (pool: 'life' | 'news') => {
    const out: WallSlot[] = []; let more = true, i = 0;
    while (more) { more = false; for (const c of per) { const a = c[pool]; if (i < a.length) { out.push({ name: c.n, src: a[i], kind: pool }); more = true; } } i++; }
    const fresh: WallSlot[] = [], seen: WallSlot[] = [];
    for (const slot of out) { (used.has(streamKey(slot.src)) ? seen : fresh).push(slot); }
    return fresh.concat(seen);
  };
  const lifeQ = robin('life'), newsQ = robin('news');
  const out: WallSlot[] = []; let li = 0, ni = 0;
  const W = WALL_MIX.life + WALL_MIX.news;
  for (let pos = 0; li < lifeQ.length || ni < newsQ.length; pos++) {
    const wantLife = WALL_MIX.lifeSlots.includes(pos % W);
    if (wantLife ? li < lifeQ.length : ni >= newsQ.length) out.push(lifeQ[li++]);
    else out.push(newsQ[ni++]);
  }
  return out;
}

/**
 * SAME-KIND cascade (max 3) for one tile, so one dead URL does not strand it.
 * A news (IPTV) tile keeps the HLS-first chain. A life tile cascades to other
 * same-country life sources with at most ONE HLS as last resort, so a heal replaces
 * a walk with another walk, not TV news. Known-dead keys never spend a slot.
 */
export function wallCascadeFor(name: string, first?: StreamSource | null): StreamSource[] {
  const seen = new Set<string>();
  const hls: StreamSource[] = [], rest: StreamSource[] = [];
  const push = (s: StreamSource | null | undefined) => {
    if (!s) return;
    // The wall's YouTube ban applies to the CASCADE too. The slot pool was
    // filtered, but this fallback chain re-imported the cam/raw/life pools
    // wholesale - the measured "[fill] ... last youtube" on a wall whose slots
    // carried none was this line resurrecting them. And a stream the whole
    // population has measured dead never spends one of the three chain places.
    if (s.type === 'youtube' || healthDead(s)) return;
    const k = streamKey(s);
    if (!k || seen.has(k) || _badStreams.has(k)) return;
    seen.add(k);
    (s.type === 'hls' ? hls : rest).push(s);
  };
  let iptv: StreamSource[] = []; try { iptv = iptvFor(name) || []; } catch { /* */ }
  const firstIsNews = !!first && first.type === 'hls' && iptv.some(s => streamKey(s) === streamKey(first));
  if (!first || firstIsNews) {
    push(first);
    iptv.forEach(push);
    (CAM_SOURCES[name] || []).forEach(push);
    (RAW_FOOTAGE[name] || []).forEach(push);
    lifeFor(name).forEach(push);
    return capExpensive(hls.concat(rest).slice(0, 3));
  }
  // Life-first: push() still filters; hls/rest split is ignored for life items.
  push(first);
  const lifeChain: StreamSource[] = [];
  if (seen.size) lifeChain.push(first);
  const pool = lifeMix([...(CAM_SOURCES[name] || []), ...(RAW_FOOTAGE[name] || []), ...lifeFor(name)]);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(env.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  pool.sort((a, b) => ((a.type === 'iframe') as any) - ((b.type === 'iframe') as any));   // iframe cams stay last
  for (const s of pool) { const before = seen.size; push(s); if (seen.size > before) lifeChain.push(s); }
  let lastResort: StreamSource | null = null;
  for (const s of iptv) { const before = seen.size; push(s); if (seen.size > before) { lastResort = s; break; } }
  return capExpensive(lastResort ? lifeChain.slice(0, 2).concat(lastResort) : lifeChain.slice(0, 3));
}

/** On heal, try a different source first — the previous one just died (connectWallCell rotate). */
export function healChain(name: string, firstSrc: StreamSource | null | undefined): StreamSource[] {
  let chain = wallCascadeFor(name, firstSrc);
  if (firstSrc && chain.length > 1) {
    const k = streamKey(firstSrc);
    chain = chain.filter(s => streamKey(s) !== k).concat(chain.filter(s => streamKey(s) === k));
  }
  // At the expensive cap the cost ordering outranks even the rotation: with two
  // >480-wide streams already live, a cheap retry - including the one that just
  // died - beats mounting a third expensive decode.
  return capExpensive(chain);
}

/**
 * How many tiles to place up front: a screen-and-a-bit (mobile depth 1, cap 24;
 * desktop depth 3, cap 60). The sentinel pulls more as you scroll.
 */
export function wallFillCount(opts: { cols: number; gridWidth: number; viewportHeight: number; mobile: boolean }): number {
  const cols = Math.max(1, opts.cols);
  const tileH = ((opts.gridWidth || 360) / cols) * 9 / 16 + 6;
  const rows = Math.ceil((opts.viewportHeight * 1.25) / Math.max(60, tileH));
  const depth = opts.mobile ? 1 : 3;
  return Math.max(opts.mobile ? 12 : 24, Math.min(opts.mobile ? 24 : 60, cols * rows * depth));
}
