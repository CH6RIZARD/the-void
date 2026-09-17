// ─── GLOBE WORLD-WALL — slot order + per-tile cascades ──────────────────
// The wall used to be fully deterministic (same streams every launch). Rank still
// decides the TIER a country sits in, but order is shuffled within each tier and
// sources within each country; streams already shown this session sink to the back.
import { env } from '../env.ts';
import type { StreamSource, WallSlot } from '../types.ts';
import { C } from '../data/regions.ts';
import { CAM_SOURCES, RAW_FOOTAGE, iptvFor, lifeFor, rankOf } from '../data/sources.ts';
import { EMBEDDABLE_IFRAME, IFRAME_PLAYER_URL, _badStreams, isBadStream, streamKey, usedStreamKeys } from './keys.ts';

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
  const shuffle = shuffleInPlace;
  // Tier by rank (0-11, 12-23, ...) then shuffle inside the tier.
  const names = [...C].map(c => c.n);
  const tiers: Record<string, string[]> = {};
  names.forEach(n => { const t = Math.floor(rankOf(n) / 12); (tiers[t] = tiers[t] || []).push(n); });
  const ordered = Object.keys(tiers).sort((a, b) => (a as any) - (b as any)).flatMap(t => shuffle(tiers[t]));

  // TWO POOLS, FIXED MIX. Putting iptvFor(n) first in every country spent the first
  // ~800 slots on TV news and starved the walking tours (the point of the wall).
  //   life = CAM_SOURCES + RAW_FOOTAGE + lifeFor()   (shuffled per country)
  //   news = iptvFor()                               (shuffled per country)
  const used = usedStreamKeys(), taken = new Set<string>();
  const usable = (s: StreamSource) => {
    if (!s || isBadStream(s)) return false;             // bars/slate or removed/embed-disabled VOD
    const k = streamKey(s);
    if (!k || taken.has(k)) return false;
    taken.add(k); return true;
  };
  const per = ordered.map(n => {
    const life = lifeMix([...(CAM_SOURCES[n] || []), ...(RAW_FOOTAGE[n] || []), ...lifeFor(n)].filter(usable), shuffle);
    const news = shuffle(iptvFor(n).filter(usable));
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
    return hls.concat(rest).slice(0, 3);
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
  return lastResort ? lifeChain.slice(0, 2).concat(lastResort) : lifeChain.slice(0, 3);
}

/** On heal, try a different source first — the previous one just died (connectWallCell rotate). */
export function healChain(name: string, firstSrc: StreamSource | null | undefined): StreamSource[] {
  let chain = wallCascadeFor(name, firstSrc);
  if (firstSrc && chain.length > 1) {
    const k = streamKey(firstSrc);
    chain = chain.filter(s => streamKey(s) !== k).concat(chain.filter(s => streamKey(s) === k));
  }
  return chain;
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
