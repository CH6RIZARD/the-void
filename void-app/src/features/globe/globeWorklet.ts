// THE GLOBE, OFF THE JS THREAD ENTIRELY.
//
// The user: "the globe was built with the web page in mind - if you have to
// completely rebuild it, do that. I just need it to look the same because it's
// utterly beautiful to me." This is that rebuild. The three.js scene produced
// its frames on the JS thread, so every stall froze it however good the
// gesture path was; this renderer runs its whole loop - input consumption,
// inertia, easing, matrices, draws - inside expo-gl's worklet context on the
// UI thread, the same isolation the browser gives the web globe.
//
// THE LOOK IS THE CONTRACT. Every constant below is transcribed from
// docs/globe-rebuild/visual-spec.md (extracted from globeScene.ts and
// adversarially verified against it): the r128 Phong equation written out by
// hand, the same lights, the same star fields, the same marker sprites and
// pulse, the same inertia and idle drift. Where the spec and its verifier
// disagreed, the verifier's corrections won (BackSide flips normals; uProj
// uses the full buffer height).
//
// Three.js cannot run in the worklet context (documented), which is why this
// is raw WebGL1: one textured sphere, two point clouds, a shell, one marker
// draw. Nothing here relies on the depth buffer to hide geometry behind the
// planet (the Helio P35's depth is broken): the atmosphere discards by
// analytic ray/sphere, markers fade by facing, stars sit under the opaque
// sphere in draw order.
import { runOnUI, type SharedValue } from 'react-native-reanimated';
import { GLView } from 'expo-gl';
import { Asset } from 'expo-asset';
import type { Country } from '../live/core';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const EARTH_JPG = require('../../../assets/globe/earth-night.jpg');

export interface WorkletGlobeShared {
  // gesture (written by the Gesture.Manual worklets in GlobeCanvas)
  accX: SharedValue<number>;
  accY: SharedValue<number>;
  accZoom: SharedValue<number>;
  velX: SharedValue<number>;
  velY: SharedValue<number>;
  dragSV: SharedValue<number>;
  // control
  runningSV: SharedValue<number>;   // 1 = render; 0 = hold last frame
  canceledSV: SharedValue<number>;  // 1 = loop exits for good (dispose)
  hotSV: SharedValue<number>;       // hovered marker index, -1 none
  // state the loop reports back (JS picking + health watchdog read these)
  rotXSV: SharedValue<number>;
  rotYSV: SharedValue<number>;
  zoomSV: SharedValue<number>;
  lastFrameSV: SharedValue<number>; // timestamp of the last drawn frame
  texStateSV: SharedValue<number>;  // 0 fallback showing · 1 real map showing
  earthUriSV: SharedValue<string>;  // '' until JS resolves the bundled jpg's localUri
}

/** Marker positions: lat/lon -> unit sphere x1.02, the scene's exact formula. */
function markerPositions(countries: Country[]): Float32Array {
  const r = 1.02;
  const out = new Float32Array(countries.length * 3);
  for (let i = 0; i < countries.length; i++) {
    const c = countries[i];
    const phi = ((90 - c.lat) * Math.PI) / 180;
    const th = ((c.lon + 180) * Math.PI) / 180;
    out[i * 3] = -r * Math.sin(phi) * Math.cos(th);
    out[i * 3 + 1] = r * Math.cos(phi);
    out[i * 3 + 2] = r * Math.sin(phi) * Math.sin(th);
  }
  return out;
}

/** markerTexture(hot), pixel-for-pixel: a canvas radial gradient rasterised by
 *  hand - premultiplied-space stop interpolation, then un-premultiplied. */
function markerPixels(hot: boolean): Uint8Array {
  const S = 128;
  const stops: [number, number, number, number, number][] = hot
    ? [[0, 255, 235, 100, 1], [0.12, 220, 170, 50, 1], [0.3, 140, 100, 20, 0.5], [0.6, 0, 0, 0, 0.05], [1, 0, 0, 0, 0]]
    : [[0, 200, 165, 76, 1], [0.12, 160, 128, 52, 0.9], [0.3, 90, 65, 20, 0.35], [0.6, 0, 0, 0, 0.05], [1, 0, 0, 0, 0]];
  const px = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x + 0.5 - 64, y + 0.5 - 64) / 64;
      let a = stops[stops.length - 1];
      let b = a;
      let t = 0;
      if (d <= stops[0][0]) { a = stops[0]; b = stops[0]; }
      else {
        for (let s = 1; s < stops.length; s++) {
          if (d <= stops[s][0]) {
            a = stops[s - 1]; b = stops[s];
            t = (d - a[0]) / Math.max(1e-6, b[0] - a[0]);
            break;
          }
        }
      }
      // premultiplied lerp, then un-premultiply (canvas gradient semantics)
      const pa = a[4] + (b[4] - a[4]) * t;
      const pr = a[1] * a[4] + (b[1] * b[4] - a[1] * a[4]) * t;
      const pg = a[2] * a[4] + (b[2] * b[4] - a[2] * a[4]) * t;
      const pb = a[3] * a[4] + (b[3] * b[4] - a[3] * a[4]) * t;
      const o = (y * S + x) * 4;
      px[o] = Math.round(pa > 0 ? pr / pa : 0);
      px[o + 1] = Math.round(pa > 0 ? pg / pa : 0);
      px[o + 2] = Math.round(pa > 0 ? pb / pa : 0);
      px[o + 3] = Math.round(pa * 255);
    }
  }
  return px;
}

/** Kick the async resolve of the bundled night map; the worklet uploads it the
 *  moment the uri lands (native JPEG decode - no JS bytes, no base64). */
export function resolveEarthUri(sv: SharedValue<string>): void {
  const a = Asset.fromModule(EARTH_JPG);
  a.downloadAsync()
    .then(() => { sv.value = a.localUri || a.uri || ''; })
    .catch(() => {});
}

/**
 * Build + run the whole globe inside the worklet context. Returns nothing the
 * JS side must hold: steering, health and picking all flow through the shared
 * values above.
 */
export function startWorkletGlobe(
  exglCtxId: number,
  countries: Country[],
  viewW: number,
  viewH: number,
  sv: WorkletGlobeShared,
): void {
  const markers = markerPositions(countries);
  const markerCount = countries.length;
  const sprite = markerPixels(false);
  const spriteHot = markerPixels(true);

  runOnUI((ctxId: number, mk: Float32Array, mkN: number, sp: Uint8Array, spHot: Uint8Array, vw: number, vh: number) => {
    'worklet';
    const gl = GLView.getWorkletContext(ctxId) as any;
    if (!gl) return;

    // ─── sizing (visual-spec §1) ───────────────────────────────────────────
    // FULL BUFFER, ALWAYS. A sub-buffer viewport offsets the picture toward a
    // corner because the surface presents the whole buffer (the raster-cap trick
    // did exactly that to build 6 - "not centered on the x axis literally").
    // This renderer runs off the JS thread; it does not need the trick.
    const bufW = gl.drawingBufferWidth, bufH = gl.drawingBufferHeight;
    const renderW = bufW;
    const renderH = bufH;

    const compile = (vsSrc: string, fsSrc: string) => {
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
      const p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      return p;
    };

    // ─── sphere geometry 72x72, three r128 construction (spec §5) ──────────
    const SEG = 72;
    const verts: number[] = [];
    const uvs: number[] = [];
    for (let iy = 0; iy <= SEG; iy++) {
      const v = iy / SEG;
      const uOff = iy === 0 ? 0.5 / SEG : iy === SEG ? -0.5 / SEG : 0;
      for (let ix = 0; ix <= SEG; ix++) {
        const u = ix / SEG;
        const theta = v * Math.PI, phi = u * 2 * Math.PI;
        verts.push(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
        // three uses (u, 1-v) WITH a flipY upload; our localUri upload does not
        // flip, so the image's top row (north) sits at texture v=0 - sample v
        // directly or the planet meets the user Antarctica-first (build 6's bug,
        // inherited from the same convention mismatch).
        uvs.push(u + uOff, v);
      }
    }
    const idx: number[] = [];
    for (let iy = 0; iy < SEG; iy++) {
      for (let ix = 0; ix < SEG; ix++) {
        const a = iy * (SEG + 1) + ix, b = a + SEG + 1;
        if (iy !== 0) idx.push(a, b, a + 1);
        if (iy !== SEG - 1) idx.push(b, b + 1, a + 1);
      }
    }
    const sphereVB = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sphereVB);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    const sphereUVB = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sphereUVB);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
    const sphereIB = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereIB);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    const sphereIdxCount = idx.length;

    // ─── atmosphere shell 1.06 r, 32x32 (spec §7) ──────────────────────────
    const ASEG = 32;
    const averts: number[] = [];
    for (let iy = 0; iy <= ASEG; iy++) {
      const v = iy / ASEG;
      for (let ix = 0; ix <= ASEG; ix++) {
        const u = ix / ASEG;
        const theta = v * Math.PI, phi = u * 2 * Math.PI;
        averts.push(-1.06 * Math.cos(phi) * Math.sin(theta), 1.06 * Math.cos(theta), 1.06 * Math.sin(phi) * Math.sin(theta));
      }
    }
    const aidx: number[] = [];
    for (let iy = 0; iy < ASEG; iy++) {
      for (let ix = 0; ix < ASEG; ix++) {
        const a = iy * (ASEG + 1) + ix, b = a + ASEG + 1;
        if (iy !== 0) aidx.push(a, b, a + 1);
        if (iy !== ASEG - 1) aidx.push(b, b + 1, a + 1);
      }
    }
    const atmoVB = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, atmoVB);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(averts), gl.STATIC_DRAW);
    const atmoIB = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, atmoIB);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(aidx), gl.STATIC_DRAW);
    const atmoIdxCount = aidx.length;

    // ─── star fields (spec §4): [3000, .04, 0x0d0835], [400, .07, 0x1e1270] ─
    const mkStars = (n: number) => {
      const p = new Float32Array(n * 3);
      for (let i = 0; i < p.length; i++) p[i] = (Math.random() - 0.5) * 200;
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, p, gl.STATIC_DRAW);
      return b;
    };
    const stars1 = mkStars(3000), stars2 = mkStars(400);

    // ─── marker buffers (spec §8): position + aIdx; hot via uniform compare ─
    const mkVB = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, mkVB);
    gl.bufferData(gl.ARRAY_BUFFER, mk, gl.STATIC_DRAW);
    const mkIdx = new Float32Array(mkN);
    for (let i = 0; i < mkN; i++) mkIdx[i] = i;
    const mkIdxB = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, mkIdxB);
    gl.bufferData(gl.ARRAY_BUFFER, mkIdx, gl.STATIC_DRAW);

    // ─── textures ──────────────────────────────────────────────────────────
    const texFromPixels = (px: Uint8Array, w: number, h: number) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    // fallback earth (spec §5): 512x256 gradient + 900 glow rects
    const FW = 512, FH = 256;
    const fpx = new Uint8Array(FW * FH * 4);
    const c0 = [10, 7, 51], c1 = [20, 11, 58];
    for (let y = 0; y < FH; y++) {
      const t = y / FH;
      const k = t <= 0.5 ? t / 0.5 : (1 - t) / 0.5;
      const r = c0[0] + (c1[0] - c0[0]) * k, g = c0[1] + (c1[1] - c0[1]) * k, b = c0[2] + (c1[2] - c0[2]) * k;
      for (let x = 0; x < FW; x++) {
        const o = (y * FW + x) * 4;
        fpx[o] = r; fpx[o + 1] = g; fpx[o + 2] = b; fpx[o + 3] = 255;
      }
    }
    for (let i = 0; i < 900; i++) {
      const a = 0.03 + Math.random() * 0.07;
      const w = 6 + Math.random() * 40;
      const x0 = Math.floor(Math.random() * FW), y0 = Math.floor(Math.random() * FH);
      const x1 = Math.min(FW, Math.floor(x0 + w)), y1 = Math.min(FH, Math.floor(y0 + w * 0.5));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * FW + x) * 4;
          fpx[o] = fpx[o] * (1 - a) + 90 * a;
          fpx[o + 1] = fpx[o + 1] * (1 - a) + 60 * a;
          fpx[o + 2] = fpx[o + 2] * (1 - a) + 190 * a;
        }
      }
    }
    const earthTex = texFromPixels(fpx, FW, FH);
    const mkTex = texFromPixels(sp, 128, 128);
    const mkTexHot = texFromPixels(spHot, 128, 128);
    let realMapLoaded = false;

    // ─── shaders ───────────────────────────────────────────────────────────
    // Earth: r128 Blinn-Phong, spec §6 verbatim. Lights are world-fixed; the
    // camera is unrotated at (0,0,zoom), so view = world - (0,0,zoom).
    const earthProg = compile(
      `precision highp float;
      attribute vec3 position; attribute vec2 uv;
      uniform mat4 uProjM; uniform mat3 uRot; uniform float uZoom;
      varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
      void main(){
        vec3 p = uRot * position;
        vec3 vp = vec3(p.x, p.y, p.z - uZoom);
        vUv = uv; vN = uRot * position; vPos = vp;
        gl_Position = uProjM * vec4(vp, 1.0);
      }`,
      `precision highp float;
      uniform sampler2D uMap; uniform float uZoom;
      varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
      void main(){
        vec3 texel = texture2D(uMap, vUv).rgb;
        vec3 emissive = 0.85 * texel;
        vec3 indirect = vec3(10.0,6.0,32.0)/255.0 * 3.0;
        vec3 N = normalize(vN);
        vec3 V = normalize(-vPos);
        vec3 spec = vec3(58.0,30.0,144.0)/255.0;
        vec3 outD = vec3(0.0); vec3 outS = vec3(0.0);
        // sun: directional, world L = (5,2,4)/len, atten 1
        {
          vec3 L = vec3(0.745356, 0.298142, 0.596285);
          vec3 lc = vec3(212.0,168.0,76.0)/255.0 * 1.8;
          float dNL = max(dot(N, L), 0.0);
          outD += dNL * lc * texel;
          vec3 H = normalize(L + V);
          float dNH = max(dot(N, H), 0.0);
          float dVH = max(dot(V, H), 0.0);
          vec3 F = spec + (1.0 - spec) * exp2((-5.55473 * dVH - 6.98316) * dVH);
          float GD = 0.25 * (18.0 * 0.5 + 1.0) * pow(dNH, 18.0);
          outS += dNL * lc * F * GD;
        }
        // rim point light at world (-4,-2,-5) -> view (-4,-2,-5-uZoom)
        {
          vec3 lp = vec3(-4.0, -2.0, -5.0 - uZoom);
          vec3 toL = lp - vPos;
          float dist = length(toL);
          vec3 L = toL / dist;
          float atten = clamp(1.0 - dist / 100.0, 0.0, 1.0);
          vec3 lc = vec3(91.0,33.0,212.0)/255.0 * 2.0 * atten;
          float dNL = max(dot(N, L), 0.0);
          outD += dNL * lc * texel;
          vec3 H = normalize(L + V);
          float dNH = max(dot(N, H), 0.0);
          float dVH = max(dot(V, H), 0.0);
          vec3 F = spec + (1.0 - spec) * exp2((-5.55473 * dVH - 6.98316) * dVH);
          float GD = 0.25 * (18.0 * 0.5 + 1.0) * pow(dNH, 18.0);
          outS += dNL * lc * F * GD;
        }
        gl_FragColor = vec4(emissive + indirect * texel + outD + outS, 1.0);
      }`,
    );
    // Atmosphere: BackSide shell (front-face culling, FLIPPED normals - the
    // verifier's correction: three's FLIP_SIDED negates them), opacity .12,
    // analytic planet occlusion instead of depth (spec §7).
    const atmoProg = compile(
      `precision highp float;
      attribute vec3 position;
      uniform mat4 uProjM; uniform float uZoom;
      varying vec3 vN; varying vec3 vPos;
      void main(){
        vec3 vp = vec3(position.x, position.y, position.z - uZoom);
        vN = -normalize(position);   // BackSide: flipped
        vPos = vp;
        gl_Position = uProjM * vec4(vp, 1.0);
      }`,
      `precision highp float;
      uniform float uZoom;
      varying vec3 vN; varying vec3 vPos;
      void main(){
        // ray from camera through this fragment vs the unit planet
        vec3 uCtr = vec3(0.0, 0.0, -uZoom);
        vec3 d = normalize(vPos);
        float b = dot(d, uCtr);
        float c = dot(uCtr, uCtr) - 1.0;
        if (b * b - c > 0.0) discard;
        vec3 texel = vec3(59.0,30.0,138.0)/255.0;   // diffuse color
        vec3 emissive = vec3(26.0,8.0,64.0)/255.0;
        vec3 indirect = vec3(10.0,6.0,32.0)/255.0 * 3.0;
        vec3 N = normalize(vN);
        vec3 V = normalize(-vPos);
        vec3 spec = vec3(17.0,17.0,17.0)/255.0;
        vec3 outD = vec3(0.0); vec3 outS = vec3(0.0);
        {
          vec3 L = vec3(0.745356, 0.298142, 0.596285);
          vec3 lc = vec3(212.0,168.0,76.0)/255.0 * 1.8;
          float dNL = max(dot(N, L), 0.0);
          outD += dNL * lc * texel;
          vec3 H = normalize(L + V);
          float dNH = max(dot(N, H), 0.0);
          float dVH = max(dot(V, H), 0.0);
          vec3 F = spec + (1.0 - spec) * exp2((-5.55473 * dVH - 6.98316) * dVH);
          float GD = 0.25 * (30.0 * 0.5 + 1.0) * pow(dNH, 30.0);
          outS += dNL * lc * F * GD;
        }
        {
          vec3 lp = vec3(-4.0, -2.0, -5.0 - uZoom);
          vec3 toL = lp - vPos;
          float dist = length(toL);
          vec3 L = toL / dist;
          float atten = clamp(1.0 - dist / 100.0, 0.0, 1.0);
          vec3 lc = vec3(91.0,33.0,212.0)/255.0 * 2.0 * atten;
          float dNL = max(dot(N, L), 0.0);
          outD += dNL * lc * texel;
          vec3 H = normalize(L + V);
          float dNH = max(dot(N, H), 0.0);
          float dVH = max(dot(V, H), 0.0);
          vec3 F = spec + (1.0 - spec) * exp2((-5.55473 * dVH - 6.98316) * dVH);
          float GD = 0.25 * (30.0 * 0.5 + 1.0) * pow(dNH, 30.0);
          outS += dNL * lc * F * GD;
        }
        gl_FragColor = vec4(emissive + indirect * texel + outD + outS, 0.12);
      }`,
    );
    // Stars: three PointsMaterial - unlit squares, size attenuation (spec §4).
    const starProg = compile(
      `precision highp float;
      attribute vec3 position;
      uniform mat4 uProjM; uniform float uZoom; uniform float uSize; uniform float uScale;
      void main(){
        vec3 vp = vec3(position.x, position.y, position.z - uZoom);
        gl_Position = uProjM * vec4(vp, 1.0);
        gl_PointSize = uSize * uScale / max(0.0001, -vp.z);
      }`,
      `precision highp float;
      uniform vec3 uColor;
      void main(){ gl_FragColor = vec4(uColor, 1.0); }`,
    );
    // Markers: spec §8 shaders, hot flag via uniform index compare.
    const mkProg = compile(
      `precision highp float;
      attribute vec3 position; attribute float aIdx;
      uniform mat4 uProjM; uniform mat3 uRot; uniform float uZoom;
      uniform float uPt; uniform float uProj; uniform float uHot;
      varying float vHot; varying float vVis;
      void main(){
        vec3 p = uRot * position;
        vec3 vp = vec3(p.x, p.y, p.z - uZoom);
        vec3 n = normalize(uRot * position);
        vVis = smoothstep(0.0, 0.15, dot(n, normalize(-vp)));
        float hot = abs(aIdx - uHot) < 0.5 ? 1.0 : 0.0;
        vHot = hot;
        float s = hot > 0.5 ? 0.08 : 0.05 + 0.01 * sin(uPt + aIdx * 0.3);
        gl_Position = uProjM * vec4(vp, 1.0);
        gl_PointSize = s * uProj / max(0.0001, -vp.z);
      }`,
      `precision highp float;
      uniform sampler2D uMap; uniform sampler2D uMapHot;
      varying float vHot; varying float vVis;
      void main(){
        if (vVis < 0.01) discard;
        vec2 uv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
        vec4 t = vHot > 0.5 ? texture2D(uMapHot, uv) : texture2D(uMap, uv);
        gl_FragColor = vec4(t.rgb, t.a * (vHot > 0.5 ? 1.0 : 0.85) * vVis);
      }`,
    );

    // uniform/attrib locations
    const eU = {
      proj: gl.getUniformLocation(earthProg, 'uProjM'), rot: gl.getUniformLocation(earthProg, 'uRot'),
      zoom: gl.getUniformLocation(earthProg, 'uZoom'), map: gl.getUniformLocation(earthProg, 'uMap'),
      pos: gl.getAttribLocation(earthProg, 'position'), uv: gl.getAttribLocation(earthProg, 'uv'),
    };
    const aU = {
      proj: gl.getUniformLocation(atmoProg, 'uProjM'), zoom: gl.getUniformLocation(atmoProg, 'uZoom'),
      pos: gl.getAttribLocation(atmoProg, 'position'),
    };
    const sU = {
      proj: gl.getUniformLocation(starProg, 'uProjM'), zoom: gl.getUniformLocation(starProg, 'uZoom'),
      size: gl.getUniformLocation(starProg, 'uSize'), scale: gl.getUniformLocation(starProg, 'uScale'),
      color: gl.getUniformLocation(starProg, 'uColor'), pos: gl.getAttribLocation(starProg, 'position'),
    };
    const mU = {
      proj: gl.getUniformLocation(mkProg, 'uProjM'), rot: gl.getUniformLocation(mkProg, 'uRot'),
      zoom: gl.getUniformLocation(mkProg, 'uZoom'), pt: gl.getUniformLocation(mkProg, 'uPt'),
      uproj: gl.getUniformLocation(mkProg, 'uProj'), hot: gl.getUniformLocation(mkProg, 'uHot'),
      map: gl.getUniformLocation(mkProg, 'uMap'), maphot: gl.getUniformLocation(mkProg, 'uMapHot'),
      pos: gl.getAttribLocation(mkProg, 'position'), idx: gl.getAttribLocation(mkProg, 'aIdx'),
    };

    // ─── projection (fov 46, near .1, far 1000, aspect viewW/viewH) ────────
    const fov = (46 * Math.PI) / 180;
    const aspect = vw / Math.max(1, vh);
    const f = 1 / Math.tan(fov / 2);
    const near = 0.1, far = 1000;
    const projM = new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0,
    ]);
    const uProjMarkers = bufH / (2 * Math.tan((46 * Math.PI) / 360)); // full buffer height, per spec+verifier
    const starScale = renderH * 0.5;

    // ─── animation state (spec §9) ─────────────────────────────────────────
    let cRotX = 0, cRotY = 0, globeZoom = 2.9, pt = 0, gT = 0, gLast = 0;
    let tRotX = 0, tRotY = 0, tZoom = 2.9, rVelX = 0, rVelY = 0;
    const rot = new Float32Array(9);

    const loop = (ts: number) => {
      'worklet';
      if (sv.canceledSV.value === 1) return;
      (globalThis as any).requestAnimationFrame(loop);
      if (sv.runningSV.value !== 1) { gT = 0; return; }   // hold the last frame

      // consume gesture deltas - same thread as the writers, race-free
      const dY = sv.accY.value; if (dY !== 0) { sv.accY.value = 0; tRotY += dY; }
      const dX = sv.accX.value; if (dX !== 0) { sv.accX.value = 0; tRotX = Math.max(-1.3, Math.min(1.3, tRotX + dX)); }
      const dZ = sv.accZoom.value; if (dZ !== 0) { sv.accZoom.value = 0; tZoom = Math.max(1.5, Math.min(4, tZoom + dZ)); }
      const drag = sv.dragSV.value === 1;
      if (drag) { rVelX = sv.velX.value; rVelY = sv.velY.value; }

      // real-map upload, once, the moment JS has resolved the uri - native
      // JPEG decode on this thread's GL queue, zero JS-thread bytes
      if (!realMapLoaded && sv.earthUriSV.value !== '') {
        realMapLoaded = true;
        gl.bindTexture(gl.TEXTURE_2D, earthTex);
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, { localUri: sv.earthUriSV.value } as any);
          gl.generateMipmap(gl.TEXTURE_2D);
          const ext = gl.getExtension('EXT_texture_filter_anisotropic');
          if (ext) {
            const maxA = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
            gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, maxA);
          }
          sv.texStateSV.value = 1;
        } catch (e) {
          // fallback stays; nothing breaks
        }
      }

      // idle governor ~30fps (spec §9)
      const busy = drag || Math.abs(rVelX) > 1e-4 || Math.abs(rVelY) > 1e-4 || Math.abs(tZoom - globeZoom) > 1e-3;
      if (!busy && ts - gLast < 28) return;
      gLast = ts;
      const dt = Math.min(3, Math.max(0.2, gT ? (ts - gT) / 16.667 : 1));
      gT = ts;
      pt += 0.034 * dt;
      if (!drag) {
        tRotY += 0.0015 * dt;
        const d = Math.pow(0.92, dt);
        rVelX *= d; rVelY *= d;
        tRotX = Math.max(-1.3, Math.min(1.3, tRotX + rVelX * 0.04 * dt));
        tRotY += rVelY * 0.04 * dt;
      }
      const eK = (k: number) => 1 - Math.pow(1 - k, dt);
      cRotX += (tRotX - cRotX) * eK(0.18);
      cRotY += (tRotY - cRotY) * eK(0.18);
      globeZoom += (tZoom - globeZoom) * eK(0.15);
      sv.rotXSV.value = cRotX; sv.rotYSV.value = cRotY; sv.zoomSV.value = globeZoom;

      // R = Rx(cRotX) · Ry(cRotY)  (three Euler 'XYZ' applied to the globe)
      const cx = Math.cos(cRotX), sx = Math.sin(cRotX);
      const cy = Math.cos(cRotY), sy = Math.sin(cRotY);
      // column-major mat3 of Rx*Ry
      rot[0] = cy;        rot[1] = sx * sy;   rot[2] = -cx * sy;
      rot[3] = 0;         rot[4] = cx;        rot[5] = sx;
      rot[6] = sy;        rot[7] = -sx * cy;  rot[8] = cx * cy;

      // ─── draw ────────────────────────────────────────────────────────────
      gl.viewport(0, 0, renderW, renderH);
      gl.clearColor(4 / 255, 2 / 255, 12 / 255, 1);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // 1. stars (opaque, behind everything by draw order)
      gl.useProgram(starProg);
      gl.uniformMatrix4fv(sU.proj, false, projM);
      gl.uniform1f(sU.zoom, globeZoom);
      gl.uniform1f(sU.scale, starScale);
      gl.disable(gl.BLEND);
      gl.enableVertexAttribArray(sU.pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, stars1);
      gl.vertexAttribPointer(sU.pos, 3, gl.FLOAT, false, 0, 0);
      gl.uniform1f(sU.size, 0.04);
      gl.uniform3f(sU.color, 13 / 255, 8 / 255, 53 / 255);
      gl.drawArrays(gl.POINTS, 0, 3000);
      gl.bindBuffer(gl.ARRAY_BUFFER, stars2);
      gl.vertexAttribPointer(sU.pos, 3, gl.FLOAT, false, 0, 0);
      gl.uniform1f(sU.size, 0.07);
      gl.uniform3f(sU.color, 30 / 255, 18 / 255, 112 / 255);
      gl.drawArrays(gl.POINTS, 0, 400);
      gl.disableVertexAttribArray(sU.pos);

      // 2. earth (opaque; overdraws stars behind it - the depth-free layering)
      gl.useProgram(earthProg);
      gl.uniformMatrix4fv(eU.proj, false, projM);
      gl.uniformMatrix3fv(eU.rot, false, rot);
      gl.uniform1f(eU.zoom, globeZoom);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, earthTex);
      gl.uniform1i(eU.map, 0);
      gl.enableVertexAttribArray(eU.pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, sphereVB);
      gl.vertexAttribPointer(eU.pos, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(eU.uv);
      gl.bindBuffer(gl.ARRAY_BUFFER, sphereUVB);
      gl.vertexAttribPointer(eU.uv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereIB);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.drawElements(gl.TRIANGLES, sphereIdxCount, gl.UNSIGNED_SHORT, 0);
      gl.disableVertexAttribArray(eU.pos);
      gl.disableVertexAttribArray(eU.uv);

      // 3. atmosphere (BackSide: cull FRONT; alpha blend; analytic occlusion)
      gl.useProgram(atmoProg);
      gl.uniformMatrix4fv(aU.proj, false, projM);
      gl.uniform1f(aU.zoom, globeZoom);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.cullFace(gl.FRONT);
      gl.enableVertexAttribArray(aU.pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, atmoVB);
      gl.vertexAttribPointer(aU.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, atmoIB);
      gl.drawElements(gl.TRIANGLES, atmoIdxCount, gl.UNSIGNED_SHORT, 0);
      gl.disableVertexAttribArray(aU.pos);
      gl.cullFace(gl.BACK);
      gl.disable(gl.CULL_FACE);

      // 4. markers (alpha blend, no depth, facing fade)
      gl.useProgram(mkProg);
      gl.uniformMatrix4fv(mU.proj, false, projM);
      gl.uniformMatrix3fv(mU.rot, false, rot);
      gl.uniform1f(mU.zoom, globeZoom);
      gl.uniform1f(mU.pt, pt);
      gl.uniform1f(mU.uproj, uProjMarkers);
      gl.uniform1f(mU.hot, sv.hotSV.value);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, mkTex);
      gl.uniform1i(mU.map, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, mkTexHot);
      gl.uniform1i(mU.maphot, 1);
      gl.enableVertexAttribArray(mU.pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, mkVB);
      gl.vertexAttribPointer(mU.pos, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(mU.idx);
      gl.bindBuffer(gl.ARRAY_BUFFER, mkIdxB);
      gl.vertexAttribPointer(mU.idx, 1, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, mkN);
      gl.disableVertexAttribArray(mU.pos);
      gl.disableVertexAttribArray(mU.idx);
      gl.disable(gl.BLEND);

      gl.flush();
      gl.endFrameEXP();
      sv.lastFrameSV.value = ts;
    };
    (globalThis as any).requestAnimationFrame(loop);
  })(exglCtxId, markers, markerCount, sprite, spriteHot, viewW, viewH);
}

/**
 * Screen-space marker picking, on JS, using the rotation the worklet reports.
 * The scene's exact algorithm (spec §8): nearest front-facing marker within
 * 16pt of the tap; -1 for none.
 */
export function pickCountry(
  countries: Country[],
  x: number,
  y: number,
  viewW: number,
  viewH: number,
  rotX: number,
  rotY: number,
  zoom: number,
): number {
  const fov = (46 * Math.PI) / 180;
  const f = 1 / Math.tan(fov / 2);
  const aspect = viewW / Math.max(1, viewH);
  const cx = Math.cos(rotX), sx = Math.sin(rotX);
  const cy = Math.cos(rotY), sy = Math.sin(rotY);
  let best = -1;
  let bestD = 256; // 16pt squared
  for (let i = 0; i < countries.length; i++) {
    const c = countries[i];
    const phi = ((90 - c.lat) * Math.PI) / 180;
    const th = ((c.lon + 180) * Math.PI) / 180;
    const px = -1.02 * Math.sin(phi) * Math.cos(th);
    const py = 1.02 * Math.cos(phi);
    const pz = 1.02 * Math.sin(phi) * Math.sin(th);
    // R = Rx·Ry (match the shader)
    const ryx = cy * px + sy * pz;
    const ryz = -sy * px + cy * pz;
    const wx = ryx;
    const wy = cx * py - sx * ryz;
    const wz = sx * py + cx * ryz;
    // facing: reject the far hemisphere
    const camx = 0, camy = 0, camz = zoom;
    const tox = camx - wx, toy = camy - wy, toz = camz - wz;
    const tl = Math.hypot(tox, toy, toz) || 1;
    const nl = Math.hypot(wx, wy, wz) || 1;
    if ((wx * tox + wy * toy + wz * toz) / (tl * nl) < 0.05) continue;
    // project
    const vz = wz - zoom;
    if (vz >= 0) continue;
    const ndcX = ((f / aspect) * wx) / -vz;
    const ndcY = (f * wy) / -vz;
    const sxp = ((ndcX + 1) / 2) * viewW;
    const syp = ((1 - ndcY) / 2) * viewH;
    const d = (sxp - x) * (sxp - x) + (syp - y) * (syp - y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
