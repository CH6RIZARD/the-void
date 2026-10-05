// The web-resolution night map (earthAstc.ts), decoded off the critical path.
//
// Same treatment as textures.ts's bundled map, for the same measured reasons: the
// base64 is converted in slices and the inflate is streamed, so no single step
// holds the JS thread for more than a few milliseconds.
import { Unzlib } from 'fflate';
import { ASTC_BYTES, ASTC_Z } from './earthAstc';

const SLICE = 64 * 1024;
const yieldThread = () => new Promise<void>((r) => setTimeout(r, 0));
let cache: Uint8Array | null = null;
let pending: Promise<Uint8Array | null> | null = null;

/** Every mip level's ASTC blocks, back to back. null if the decode failed. */
export function earthAstcAsync(): Promise<Uint8Array | null> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = (async () => {
      const t0 = Date.now();
      try {
        const bin = globalThis.atob(ASTC_Z);
        const z = new Uint8Array(bin.length);
        for (let off = 0; off < bin.length; off += SLICE) {
          const end = Math.min(bin.length, off + SLICE);
          for (let i = off; i < end; i++) z[i] = bin.charCodeAt(i);
          await yieldThread();
        }
        const out = new Uint8Array(ASTC_BYTES);
        let at = 0;
        const inf = new Unzlib((chunk) => {
          out.set(chunk.subarray(0, Math.max(0, Math.min(chunk.length, ASTC_BYTES - at))), at);
          at += chunk.length;
        });
        for (let off = 0; off < z.length; off += SLICE) {
          const end = Math.min(z.length, off + SLICE);
          inf.push(z.subarray(off, end), end >= z.length);
          await yieldThread();
        }
        if (at !== ASTC_BYTES) throw new Error('size ' + at);
        cache = out;
        try {
          console.warn('[globe] astc map: decoded in ' + (Date.now() - t0) + 'ms');
        } catch {}
        return out;
      } catch (e) {
        try {
          console.warn('[globe] astc map failed: ' + String(e));
        } catch {}
        return null;
      }
    })();
  }
  return pending;
}
