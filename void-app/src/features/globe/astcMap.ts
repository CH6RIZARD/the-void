// The web-resolution night map, as GPU-ready ASTC blocks.
//
// READ AS A FILE, NOT DECODED. The blocks ship as assets/globe/earth-night.astc.bin
// and expo-file-system reads them natively: no base64, no inflate, nothing on the
// JS thread but the await. The old path (a 3 MB base64 string atob'd and inflated
// in yielding slices, ~5-12 s on the phone) stays only as the fallback for a
// binary without the native module.
import { Unzlib } from 'fflate';
import { Asset } from 'expo-asset';
import { ASTC_BYTES, ASTC_Z } from './earthAstc';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ASTC_FILE = require('../../../assets/globe/earth-night.astc.bin');

async function readAstcFile(): Promise<Uint8Array> {
  const asset = Asset.fromModule(ASTC_FILE);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('no localUri');
  // Required here, not imported: on a binary built before the module existed the
  // import itself would throw at boot; here it only lands in the fallback.
  const { File } = require('expo-file-system') as typeof import('expo-file-system');
  const out = new Uint8Array(await new File(asset.localUri).arrayBuffer());
  if (out.length !== ASTC_BYTES) throw new Error('file size ' + out.length);
  return out;
}

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
        cache = await readAstcFile();
        try {
          console.warn('[globe] astc map: file read in ' + (Date.now() - t0) + 'ms');
        } catch {}
        return cache;
      } catch (e) {
        try {
          console.warn('[globe] astc file failed, decoding the bundled copy: ' + String(e));
        } catch {}
      }
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
