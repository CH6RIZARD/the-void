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
import { fallbackEarthTexture, loadEarthTexture, markerTexture } from './textures';
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
  /** Raycast markers at view-space px. */
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
      antialias: true,
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
  renderer.setPixelRatio(1);
  renderer.setSize(bufW, bufH, false);
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
    sc.add(new THREE.Points(g, new THREE.PointsMaterial({ color: col, size: sz })));
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
  const markers: THREE.Sprite[] = [];
  const mT = markerTexture(false),
    mTA = markerTexture(true);
  let hov: THREE.Sprite | null = null;
  let disposed = false;

  const ll = (lat: number, lon: number, r = 1) => {
    const phi = ((90 - lat) * Math.PI) / 180,
      th = ((lon + 180) * Math.PI) / 180;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
  };

  const onEarth = (tex: THREE.Texture) => {
    if (disposed) return;
    // 72 segments on mobile: 48 left a faceted limb, 80 is invisible extra cost.
    const seg = 72;
    globe = new THREE.Mesh(
      new THREE.SphereGeometry(1, seg, seg),
      new THREE.MeshPhongMaterial({ map: tex, emissive: 0x020010, emissiveIntensity: 0.7, specular: 0x3a1e90, shininess: 18 }),
    );
    sc.add(globe);
    sc.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(1.06, 32, 32),
        new THREE.MeshPhongMaterial({ color: 0x3b1e8a, emissive: 0x1a0840, transparent: true, opacity: 0.12, side: THREE.BackSide }),
      ),
    );
    countries.forEach((c) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: mT, transparent: true, sizeAttenuation: true, opacity: 0.85, depthWrite: false }));
      sp.position.copy(ll(c.lat, c.lon, 1.02));
      sp.scale.set(0.055, 0.055, 1);
      sp.userData = c;
      globe!.add(sp);
      markers.push(sp);
    });
  };
  // The globe is always built: on texture failure it gets the local fallback.
  loadEarthTexture(gl, renderer, rawPixelStorei)
    .then(onEarth)
    .catch((e) => {
      console.warn('[globe] earth texture failed — building with the local fallback', e);
      try {
        onEarth(fallbackEarthTexture());
      } catch (err) {
        console.error('[globe] fallback build failed', err);
      }
    });

  const ray = new THREE.Raycaster();
  (ray.params as any).Sprite = { threshold: 0.05 };
  const mv = new THREE.Vector2();
  let vw = viewW,
    vh = viewH;

  const cast = (x: number, y: number) => {
    mv.x = (x / vw) * 2 - 1;
    mv.y = -(y / vh) * 2 + 1;
    ray.setFromCamera(mv, cam);
    return ray.intersectObjects(markers);
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
      markers.forEach((m, i) => {
        if (m === hov) {
          m.scale.set(0.08, 0.08, 1);
          return;
        }
        const s = 0.05 + 0.01 * Math.sin(pt + i * 0.3);
        m.scale.set(s, s, 1);
      });
      renderer.render(sc, cam);
      gl.endFrameEXP();
      return true;
    },
    hit(x, y) {
      const hits = cast(x, y);
      return hits.length ? (hits[0].object.userData as Country) : null;
    },
    hover(x, y) {
      const hits = cast(x, y);
      markers.forEach((m) => {
        if (m !== hov) {
          (m.material as THREE.SpriteMaterial).map = mT;
          (m.material as THREE.SpriteMaterial).opacity = 0.85;
        }
      });
      if (hits.length) {
        hov = hits[0].object as THREE.Sprite;
        (hov.material as THREE.SpriteMaterial).map = mTA;
        (hov.material as THREE.SpriteMaterial).opacity = 1;
        return hov.userData as Country;
      }
      if (hov) {
        (hov.material as THREE.SpriteMaterial).map = mT;
        (hov.material as THREE.SpriteMaterial).opacity = 0.85;
      }
      hov = null;
      return null;
    },
    clearHover() {
      if (hov) {
        (hov.material as THREE.SpriteMaterial).map = mT;
        (hov.material as THREE.SpriteMaterial).opacity = 0.85;
      }
      hov = null;
    },
    resize(bw, bh, w, h) {
      vw = w;
      vh = h;
      canvas.width = bw;
      canvas.height = bh;
      renderer.setSize(bw, bh, false);
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
    },
    dispose() {
      disposed = true;
      try {
        renderer.dispose();
      } catch {}
    },
  };
}
