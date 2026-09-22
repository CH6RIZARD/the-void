// PICK A STREAM SIZE THAT FITS THE TILE.
//
// A wall tile is about 350x195 device px, but an HLS master playlist usually offers
// 720p or 1080p variants and ExoPlayer, left alone, sizes its choice to the WHOLE
// display. Every tile then decodes a full-size picture into a surface a sixth of that
// area. Measured on the test phone with 8 tiles in view: EGL 288 MB + GL 60 MB of a
// 765 MB total - the decoders themselves, not the player count.
//
// So the master playlist (a few KB of text) is read first and the smallest variant that
// still covers the tile is played instead. Nothing about the wall changes: the same
// tiles play live, with the same chrome and loaders; each one just decodes a picture
// the size it is actually drawn at.
//
// Anything unexpected - a media playlist rather than a master, no RESOLUTION tags, a
// slow or failed fetch - falls back to the original URL, so a stream never fails to
// play because of this.
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const FETCH_TIMEOUT_MS = 2500;
/** Below this the picture is visibly soft on a 2x tile, whatever the tile size says. */
const MIN_WIDTH = 480;

interface Variant {
  url: string;
  width: number;
  height: number;
  bandwidth: number;
}

/** Parse #EXT-X-STREAM-INF variants out of a master playlist. */
export function parseMaster(text: string, baseUrl: string): Variant[] {
  if (!/#EXT-X-STREAM-INF/i.test(text)) return [];
  const lines = text.split(/\r?\n/);
  const out: Variant[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!/^#EXT-X-STREAM-INF/i.test(line)) continue;
    const res = /RESOLUTION=(\d+)x(\d+)/i.exec(line);
    const bw = /BANDWIDTH=(\d+)/i.exec(line);
    // The URI is the next non-comment, non-empty line.
    let uri = '';
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (!l || l.startsWith('#')) continue;
      uri = l;
      break;
    }
    if (!uri || !res) continue; // no RESOLUTION: audio-only or unknown, leave it alone
    let abs = uri;
    try {
      abs = new URL(uri, baseUrl).toString();
    } catch {
      if (!/^https?:/i.test(uri)) continue;
    }
    out.push({ url: abs, width: Number(res[1]), height: Number(res[2]), bandwidth: bw ? Number(bw[1]) : 0 });
  }
  return out;
}

/** The smallest variant at least `targetW` px wide, else the largest available. */
export function pickVariant(variants: Variant[], targetW: number): Variant | null {
  if (!variants.length) return null;
  const want = Math.max(MIN_WIDTH, targetW);
  const big = variants.filter((v) => v.width >= want).sort((a, b) => a.width - b.width || a.bandwidth - b.bandwidth);
  if (big.length) return big[0];
  return [...variants].sort((a, b) => b.width - a.width)[0];
}

/**
 * The URL a tile of `targetW` device px should play. Returns the original URL for
 * anything that is not an HLS master playlist, or if the playlist cannot be read.
 */
export async function variantFor(url: string, targetW: number): Promise<string> {
  if (!url || !/\.m3u8(\?|$)/i.test(url)) return url;
  const key = `${url}|${Math.round(targetW / 120)}`; // same bucket = same answer
  const hit = cache.get(key);
  if (hit) return hit;
  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    let out = url;
    try {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = setTimeout(() => ctl?.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, { signal: ctl?.signal as any });
      const text = res.ok ? await res.text() : '';
      clearTimeout(t);
      const pick = pickVariant(parseMaster(text, url), targetW);
      if (pick) out = pick.url;
    } catch {
      // keep the original
    }
    cache.set(key, out);
    inflight.delete(key);
    return out;
  })();
  inflight.set(key, job);
  return job;
}

/** Synchronous peek for an already-resolved URL (no flash of the full-size stream). */
export function variantCached(url: string, targetW: number): string | null {
  return cache.get(`${url}|${Math.round(targetW / 120)}`) ?? null;
}
