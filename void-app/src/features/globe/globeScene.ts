// The globe scene — a line-by-line port of initGlobe() / animate() in void2-final.html.
// Pure three.js + an expo-gl context; no React in here.
//
// Look parity with the web (three r128, legacy lights, no colour management):
//   • three ≥ r155 made lights physically based and turned colour management on. To
//     render the SAME pixels, ColorManagement is disabled, output is linear (what r128
//     wrote), and every light intensity is multiplied by π (r128 legacy mode applied
//     that π inside the shader). The r128 point light used decay=1 with a 100 cutoff
//     (≈0.933 at the globe); modern range attenuation is emulated with decay=0 × 0.933.
//   • On three < r155 the original numbers are used unchanged.
import * as THREE from 'three';
import { earthPixelsCached, fallbackEarthTexture, loadEarthTexture, markerTexture } from './textures';
import type { Country } from '../live/core';

const REV = parseInt(String((THREE as any).REVISION), 10) || 0;
const LEGACY = REV > 0 && REV < 155;
const LI = LEGACY ? 1 : Math.PI;

export interface GlobeInput {
  drag: boolean;
  tRotX: number;
  tRotY: number;
  rVelX: number;
  rVelY: number;
  tZoom: number;
}

export interface GlobeScene {
  input: GlobeInput;
  /** Advance one frame. Returns false when the idle governor skipped the frame. */
  frame(ts: number): boolean;
  /** The marker at view-space px (nearest front-facing one within 16pt). */
  hit(x: number, y: number): Country | null;
  /** web handleHover(): highlight + return the hovered country (null clears). */
  hover(x: number, y: number): Country | null;
  clearHover(): void;
  resize(bufferW: number, bufferH: number, viewW: number, viewH: number): void;
  dispose(): void;
}

export function createGlobeScene(gl: any, countries: Country[], viewW: number, viewH: number): GlobeScene {
  // ── expo-gl shims ─────────────────────────────────────────────────────────
  const rawPixelStorei = gl.pixelStorei.bind(gl);
  const allowedPixelStore = new Set([gl.UNPACK_FLIP_Y_WEBGL, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, gl.UNPACK_ALIGNMENT, gl.PACK_ALIGNMENT]);
  // three ≥ r1xx sets UNPACK_COLORSPACE_CONVERSION_WEBGL etc., which expo-gl logs as unsupported.
  gl.pixelStorei = (p: number, v: any) => {
    if (allowedPixelStore.has(p)) rawPixelStorei(p, v);
  };
  const bufW = gl.drawingBufferWidth,
    bufH = gl.drawingBufferHeight;
  const canvas: any = {
    width: bufW,
    height: bufH,
    style: {},
    clientWidth: bufW,
    clientHeight: bufH,
    addEventListener: () => {},
    removeEventListener: () => {},
    getContext: () => gl,
  };

  if (!LEGACY) {
    try {
      (THREE as any).ColorManagement.enabled = false;
    } catch {}
  }

  // three ≥ r163 refuses `context instanceof WebGLRenderingContext` (WebGL1). expo-gl's
  // ES3 context can satisfy that check through its prototype chain even though it IS a
  // WebGL2-style context, so the global is hidden for the duration of the constructor.
  const G = globalThis as any;
  const savedGL1 = G.WebGLRenderingContext;
  let hidGL1 = false;
  try {
    if (savedGL1 && gl instanceof savedGL1 && !LEGACY) {
      G.WebGLRenderingContext = function NotWebGL1() {};
      hidGL1 = true;
    }
  } catch {}
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl,
      // MSAA on: without it the sphere silhouette and marker edges stair-step (b50feb6).
      // expo-gl: iOS honours GLView msaaSamples; Android contexts have no MSAA.
      // NO MSAA.
      //
      // Multisampling resolves every pixel several times, and on a mobile GPU it
      // is usually the most expensive setting in the renderer. This globe shares
      // its GPU with up to six video decoders on the SAME SCREEN - the live wall
      // is directly underneath it - so it is competing for exactly the bandwidth
      // MSAA eats.
      //
      // What it buys is a smoother edge on one circle against a dark background.
      // What it costs is the frame rate of everything. The map itself is full
      // resolution and stays sharp either way.
      antialias: false,
      powerPreference: 'high-performance',
      // highp everywhere: mediump banded the terminator on a lit sphere (b50feb6).
      precision: 'highp',
    } as any);
  } finally {
    if (hidGL1) G.WebGLRenderingContext = savedGL1;
  }
  if (!LEGACY) {
    try {
      (renderer as any).outputColorSpace = (THREE as any).LinearSRGBColorSpace;
    } catch {}
  }
  // The drawing buffer IS the device-pixel raster, so pixelRatio is 1 and sizes are in
  // buffer px. PointsMaterial sizes then come out identical in CSS px to the web.
  // AT WHAT RESOLUTION IS THIS ACTUALLY DRAWN?
  // setPixelRatio(1) is right only if expo-gl's drawing buffer is already in
  // device pixels. If it hands back layout pixels instead, the globe is being
  // drawn at a fraction of the screen's real resolution and then stretched,
  // which would look exactly like the softness being reported - and no amount
  // of texture work would fix it. This screen has been diagnosed by guesswork
  // twice; it can say what it is doing.
  // AND NOT EVERY DEVICE PIXEL.
  //
  // The drawing buffer is the full device-pixel raster: on a 3x phone that is
  // about nine times the pixels of a 1x one, every frame, for a sphere that is
  // mostly smooth gradient. Capping the raster at 2x cuts the shaded pixels by
  // more than half and is still finer than the map has detail to fill.
  //
  // The scene is sized in BUFFER pixels (PointsMaterial sizes depend on it), so
  // the cap is applied by rendering smaller and letting the surface scale - not
  // by changing the sizes the scene is built with.
  const RASTER_CAP = 2;
  const density = Math.max(1, bufW / Math.max(1, viewW));
  const rasterScale = density > RASTER_CAP ? RASTER_CAP / density : 1;
  renderer.setPixelRatio(1);
  renderer.setSize(Math.round(bufW * rasterScale), Math.round(bufH * rasterScale), false);
  try {
    console.warn('[globe] raster ' + Math.round(bufW * rasterScale) + 'x' + Math.round(bufH * rasterScale) + ' (density ' + density.toFixed(2) + ', scale ' + rasterScale.toFixed(2) + ')');
  } catch {}
  try {
    console.warn('[globe] drawing buffer ' + bufW + 'x' + bufH);
  } catch {}
  renderer.setClearColor(0x04020c, 1);

  const sc = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(46, viewW / Math.max(1, viewH), 0.1, 1000);
  let globeZoom = 2.9;
  cam.position.z = globeZoom;

  // Star fields.
  ([[3000, 0.04, 0x0d0835], [400, 0.07, 0x1e1270]] as const).forEach(([n, sz, col]) => {
    const g = new THREE.BufferGeometry(),
      p = new Float32Array(n * 3);
    for (let i = 0; i < p.length; i++) p[i] = (Math.random() - 0.5) * 200;
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: col, size: sz }));
    stars.renderOrder = 0; // drawn first: the globe paints over them without a depth test
    sc.add(stars);
  });
  sc.add(new THREE.AmbientLight(0x0a0620, 3 * LI));
  const sun = new THREE.DirectionalLight(0xd4a84c, 1.8 * LI);
  sun.position.set(5, 2, 4);
  sc.add(sun);
  const rim = LEGACY ? new THREE.PointLight(0x5b21d4, 2, 100) : new THREE.PointLight(0x5b21d4, 2 * LI * 0.933, 100, 0);
  rim.position.set(-4, -2, -5);
  sc.add(rim);

  const input: GlobeInput = { drag: false, tRotX: 0, tRotY: 0, rVelX: 0, rVelY: 0, tZoom: 2.9 };
  let cRotX = 0,
    cRotY = 0,
    pt = 0;
  let globe: THREE.Mesh | null = null;
  const mT = markerTexture(false),
    mTA = markerTexture(true);
  let disposed = false;

  const ll = (lat: number, lon: number, r = 1) => {
    const phi = ((90 - lat) * Math.PI) / 180,
      th = ((lon + 180) * Math.PI) / 180;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
  };

  // The sphere is built at once on the local fallback, and the real map is swapped in
  // when it is ready, so the globe never waits on the texture to appear.
  let earthMat: THREE.MeshPhongMaterial;
  let markerGeo: THREE.BufferGeometry | null = null;
  let markerMat: THREE.ShaderMaterial | null = null;
  const markerPos: THREE.Vector3[] = [];
  const atmoCenter = { value: new THREE.Vector3(0, 0, -globeZoom) };
  const buildGlobe = (tex: THREE.Texture) => {
    // 72 segments on mobile: 48 left a faceted limb, 80 is invisible extra cost.
    const seg = 72;
    // A NIGHT MAP IS NOT A DIFFUSE TEXTURE.
    // The device confirms the map is uploaded and applied - "[globe] earth upload:
    // direct GL path, error 0 (accepted)", "earth texture applied to the sphere" -
    // and the globe still came out a dark disc with a magenta blob and no
    // continents. The texture was never the problem. On a Phong material `map` is
    // the DIFFUSE colour, visible only where a light falls on it, and the lights
    // here are a dim ambient, a gold directional and a purple point. The point
    // light made the blob; everywhere else a picture that is almost entirely black
    // was multiplied by almost no light, which is black.
    //
    // Earth at night is lit from the ground up. The same texture drives emission
    // now, so cities and coastlines carry their own brightness as they do in the
    // reference, and the three lights add shape on top of a planet that is already
    // visible rather than being the only reason anything can be seen at all.
    earthMat = new THREE.MeshPhongMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: 0xffffff,
      emissiveIntensity: 0.85,
      specular: 0x3a1e90,
      shininess: 18,
    });
    globe = new THREE.Mesh(new THREE.SphereGeometry(1, seg, seg), earthMat);
    globe.renderOrder = 1;
    sc.add(globe);
    // DEPTH-INDEPENDENT (test phone, 2026-09): expo-gl on the Helio P35 has no working
    // depth test, so nothing here may rely on the depth buffer to hide what is behind
    // the planet. The atmosphere is a BackSide shell whose far half sits behind the
    // globe; it now drops every fragment whose view ray hits the planet (analytic
    // ray/sphere test, as the onboarding globe does) - exactly what the depth test
    // removed. Same Phong material, same look.
    const atmoMat = new THREE.MeshPhongMaterial({ color: 0x3b1e8a, emissive: 0x1a0840, transparent: true, opacity: 0.12, side: THREE.BackSide });
    atmoMat.onBeforeCompile = (sh) => {
      sh.uniforms.uCtr = atmoCenter;
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform vec3 uCtr;\nvoid main() {')
        .replace(
          '#include <clipping_planes_fragment>',
          '{ vec3 d = normalize(-vViewPosition); float b = dot(d, uCtr); float c = dot(uCtr, uCtr) - 1.0; if (b * b - c > 0.0) discard; }\n#include <clipping_planes_fragment>',
        );
    };
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.06, 32, 32), atmoMat);
    atmo.renderOrder = 2;
    sc.add(atmo);

    // MARKERS: one Points draw call instead of one Sprite (and one draw call) per
    // country - ~205 draw calls a frame became ~6, and the per-frame JS loop that
    // rescaled all 199 sprites is now a shader uniform. Same texture, size and pulse
    // (s = 0.05 + 0.01*sin(pt + i*0.3), hovered 0.08, opacity .85 / 1). A marker on the
    // far hemisphere fades out by itself (facing test) instead of relying on depth.
    const n = countries.length;
    const pos = new Float32Array(n * 3),
      idx = new Float32Array(n),
      hot = new Float32Array(n);
    countries.forEach((c, i) => {
      const v = ll(c.lat, c.lon, 1.02);
      markerPos.push(v);
      pos.set([v.x, v.y, v.z], i * 3);
      idx[i] = i;
    });
    markerGeo = new THREE.BufferGeometry();
    markerGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    markerGeo.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
    markerGeo.setAttribute('aHot', new THREE.BufferAttribute(hot, 1));
    markerMat = new THREE.ShaderMaterial({
      uniforms: { uPt: { value: 0 }, uProj: { value: 1 }, uMap: { value: mT }, uMapHot: { value: mTA } },
      vertexShader: `attribute float aIdx; attribute float aHot; uniform float uPt; uniform float uProj;
varying float vHot; varying float vVis;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * position);
  vVis = smoothstep(0.0, 0.15, dot(n, normalize(-mv.xyz)));
  vHot = aHot;
  float s = aHot > 0.5 ? 0.08 : 0.05 + 0.01 * sin(uPt + aIdx * 0.3);
  gl_PointSize = s * uProj / -mv.z;
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: `uniform sampler2D uMap; uniform sampler2D uMapHot; varying float vHot; varying float vVis;
void main(){
  if (vVis < 0.01) discard;
  vec2 uv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
  vec4 t = vHot > 0.5 ? texture2D(uMapHot, uv) : texture2D(uMap, uv);
  gl_FragColor = vec4(t.rgb, t.a * (vHot > 0.5 ? 1.0 : 0.85) * vVis);
}`,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const pts = new THREE.Points(markerGeo, markerMat);
    pts.renderOrder = 3;
    pts.frustumCulled = false;
    globe.add(pts);
  };
  // A Sprite of world size s projects to s * (bufH / 2tan(fov/2)) / depth px; so does this.
  const projScale = () => bufH / (2 * Math.tan((cam.fov * Math.PI) / 360));
  const setHover = (i: number) => {
    const a = markerGeo?.getAttribute('aHot') as THREE.BufferAttribute | undefined;
    if (!a) return;
    const arr = a.array as Float32Array;
    arr.fill(0);
    if (i >= 0) arr[i] = 1;
    a.needsUpdate = true;
  };
  // LOGICALLY IMPOSSIBLE TO OPEN UNTEXTURED when the boot warmup has run: if
  // the decoded night map is already in cache (it is, within seconds of app
  // launch), the globe is BORN on the real map - no fallback frame exists to
  // see. The purple procedural ball can only appear on a cold sprint to this
  // tab moments after a first install, and the async swap still rescues that.
  const warm = earthPixelsCached();
  let firstTex: THREE.Texture;
  if (warm) {
    const dt = new THREE.DataTexture(warm.px, warm.w, warm.h, THREE.RGBAFormat);
    dt.colorSpace = THREE.LinearSRGBColorSpace;
    dt.magFilter = THREE.LinearFilter;
    dt.minFilter = THREE.LinearMipmapLinearFilter;
    dt.wrapS = THREE.ClampToEdgeWrapping;
    dt.wrapT = THREE.ClampToEdgeWrapping;
    dt.generateMipmaps = true;
    dt.needsUpdate = true;
    firstTex = dt;
    try { console.warn('[globe] born textured (warm cache)'); } catch {}
  } else {
    firstTex = fallbackEarthTexture();
  }
  const fallback = firstTex;
  buildGlobe(firstTex);
  // On texture failure the globe simply keeps the fallback, like the web's onError.
  if (!warm) loadEarthTexture(gl, renderer, rawPixelStorei)
    .then((tex) => {
      if (disposed) {
        try {
          console.warn('[globe] earth texture arrived after the scene was disposed - dropped');
        } catch {}
        return;
      }
      earthMat.map = tex;
      // Both, always: the emissive map is what makes the night side visible, so a
      // swap that updated only `map` would put the globe straight back in the dark.
      earthMat.emissiveMap = tex;
      earthMat.needsUpdate = true;
      fallback.dispose();
      try {
        console.warn('[globe] earth texture applied to the sphere');
      } catch {}
    })
    .catch((e) => {
      console.warn('[globe] earth texture failed — keeping the local fallback', e);
    });

  let vw = viewW,
    vh = viewH;

  // Tap picking in screen space: the nearest front-facing marker within 16pt of the
  // touch (about what the old sprite raycast threshold of 0.05 world units covered).
  const tmp = new THREE.Vector3(),
    nrm = new THREE.Vector3(),
    toCam = new THREE.Vector3();
  const pick = (x: number, y: number): number => {
    if (!globe) return -1;
    globe.updateMatrixWorld();
    let best = -1,
      bestD = 16 * 16;
    for (let i = 0; i < markerPos.length; i++) {
      tmp.copy(markerPos[i]).applyMatrix4(globe.matrixWorld);
      nrm.copy(tmp).normalize();
      toCam.copy(cam.position).sub(tmp).normalize();
      if (nrm.dot(toCam) < 0.05) continue; // far side
      tmp.project(cam);
      const sx = ((tmp.x + 1) / 2) * vw,
        sy = ((1 - tmp.y) / 2) * vh;
      const d = (sx - x) * (sx - x) + (sy - y) * (sy - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  let gT = 0,
    gLast = 0;

  return {
    input,
    frame(ts: number) {
      if (disposed) return false;
      const now = ts;
      // IDLE FRAME GOVERNOR: ~30fps while drifting, full rate while interacting.
      const busy = input.drag || Math.abs(input.rVelX) > 1e-4 || Math.abs(input.rVelY) > 1e-4 || Math.abs(input.tZoom - globeZoom) > 1e-3;
      if (!busy && now - gLast < 28) return false;
      gLast = now;
      // dt normalised to 60fps, clamped so a resume never teleports the globe.
      const dt = Math.max(0.2, Math.min(3, gT ? (now - gT) / 16.667 : 1));
      gT = now;
      pt += 0.034 * dt;
      if (!input.drag) {
        input.tRotY += 0.0015 * dt;
        const d = Math.pow(0.92, dt);
        input.rVelX *= d;
        input.rVelY *= d;
        input.tRotX += input.rVelX * 0.04 * dt;
        input.tRotY += input.rVelY * 0.04 * dt;
      }
      const e = (k: number) => 1 - Math.pow(1 - k, dt);
      cRotX += (input.tRotX - cRotX) * e(0.18);
      cRotY += (input.tRotY - cRotY) * e(0.18);
      globeZoom += (input.tZoom - globeZoom) * e(0.15);
      cam.position.z = globeZoom;
      if (globe) {
        globe.rotation.x = cRotX;
        globe.rotation.y = cRotY;
      }
      atmoCenter.value.set(0, 0, -globeZoom);
      if (markerMat) {
        markerMat.uniforms.uPt.value = pt;
        markerMat.uniforms.uProj.value = projScale();
      }
      renderer.render(sc, cam);
      gl.endFrameEXP();
      return true;
    },
    hit(x, y) {
      const i = pick(x, y);
      return i >= 0 ? countries[i] : null;
    },
    hover(x, y) {
      const i = pick(x, y);
      setHover(i);
      return i >= 0 ? countries[i] : null;
    },
    clearHover() {
      setHover(-1);
    },
    resize(bw, bh, w, h) {
      vw = w;
      vh = h;
      canvas.width = bw;
      canvas.height = bh;
      // The same cap as the first sizing, or a rotation hands the raster back to
      // full device pixels and the frame rate with it.
      const d = Math.max(1, bw / Math.max(1, w));
      const sc = d > RASTER_CAP ? RASTER_CAP / d : 1;
      renderer.setSize(Math.round(bw * sc), Math.round(bh * sc), false);
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
    },
    dispose() {
      disposed = true;
      try {
        markerGeo?.dispose();
        markerMat?.dispose();
        mT.dispose();
        mTA.dispose();
        renderer.dispose();
      } catch {}
    },
  };
}
