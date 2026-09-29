// Reading the phone's screen, for scripts that need to know when something drew.
//
// screencap -p gives a plain 8-bit PNG, non-interlaced, so a small reader here
// beats adding an image dependency to a repo that has none.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

export const adb = (() => {
  const g = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe') : null;
  return g && existsSync(g) ? g : 'adb';
})();

export const sh = (args, opts = {}) => execFileSync(adb, args, { maxBuffer: 256 * 1024 * 1024, ...opts });
export const text = (args) => sh(args, { encoding: 'utf8' });
export const shell = (cmd) => text(['shell', cmd]);
export const sleep = (ms) => execFileSync(process.execPath, ['-e', `setTimeout(()=>{},${ms})`], { stdio: 'ignore' });

export function decodePng(buf) {
  let p = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const row = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prior = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prior ? prior[x] : 0;
      const c = prior && x >= channels ? prior[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, channels, data: out };
}

export function grab() {
  return decodePng(sh(['exec-out', 'screencap', '-p']));
}

/** A cheap fingerprint of a region: coarse luminance over a grid. */
export function fingerprint(img, x0f = 0.02, y0f = 0.08, x1f = 0.98, y1f = 0.86, grid = 24) {
  const { w, h, channels, data } = img;
  const x0 = Math.floor(w * x0f), x1 = Math.floor(w * x1f);
  const y0 = Math.floor(h * y0f), y1 = Math.floor(h * y1f);
  const out = new Float64Array(grid * grid);
  const cw = (x1 - x0) / grid, ch = (y1 - y0) / grid;
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      let sum = 0, n = 0;
      const sx = Math.floor(x0 + gx * cw), ex = Math.floor(x0 + (gx + 1) * cw);
      const sy = Math.floor(y0 + gy * ch), ey = Math.floor(y0 + (gy + 1) * ch);
      for (let y = sy; y < ey; y += 3) {
        for (let x = sx; x < ex; x += 3) {
          const i = y * w * channels + x * channels;
          sum += (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
          n++;
        }
      }
      out[gy * grid + gx] = n ? sum / n : 0;
    }
  }
  return out;
}

/** Mean absolute difference between two fingerprints, in luminance units. */
export function diff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/**
 * The fraction of the screen that changed, rather than by how much.
 *
 * A mean difference cannot tell "the page is still loading" from "the page is
 * finished and one spinner is turning". This app is full of the second kind -
 * particle loaders, a blinking live dot, video thumbnails - so a mean-based
 * settle test never settles and every move reports the timeout, which reads as
 * "slow" when it is really "measured wrong".
 *
 * Counting cells instead separates them: a screen mid-transition changes
 * almost everywhere, a finished screen with something animating on it changes
 * in a few cells and nowhere else.
 */
export function changedFraction(a, b, cellDelta = 3) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > cellDelta) n++;
  return n / a.length;
}

/** How much of this fingerprint is not one flat colour. */
export function variety(fp) {
  const seen = new Set();
  for (const v of fp) seen.add(v >> 3);
  return seen.size;
}

export function navPoints() {
  const m = shell('wm size').match(/(\d+)x(\d+)/);
  const w = Number(m?.[1] || 720), h = Number(m?.[2] || 1560);
  const y = Math.round(h * 0.883);
  return Array.from({ length: 5 }, (_, i) => ({ x: Math.round(w * (0.175 + i * 0.1625)), y }));
}
