// Runs in headless Chrome (render.mjs). Builds THE character from the app's own voidFigure.ts and bakes:
//   window.bakeFall(id)  -> one pull-to-refresh fall: sprite sheet (webp data URL) + per-frame path
//   window.bakeEyes()    -> just the eyes and brows, flat (brand marks)
// THE FALL IS THE USER'S SAVED LOOK: every variant falls with one of LOADING_SETS (the Void Loading Lab's saved
// sets: motion mix, speed, loop phase, pitch / yaw / roll), with the loading screen's sparkles rising past him.
// One variant per saved set; he stays in place (CameraFall.tsx does the blob, the band, the fades). Each sheet is
// one seamless lap of his falling loop, frame order, `cols` per row.
import './cm';
import * as THREE from 'three';
import { applyPose, buildFigure, M, PERIOD, posed, viewLock, type Rig } from '../../src/features/loading/voidFigure';
import { LOADING_SETS, LOADING_THEMES, type LoadingSet } from '../../src/features/loading/arrivals';

const FPSF = 30, PXF = 144, CELL_DP = 56;
const TAU = Math.PI * 2, d2r = THREE.MathUtils.degToRad;
const sm = (x: number) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

const canvas = document.createElement('canvas');
canvas.width = canvas.height = 512;
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // as the app's GL view draws it
const scene = new THREE.Scene();
// lights: the lab's studio look (LoadingScreen.tsx)
scene.add(new THREE.HemisphereLight(0xffffff, 0x221a33, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-4, -6, 7); scene.add(key);
const rimL = new THREE.DirectionalLight(0xffbe5c, 0.6); rimL.position.set(-5, 4, 5); scene.add(rimL);
const rimR = new THREE.DirectionalLight(0xffc76b, 0.6); rimR.position.set(5, 4, 3); scene.add(rimR);
const rig: Rig = buildFigure(scene);
const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 100);
camera.up.set(0, 0, 1); camera.position.set(0, -10, 0); camera.lookAt(0, 0, 0);
const MID = new THREE.Vector3(0, 0, -0.55); // the figure's middle in root space: he is framed about this
const tmp = new THREE.Vector3();

/** Pose him exactly as LoadingScreen.tsx does under saved set L (the pitch / yaw / roll on top), centred. */
function place(p: Record<string, number>, L: LoadingSet) {
  applyPose(rig, p as any);
  const r = rig.root;
  r.rotation.x += d2r(L.pitch); r.rotation.y += d2r(L.yaw); r.rotation.z += d2r(L.roll);
  r.position.set(0, 0, 0); r.updateMatrixWorld(true);
  tmp.copy(MID).applyMatrix4(r.matrixWorld); r.position.sub(tmp); r.updateMatrixWorld(true);
  viewLock(rig, camera);
}

// ── the sparkles: LoadingScreen.tsx's swarm, in his own units, made periodic so the loop has no seam ─────────
function dotTexture() {
  const S = 32, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2), a = r >= 1 ? 0 : r < 0.45 ? 1 : 1 - (r - 0.45) / 0.55;
    const i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(a * 255);
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat); t.needsUpdate = true; return t;
}
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const DOT = dotTexture();
const THEME = LOADING_THEMES.dark;
// Dot sizes: the loading screen draws gold at ~2.8% and violet at ~1.9% of his height; 0.85x that here (the Lab thumbnails' fine glints; 1.5x read as blobs), since at
// header size the true proportion is a pixel and reads as nothing (owner: "not seeing my sparkles").
const figPx = (3.5 / (2 * 10 * Math.tan(d2r(13.5)))) * PXF;
const swarm = [0, 1].map((k) => {
  const n = Math.round(110 * LOADING_SETS[0].sw), pos = new Float32Array(n * 3), geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: figPx * (k ? 0.019 : 0.028) * 0.85, sizeAttenuation: false, map: DOT, color: THEME.spark[k], transparent: true, depthWrite: false, opacity: 1 });
  scene.add(new THREE.Points(geo, mat));
  return { mat, base: mat.size, pos, geo, data: Array.from({ length: n }, () => ({ x: gauss(), y: gauss() * 0.4, z0: rnd(), v: 0.6 + rnd() * 0.9, w: rnd() * TAU })) };
});
/** Sparkles at loop fraction u (any real number; whole numbers wrap). Each rises a whole number of times per loop. */
function sparkleAt(u: number, loopS: number, L: LoadingSet) {
  const size = 3, spread = size * 0.32 * L.sspread, cz = 0.35;
  for (const s of swarm) {
    s.data.forEach((q, i) => {
      const laps = Math.max(1, Math.round((q.v * 0.35 * L.srise * loopS) / 2)); // z travels 2 per lap
      const z = ((((q.z0 + laps * u) % 1) + 1) % 1) * 2 - 1;
      const sway = Math.sin(TAU * 2 * u + q.w) * 0.06;
      s.pos[i * 3] = (q.x * 0.55 + sway) * spread; s.pos[i * 3 + 1] = q.y * spread; s.pos[i * 3 + 2] = cz + z * size * 0.6;
    });
    (s.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
function shot(px: number) { renderer.setSize(px, px, false); renderer.render(scene, camera); return canvas; }

// ── one fall per saved set (LOADING_SETS, the Void Loading Lab), from the set's own loop phase ───────────────
export const FALLS: Record<string, { name: string; set: number }> = {
  d: { name: 'saved set 4', set: 3 }, // owner, 2026-10-20: the app uses saved set 4 only
};

/** One lap of his loop at the saved speed (PERIOD / speed seconds), sparkles rising, seamless.
 *  The loading screen bakes every saved set bigger and at 15 fps (bakeLoading). */
function bakeFall(id: string, F = FALLS[id], PX = PXF, FPS = FPSF) {
  const L = LOADING_SETS[F.set];
  for (const s of swarm) s.mat.size = s.base * (PX / PXF); // sparkles keep their size against him
  const nl = Math.round((PERIOD / L.speed) * FPS), loopS = nl / FPS;
  const cols = Math.ceil(Math.sqrt(nl)), rows = Math.ceil(nl / cols);
  const sheet = document.createElement('canvas'); sheet.width = cols * PX; sheet.height = rows * PX;
  const ctx = sheet.getContext('2d')!;
  // The variance noise is not periodic, so the last 20% of the lap blends into the pose one lap earlier.
  const c0 = L.phase * PERIOD;
  const poseAt = (u: number) => {
    const a = posed(c0 + u * PERIOD, L.motion);
    const wgt = sm((u - 0.8) / 0.2);
    if (wgt <= 0) return a;
    const b = posed(c0 + (u - 1) * PERIOD, L.motion), out: Record<string, number> = {};
    for (const k in a) out[k] = a[k] * (1 - wgt) + b[k] * wgt;
    return out;
  };
  for (let k = 0; k < nl; k++) {
    const u = k / nl;
    place(poseAt(u), L);
    sparkleAt(u, loopS, L);
    ctx.drawImage(shot(PX), (k % cols) * PX, Math.floor(k / cols) * PX);
  }
  return { id, name: F.name, set: F.set, cell: CELL_DP, px: PX, fps: FPS, cols, rows, nl, sheet: sheet.toDataURL('image/webp', 0.88) };
}

/** Just the eyes and brows, straight on and flat: eyes white, brows black, everything else hidden (brand marks). */
function bakeEyes(N = 2048) {
  const r = rig.root;
  r.rotation.set(0, 0, 0); r.position.set(0, 0, 0); rig.head.rotation.set(0, 0, 0); r.updateMatrixWorld(true);
  const keep: THREE.Object3D[] = [], hidden: THREE.Object3D[] = [], saved = new Map<any, THREE.Material>();
  scene.traverse((o: any) => {
    if (o.isPoints) { if (o.visible) { hidden.push(o); o.visible = false; } return; }
    if (!o.isMesh) return;
    if (!o.userData.outline && (o.material === M.eye || o.material === M.brow)) {
      keep.push(o); saved.set(o, o.material);
      o.material = new THREE.MeshBasicMaterial({ color: o.material === M.eye ? 0xffffff : 0x000000 });
    } else if (o.visible) { hidden.push(o); o.visible = false; }
  });
  const box = new THREE.Box3(); keep.forEach((o) => box.expandByObject(o));
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()), half = Math.max(sz.x, sz.z) * 0.56;
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 50);
  cam.up.set(0, 0, 1); cam.position.set(c.x, c.y - 10, c.z); cam.lookAt(c.x, c.y, c.z);
  renderer.setSize(N, N, false); renderer.render(scene, cam);
  const url = canvas.toDataURL('image/png');
  hidden.forEach((o) => (o.visible = true)); saved.forEach((m, o) => (o.material = m));
  return url;
}
function gpuInfo() {
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
}
// The loading screen: every saved set, 240 px cells at 15 fps (his cell there is ~0.96 x the band's height, ~117 dp).
const bakeLoading = (set: number) => { const r = bakeFall('l' + set, { name: 'saved set ' + (set + 1), set }, 240, 15); return r; };
Object.assign(window as any, { bakeFall, bakeLoading, bakeEyes, gpuInfo, FALL_IDS: Object.keys(FALLS), LOADING_N: LOADING_SETS.length });
