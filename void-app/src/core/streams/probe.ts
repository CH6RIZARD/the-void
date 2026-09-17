// HLS preflight: fetch manifests in parallel the moment a cascade is known. A dead
// host, a 404, a CORS refusal or http-on-https fails HERE in parallel instead of
// costing a full 8s connect timeout each, one after another. A manifest that has
// not answered yet is still attempted — the preflight only ever SKIPS.
import { env } from '../env.ts';
import type { StreamSource } from '../types.ts';

export const HLS_PROBE_TIMEOUT = 6000;
/** How long the cascade waits on a pending probe before attempting anyway. */
export const HLS_PROBE_GRACE = 600;

/** true = served #EXTM3U in its first 256 chars; false = dead. Never throws. */
export async function probeHls(url: string, ms = HLS_PROBE_TIMEOUT): Promise<boolean> {
  const AC: any = (globalThis as any).AbortController;
  const ctl = AC ? new AC() : null;
  const t = setTimeout(() => { try { ctl && ctl.abort(); } catch { /* */ } }, ms);
  try {
    const r = await env.fetch(url, { signal: ctl ? ctl.signal : undefined, cache: 'no-store' });
    return r.ok ? (await r.text()).slice(0, 256).includes('#EXTM3U') : false;
  } catch { return false; } finally { clearTimeout(t); }
}

/** Memoised per-source preflight, as loadCountryLiveGrid used it. */
export function createPreflight() {
  const pre = new Map<StreamSource, Promise<boolean>>();
  const preflight = (src: StreamSource | null | undefined): Promise<boolean> | null => {
    if (!src || src.type !== 'hls' || !src.url) return null;
    if (!pre.has(src)) pre.set(src, probeHls(src.url));
    return pre.get(src)!;
  };
  /** Resolves 'skip' only when the probe already answered dead within the grace window. */
  const shouldSkip = async (src: StreamSource): Promise<boolean> => {
    const pf = preflight(src);
    if (!pf) return false;
    const v = await Promise.race([pf, new Promise<null>(r => setTimeout(() => r(null), HLS_PROBE_GRACE))]);
    return v === false;
  };
  return { preflight, shouldSkip };
}

/**
 * Walk a nation-hero cascade: warm the first 10 probes, then for each source warm
 * the next 4, skip known-dead HLS, and call `attempt` (the native player) until one
 * returns true. `cancelled()` lets a newer nation abort. Returns the winner or null.
 */
export async function runCascade(sources: StreamSource[], attempt: (s: StreamSource) => Promise<boolean>, cancelled: () => boolean = () => false, startAt = { i: 0 }, pf = createPreflight()): Promise<StreamSource | null> {
  // Pass the same `startAt` and `pf` on a mid-watch heal: the web's next() resumed
  // from the same index with the same probe cache.
  const { preflight, shouldSkip } = pf;
  sources.slice(0, 10).forEach(preflight);
  while (startAt.i < sources.length) {
    if (cancelled()) return null;
    const src = sources[startAt.i++];
    sources.slice(startAt.i, startAt.i + 4).forEach(preflight);
    if (await shouldSkip(src)) continue;
    if (cancelled()) return null;
    if (await attempt(src)) return src;
  }
  return null;
}
/** Hero retry backoff after a nation has nothing playing (attempts 0..2), and mid-watch recheck. */
export const HERO_RETRY_MS = [8000, 20000, 45000];
export const HERO_HEAL_INTERVAL = 4000;
