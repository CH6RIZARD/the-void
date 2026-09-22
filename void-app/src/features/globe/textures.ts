// Globe textures without a DOM canvas.
//
// web mkTex(hot)      → markerTexture(hot): the same 128×128 radial gradient, rasterised
//                        in JS the way <canvas> does (premultiplied interpolation, then
//                        un-premultiplied like getImageData) into a DataTexture with the
//                        CanvasTexture defaults (linear / mipmapped).
// web _fallbackEarth  → fallbackEarthTexture(): same 512×256 gradient + 900 faint rects.
// web TextureLoader   → loadEarthTexture(): the bundled JPEG (assets/globe, 2048×1024: the
//                        web's 4096×2048 unpkg copy is 32 MB of GPU memory for a ≤320pt
//                        globe, and fetching it at runtime left the sphere missing on slow
//                        networks) is uploaded by expo-gl straight from the file ({ localUri })
//                        into a raw GL texture handed to three.js (three never re-uploads a
//                        version-0 texture).
import * as THREE from 'three';
import { Asset } from 'expo-asset';
import { b64ToBytes, decodePngRGBA } from '../live/frameSample';
import { EARTH_PNG_B64 } from './earthTexture';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const EARTH = require('../../../assets/globe/earth-night.jpg');

type Stop = [number, number, number, number, number]; // offset, r, g, b, a(0..1)

function rasterRadial(size: number, stops: Stop[]): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const c = size / 2;
  const R = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / R;
      let i = 0;
      while (i < stops.length - 1 && d > stops[i + 1][0]) i++;
      let r: number, g: number, b: number, a: number;
      if (d <= stops[0][0]) [, r, g, b, a] = stops[0];
      else if (i >= stops.length - 1) [, r, g, b, a] = stops[stops.length - 1];
      else {
        const s0 = stops[i],
          s1 = stops[i + 1];
        const t = (d - s0[0]) / Math.max(1e-6, s1[0] - s0[0]);
        // Canvas gradients interpolate in premultiplied space.
        const pa = s0[4] + (s1[4] - s0[4]) * t;
        const pr = s0[1] * s0[4] + (s1[1] * s1[4] - s0[1] * s0[4]) * t;
        const pg = s0[2] * s0[4] + (s1[2] * s1[4] - s0[2] * s0[4]) * t;
        const pb = s0[3] * s0[4] + (s1[3] * s1[4] - s0[3] * s0[4]) * t;
        a = pa;
        r = pa > 0 ? pr / pa : 0;
        g = pa > 0 ? pg / pa : 0;
        b = pa > 0 ? pb / pa : 0;
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r);
      out[o + 1] = Math.round(g);
      out[o + 2] = Math.round(b);
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}

function canvasLikeTexture(data: Uint8Array, w: number, h: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  // CanvasTexture defaults (DataTexture defaults to Nearest / no mipmaps).
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** web mkTex(hot) */
export function markerTexture(hot: boolean): THREE.DataTexture {
  const stops: Stop[] = hot
    ? [
        [0, 255, 235, 100, 1],
        [0.12, 220, 170, 50, 1],
        [0.3, 140, 100, 20, 0.5],
        [0.6, 0, 0, 0, 0.05],
        [1, 0, 0, 0, 0],
      ]
    : [
        [0, 200, 165, 76, 1],
        [0.12, 160, 128, 52, 0.9],
        [0.3, 90, 65, 20, 0.35],
        [0.6, 0, 0, 0, 0.05],
        [1, 0, 0, 0, 0],
      ];
  return canvasLikeTexture(rasterRadial(128, stops), 128, 128);
}

/** web _fallbackEarth(): 512×256 vertical gradient + 900 faint landmass-ish rects. */
export function fallbackEarthTexture(): THREE.DataTexture {
  const W = 512,
    H = 256;
  const px = new Float32Array(W * H * 3);
  const c0 = [0x0a, 0x07, 0x33],
    c1 = [0x14, 0x0b, 0x3a];
  for (let y = 0; y < H; y++) {
    const t = (y + 0.5) / H;
    const k = t <= 0.5 ? t / 0.5 : (1 - t) / 0.5; // 0 → .5 → 1 mirrored
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      px[o] = c0[0] + (c1[0] - c0[0]) * k;
      px[o + 1] = c0[1] + (c1[1] - c0[1]) * k;
      px[o + 2] = c0[2] + (c1[2] - c0[2]) * k;
    }
  }
  for (let i = 0; i < 900; i++) {
    const a = 0.03 + Math.random() * 0.07;
    const w = 6 + Math.random() * 40;
    const rx = Math.random() * W,
      ry = Math.random() * H;
    const x0 = Math.max(0, Math.floor(rx)),
      x1 = Math.min(W, Math.ceil(rx + w));
    const y0 = Math.max(0, Math.floor(ry)),
      y1 = Math.min(H, Math.ceil(ry + w * 0.5));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const o = (y * W + x) * 3;
        px[o] = px[o] * (1 - a) + 90 * a;
        px[o + 1] = px[o + 1] * (1 - a) + 60 * a;
        px[o + 2] = px[o + 2] * (1 - a) + 190 * a;
      }
  }
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = Math.round(px[i * 3]);
    data[i * 4 + 1] = Math.round(px[i * 3 + 1]);
    data[i * 4 + 2] = Math.round(px[i * 3 + 2]);
    data[i * 4 + 3] = 255;
  }
  const tex = canvasLikeTexture(data, W, H);
  // (CanvasTexture flips on upload; this pattern is random/vertically symmetric, so the
  // flip is skipped — expo-gl's UNPACK_FLIP_Y support for typed arrays is not relied on.)
  return tex;
}

/**
 * Download earth-night.jpg and upload it from file. Resolves a three.js Texture bound to
 * a raw GL texture, or rejects (caller uses the fallback, exactly like the web's onError).
 */
/**
 * The map as raw RGBA, decoded in JS from the bundled PNG.
 *
 * Why this exists: expo-gl's { localUri } upload is a driver path, and on the MT6762
 * test phone it fails - measured on device, texImage2D leaves GL error 1282
 * (INVALID_OPERATION) and the globe kept the flat purple fallback for every session.
 * Decoding here uses only fflate + the app's own PNG reader (the same one the live
 * wall samples frames with), so it cannot be refused by a driver. It is the FALLBACK:
 * the direct upload still runs first and is free where it works.
 */
/** DataTexture has no flipY, and the map decodes top-row-first. */
function flipRowsInPlace(data: Uint8Array, w: number, h: number): void {
  const stride = w * 4;
  const tmp = new Uint8Array(stride);
  for (let y = 0; y < (h >> 1); y++) {
    const top = y * stride, bot = (h - 1 - y) * stride;
    tmp.set(data.subarray(top, top + stride));
    data.copyWithin(top, bot, bot + stride);
    data.set(tmp, bot);
  }
}
function earthPixels(): { w: number; h: number; data: Uint8Array } | null {
  try {
    return decodePngRGBA(b64ToBytes(EARTH_PNG_B64));
  } catch {
    return null;
  }
}
export async function loadEarthTexture(gl: any, renderer: THREE.WebGLRenderer, rawPixelStorei: (p: number, v: any) => void): Promise<THREE.Texture> {
  const asset = Asset.fromModule(EARTH);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('earth texture: no localUri');
  for (let i = 0; i < 16 && gl.getError() !== gl.NO_ERROR; i++);
  const glTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, glTex);
  rawPixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // TextureLoader textures have flipY = true
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, { localUri: asset.localUri });
  // Driver refused the file upload (1282 on the MT6762 test phone: expo-gl's
  // { localUri } upload is a native path and this driver rejects it). Hand the pixels
  // to three instead - it does its own upload, mipmaps and filtering, so nothing here
  // has to be right about raw GL state. console.warn, not log: release builds strip log.
  const direct = gl.getError();
  if (direct !== gl.NO_ERROR) {
    rawPixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteTexture(glTex);
    renderer.resetState();
    const px = earthPixels();
    if (!px) throw new Error('earth texture: GL ' + direct + ' and the PNG decode failed too');
    flipRowsInPlace(px.data, px.w, px.h);   // DataTexture ignores flipY
    const dt = new THREE.DataTexture(px.data, px.w, px.h, THREE.RGBAFormat);
    dt.colorSpace = THREE.SRGBColorSpace;
    dt.magFilter = THREE.LinearFilter;
    dt.minFilter = THREE.LinearMipmapLinearFilter;
    dt.wrapS = THREE.ClampToEdgeWrapping;
    dt.wrapT = THREE.ClampToEdgeWrapping;
    dt.generateMipmaps = true;
    dt.needsUpdate = true;
    try { console.warn('[globe] earth texture: JS PNG decode path ' + px.w + 'x' + px.h + ' (direct upload gave GL ' + direct + ')'); } catch {}
    return dt;
  }
  rawPixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // tex.anisotropy = Math.min(4, maxAnisotropy)
  try {
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) {
      const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
      gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, max));
    }
  } catch {}
  const err = gl.getError();
  gl.bindTexture(gl.TEXTURE_2D, null);
  if (err !== gl.NO_ERROR) {
    gl.deleteTexture(glTex);
    throw new Error('earth texture upload failed: GL error ' + err);
  }
  const tex = new THREE.Texture();
  const props = renderer.properties.get(tex) as any;
  props.__webglTexture = glTex;
  props.__webglInit = true;
  renderer.resetState(); // three's GL state cache no longer matches after raw calls
  return tex;
}
