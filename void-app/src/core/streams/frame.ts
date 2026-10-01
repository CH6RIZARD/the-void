// ─── DEAD-SIGNAL FRAMES (colour bars / flat slate) ──────────────────────
// A broadcaster off-air still serves a valid HLS stream of SMPTE test bars, so the
// player reports PLAYING and the tile "connected". Pixels are the only truth:
// sample one frame at 32x18 and look for it. The web drew the <video> into a
// canvas; natively, feed an RGBA buffer of a 32x18 downscale of the current frame.
// No pixels available -> null ("unknown", never a false fail).
export const FRAME_W = 32, FRAME_H = 18;

export type FrameVerdict = 'bars' | 'slate' | 'ok' | null;

/** RGBA bytes, row-major, length W*H*4 (default 32x18). */
export function frameVerdict(d: ArrayLike<number> | null | undefined, W = FRAME_W, H = FRAME_H): FrameVerdict {
  if (!d || d.length < W * H * 4) return null;
  const at = (x: number, y: number, k: number) => d[(y * W + x) * 4 + k];
  // Flat slate: nearly every pixel one non-black colour ("no signal" cards).
  let mr = 0, mg = 0, mb = 0; const N = W * H;
  for (let i = 0; i < N; i++) { mr += d[i * 4]; mg += d[i * 4 + 1]; mb += d[i * 4 + 2]; }
  mr /= N; mg /= N; mb /= N;
  let flat = 0;
  for (let i = 0; i < N; i++) { if (Math.abs(d[i * 4] - mr) + Math.abs(d[i * 4 + 1] - mg) + Math.abs(d[i * 4 + 2] - mb) < 36) flat++; }
  const slate = flat / N > 0.92 && (mr + mg + mb) / 3 > 40;
  // Colour bars: in the upper band every column is vertically uniform, and the
  // columns form 6+ runs of distinct, strongly saturated colours.
  const Y0 = 3, Y1 = 11, cols: number[][] = []; let uniform = 0;
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0; const n = Y1 - Y0 + 1;
    for (let y = Y0; y <= Y1; y++) { r += at(x, y, 0); g += at(x, y, 1); b += at(x, y, 2); }
    r /= n; g /= n; b /= n;
    let dev = 0;
    for (let y = Y0; y <= Y1; y++) dev = Math.max(dev, Math.abs(at(x, y, 0) - r) + Math.abs(at(x, y, 1) - g) + Math.abs(at(x, y, 2) - b));
    if (dev < 60) uniform++;
    cols.push([r, g, b]);
  }
  const runs: Array<{ c: number[]; w: number }> = []; let cur: { c: number[]; w: number } | null = null;
  for (const c of cols) {
    if (cur && Math.max(Math.abs(c[0] - cur.c[0]), Math.abs(c[1] - cur.c[1]), Math.abs(c[2] - cur.c[2])) < 50) { cur.w++; }
    else { cur = { c, w: 1 }; runs.push(cur); }
  }
  const wide = runs.filter(r => r.w >= 2);
  // Count DISTINCT colours, not runs — alternating stripes (curtains, a fence) make
  // many runs of only two colours; a test card has 6-8 different ones.
  const distinct: number[][] = [];
  for (const r of wide) { if (!distinct.some(c => Math.max(Math.abs(c[0] - r.c[0]), Math.abs(c[1] - r.c[1]), Math.abs(c[2] - r.c[2])) < 60)) distinct.push(r.c); }
  const saturated = distinct.filter(c => Math.max(...c) - Math.min(...c) > 80).length;
  const bars = uniform >= W * 0.8 && wide.length >= 6 && distinct.length >= 6 && saturated >= 4;
  return bars ? 'bars' : slate ? 'slate' : 'ok';
}

/**
 * Mid-stream checker state for one tile (web checkTileSignal): at most one check
 * per 6s; bars = dead now; a slate must persist across 3 checks so a fade or title
 * card is never mistaken for off-air. Returns true when the tile should be marked
 * bad + healed.
 */
export function createSignalChecker() {
  let at = 0, slateN = 0;
  return (pixels: ArrayLike<number> | null, now: number): boolean => {
    if (at && now - at < 6000) return false;
    at = now;
    const vd = frameVerdict(pixels);
    if (vd === 'bars' || (vd === 'slate' && (slateN = slateN + 1) >= 3)) return true;
    if (vd === 'ok') slateN = 0;
    return false;
  };
}
/**
 * Connect-time judge delay after PLAYING before sampling (ms).
 *
 * The tile keeps its loader until this lands, so this is also how long a working
 * stream waits to be SEEN. 700ms was most of why tiles felt slow; it only has to
 * be long enough for a frame to exist to sample.
 */
export const FRAME_JUDGE_DELAY = 320;
