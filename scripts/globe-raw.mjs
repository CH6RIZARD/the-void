#!/usr/bin/env node
// Pre-decode the night map, so the phone never has to.
//
// The app shipped the map as a 765 KB base64 PNG and decoded it in JavaScript on
// the frame that enters the globe tab: zlib inflate, then a byte-at-a-time
// unfilter loop over 2,097,152 bytes, then a 2 MB row flip. Measured on the
// phone that is a 7271 ms block of the JS thread - the whole app frozen - which
// is why the globe took ten seconds to appear. And that PNG is 1024x512, half
// the resolution of the jpg sitting beside it, which is why it looked soft once
// it did appear.
//
// None of that work depends on anything only the phone knows. It is the same
// picture every time, so it happens here, once, and the phone gets finished
// pixels: 2048x1024 RGBA, rows already flipped for DataTexture (which has no
// flipY), alpha already filled. The phone reads bytes and uploads them.
//
//   cd <a scratch dir> && npm init -y && npm install jpeg-js
//   node D:/void-audit/scripts/globe-raw.mjs --jpeg-js=<that dir>/node_modules/jpeg-js
//
// jpeg-js is not a dependency of the app: this runs on a workstation, at author
// time, and nothing it produces needs a decoder on the phone. Re-run it whenever
// assets/globe/earth-night.jpg changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const APP = 'D:/void-audit/void-app';
const SRC = `${APP}/assets/globe/earth-night.jpg`;
const OUT = `${APP}/assets/globe/earth-night.rgba.bin`;

const flag = process.argv.find((a) => a.startsWith('--jpeg-js='));
const jpegPath = flag ? flag.split('=').slice(1).join('=') : 'jpeg-js';

let jpeg;
try {
  jpeg = createRequire(import.meta.url)(jpegPath);
} catch {
  console.error(`could not load jpeg-js from "${jpegPath}".`);
  console.error('Install it somewhere and pass --jpeg-js=<path>; see the header of this file.');
  process.exit(2);
}

const img = jpeg.decode(readFileSync(SRC), { useTArray: true });
const { width: w, height: h, data } = img;
console.log(`decoded ${w}x${h} from ${SRC}`);

// RGBA is kept as-is rather than packed to RGB: three removed RGBFormat in r137,
// so an RGB file would have to be expanded on the phone - a two-million-iteration
// loop, which is the exact work this whole script exists to delete.
const stride = w * 4;
const out = Buffer.alloc(w * h * 4);
const src = Buffer.from(data.buffer, data.byteOffset, data.length);
for (let y = 0; y < h; y++) out.set(src.subarray((h - 1 - y) * stride, (h - y) * stride), y * stride);
// A night map has no meaningful alpha, and jpeg-js leaves it at whatever the
// decoder produced; an opaque map is what the material expects.
for (let o = 3; o < out.length; o += 4) out[o] = 255;

writeFileSync(OUT, out);
console.log(`wrote ${OUT}: ${out.length} bytes (${w}x${h} RGBA, rows flipped)`);
console.log(`loader constants in src/features/globe/textures.ts: RAW_W = ${w}, RAW_H = ${h}`);
