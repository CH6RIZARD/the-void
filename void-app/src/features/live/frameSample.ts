// DEAD-SIGNAL PIXELS for HLS tiles — the native half of the web frameVerdict(video).
//
// The web drew the <video> into a 32x18 canvas. Natively the tile's VideoView renders
// into an Android TextureView (surfaceType="textureView"), which react-native-view-shot
// can read (it calls TextureView.getBitmap). We capture the tile at 32x18 and hand the
// RGBA bytes to the core's frameVerdict / createSignalChecker.
//
//   Both platforms: format "png" at 32x18 -> ~1-3 KB of base64, decoded here (zlib via
//            fflate, PNG filters by hand).
//   Android "raw" (direct RGBA) is implemented but OFF (USE_RAW_ANDROID): view-shot 5.1.0
//            sizes the raw buffer from the UNSCALED view (ViewShot.java: total = w*h*4 with
//            the view's pixel size), so a 32x18 request still ships viewW*viewH*4 bytes of
//            base64 (~3.5 MB for a full-width hero) across the bridge every check. Only the
//            first 32*18*4 bytes are pixels; decodeRaw handles that if it is ever enabled.
//   iOS: AVPlayerLayer often snapshots black; black is 'ok', never a false fail.
//
// Every failure (module missing, view gone, decode error) returns null = unknown.
import { Platform } from 'react-native';
import { unzlibSync } from 'fflate';
import { FRAME_H, FRAME_W } from '../../core';

type CaptureRef = (view: any, opts: Record<string, unknown>) => Promise<string>;
let captureRefFn: CaptureRef | null | undefined;
function getCapture(): CaptureRef | null {
  if (captureRefFn !== undefined) return captureRefFn;
  try {
    // A build without the native module must not crash the live wall.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('react-native-view-shot');
    captureRefFn = (m && (m.captureRef || (m.default && m.default.captureRef))) || null;
  } catch {
    captureRefFn = null;
  }
  return captureRefFn!;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LUT = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t['-'.charCodeAt(0)] = 62;
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

/** Decode base64 (optionally only the first `maxBytes` bytes). */
export function b64ToBytes(s: string, maxBytes = Infinity): Uint8Array {
  let len = s.length;
  while (len > 0 && (s.charCodeAt(len - 1) === 61 /* = */ || s.charCodeAt(len - 1) <= 32)) len--;
  const full = Math.floor((len * 3) / 4);
  const outLen = Math.min(full, maxBytes);
  const out = new Uint8Array(outLen);
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < len && o < outLen; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64_LUT[c] : -1;
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return o === outLen ? out : out.subarray(0, o);
}

/** Minimal PNG -> RGBA (8-bit greyscale/RGB/RGBA/grey+alpha, non-interlaced). null on anything else. */
export function decodePngRGBA(png: Uint8Array): { w: number; h: number; data: Uint8Array } | null {
  try {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (png[i] !== sig[i]) return null;
    const rd = (p: number) => ((png[p] << 24) | (png[p + 1] << 16) | (png[p + 2] << 8) | png[p + 3]) >>> 0;
    let p = 8;
    let w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
    const idat: Uint8Array[] = [];
    let idatLen = 0;
    while (p + 8 <= png.length) {
      const len = rd(p);
      const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
      const body = png.subarray(p + 8, p + 8 + len);
      if (type === 'IHDR') {
        w = rd(p + 8);
        h = rd(p + 12);
        depth = body[8];
        ctype = body[9];
        interlace = body[12];
      } else if (type === 'IDAT') {
        idat.push(body);
        idatLen += body.length;
      } else if (type === 'IEND') break;
      p += 12 + len;
    }
    if (!w || !h || depth !== 8 || interlace !== 0) return null;
    const ch = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 4 ? 2 : ctype === 0 ? 1 : 0;
    if (!ch) return null; // palette PNGs are not produced by the platform encoders
    const z = new Uint8Array(idatLen);
    let off = 0;
    for (const c of idat) {
      z.set(c, off);
      off += c.length;
    }
    const raw = unzlibSync(z);
    const stride = w * ch;
    if (raw.length < (stride + 1) * h) return null;
    const px = new Uint8Array(stride * h);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)];
      const src = y * (stride + 1) + 1;
      const row = y * stride;
      const prev = row - stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= ch ? px[row + x - ch] : 0;
        const b = y > 0 ? px[prev + x] : 0;
        const c = x >= ch && y > 0 ? px[prev + x - ch] : 0;
        let v = raw[src + x];
        switch (f) {
          case 1: v += a; break;
          case 2: v += b; break;
          case 3: v += (a + b) >> 1; break;
          case 4: {
            const pp = a + b - c;
            const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
            v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            break;
          }
        }
        px[row + x] = v & 0xff;
      }
    }
    if (ch === 4) return { w, h, data: px };
    const out = new Uint8Array(w * h * 4);
    for (let i = 0, n = w * h; i < n; i++) {
      const s = i * ch, d = i * 4;
      if (ch === 3) { out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; }
      else { out[d] = out[d + 1] = out[d + 2] = px[s]; }
      out[d + 3] = ch === 2 ? px[s + 1] : 255;
    }
    return { w, h, data: out };
  } catch {
    return null;
  }
}

/** Android raw payload "W:H|base64" -> the first 32x18 RGBA bytes, or null if it does not look like pixels. */
function decodeRaw(res: string): Uint8Array | null {
  const bar = res.indexOf('|');
  const b64 = bar >= 0 && bar < 24 ? res.slice(bar + 1) : res;
  const need = FRAME_W * FRAME_H * 4;
  const bytes = b64ToBytes(b64, need);
  if (bytes.length < need) return null;
  // Sanity: a video frame is opaque, so alpha is 255 in RGBA order. ARGB order would
  // put 255 in byte 0 instead; rotate if that is what arrived.
  let a3 = 0, a0 = 0;
  for (let i = 0; i < need; i += 4) {
    if (bytes[i + 3] === 255) a3++;
    if (bytes[i] === 255) a0++;
  }
  const n = need / 4;
  if (a3 >= n * 0.9) return bytes;
  if (a0 >= n * 0.9) {
    const out = new Uint8Array(need);
    for (let i = 0; i < need; i += 4) {
      out[i] = bytes[i + 1]; out[i + 1] = bytes[i + 2]; out[i + 2] = bytes[i + 3]; out[i + 3] = 255;
    }
    return out;
  }
  return null;
}

/** See header: raw ships the whole unscaled view buffer in view-shot 5.1.0. */
const USE_RAW_ANDROID = false;
let rawBroken = false;

/**
 * Capture a mounted native view at 32x18 and return its RGBA bytes, or null (unknown).
 * Never throws.
 */
export async function sampleFrame(view: any): Promise<Uint8Array | null> {
  const capture = getCapture();
  if (!capture || !view) return null;
  if (USE_RAW_ANDROID && Platform.OS === 'android' && !rawBroken) {
    try {
      const res = await capture(view, { width: FRAME_W, height: FRAME_H, format: 'raw', result: 'base64' });
      const px = typeof res === 'string' ? decodeRaw(res) : null;
      if (px) return px;
      rawBroken = true; // this device's raw payload is not usable: PNG from now on
    } catch {
      return null;
    }
  }
  try {
    const res = await capture(view, { width: FRAME_W, height: FRAME_H, format: 'png', result: 'base64' });
    if (typeof res !== 'string' || !res) return null;
    const b64 = res.startsWith('data:') ? res.slice(res.indexOf(',') + 1) : res;
    const img = decodePngRGBA(b64ToBytes(b64));
    if (!img) return null;
    if (img.w === FRAME_W && img.h === FRAME_H) return img.data;
    // iOS may hand back @2x/@3x pixels: nearest-sample down to 32x18.
    const out = new Uint8Array(FRAME_W * FRAME_H * 4);
    for (let y = 0; y < FRAME_H; y++) {
      const sy = Math.min(img.h - 1, Math.floor(((y + 0.5) * img.h) / FRAME_H));
      for (let x = 0; x < FRAME_W; x++) {
        const sx = Math.min(img.w - 1, Math.floor(((x + 0.5) * img.w) / FRAME_W));
        const s = (sy * img.w + sx) * 4, d = (y * FRAME_W + x) * 4;
        out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = img.data[s + 3];
      }
    }
    return out;
  } catch {
    return null;
  }
}

// ─── App-wide pacing for mid-stream checks ──────────────────────────────────
// captureRef reads the TextureView bitmap on the Android MAIN thread, then the PNG is
// inflated in JS. Every playing HLS tile used to do that every 6.1 s on its own
// clock, so a wall of them stacked main-thread stalls and GC spikes. Mid-stream
// checks now share one gate: one capture at a time app-wide, at least
// MIDSTREAM_GAP_MS apart. A check that finds the gate closed simply skips its turn
// (null = unknown, which the signal checker already treats as "no verdict").
// The one-shot connect-time judge still uses sampleFrame directly, unpaced.
const MIDSTREAM_GAP_MS = 2000;
let gateBusy = false;
let gateLast = 0;

export async function sampleFramePaced(view: any): Promise<Uint8Array | null> {
  const now = Date.now();
  if (gateBusy || now - gateLast < MIDSTREAM_GAP_MS) return null;
  gateBusy = true;
  gateLast = now;
  try {
    return await sampleFrame(view);
  } finally {
    gateBusy = false;
  }
}
