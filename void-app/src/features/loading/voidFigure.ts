// THE VOID CHARACTER, for the loading screen. A straight port of the Void Loading Lab artifact
// (https://claude.ai/artifact/WCcKMtrjZ1mR6GFD1ML9fq): the locked head and face from
// void-character/head-face.lock.json, the signature jacket and wide-leg look, the falling drift.
// Pure three.js, no DOM. Units ~ metres, Z up, the figure faces -Y.
import * as THREE from 'three';

// FACE LOCK (Void Face Lab, 2026-10-16) - keep in step with void-character/head-face.lock.json.
export const FACE = { headColor: '#b7ae9a', browColor: '#121015', eyeColor: '#ffffff', width: 0.55, height: 0.45, depth: 0.539, lump: 0, lumpScale: 2.4, flat: 0.43, roll: -4, pinch: 0.16, seed: 7,
  browSpread: -0.008, browLen: 0.2, browThick: 0.045, browShear: 31, browDepth: 0.04, browAngle: 22, browBite: 0.92, browReach: 0.9, browLift: 0.012, eyeX: 0.121, eyeZ: 0.069, eyeR: 0.082, eyeDepth: 0.021 };
// Neck scribble (Head Lab lock; height 0.18 since 2026-10-16).
const HL = { hNeckH: 0.18, hNeckRx: 0.115, hNeckRy: 0.095, hLoops: 520, hLine: 0.0045, hLoose: 0.3, hSeed: 8 };
// Body proportions (same as blender/void_char.py).
const P = { neck_h: HL.hNeckH, neck_rx: HL.hNeckRx, neck_ry: HL.hNeckRy, ct: 0.75, arm_len: 1.15, arm_r: 0.1, hand_r: 0.12, hip_z: -0.5, hip_x: 0.2, leg_len: 1.8, shoe: [0.22, 0.4, 0.13] as const };
// THE ONE look (the user's loading-screen character, 2026-10-13/17): jacket, wide-leg, skin Monk 8; the head takes the skin tone.
export const LOOK = { skin: '#604134', topColor: '#2c2c2c', botColor: '#161616', shoeColor: '#2c2c2c', neckColor: '#281810', underColor: '#c9c3b4' };
const JACKET = { len: -0.72, hem: 0.46, shoulder: 0.4, depth: 0.72, up: 1.0 };
const WIDE = { top: 0.21, knee: 0.23, bot: 0.33 };

const d2r = THREE.MathUtils.degToRad;
const rngOf = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const hash3 = (x: number, y: number, z: number) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
export function vnoise(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const f = (t: number) => t * t * (3 - 2 * t), u = f(xf), v = f(yf), w = f(zf);
  const L = (a: number, b: number, t: number) => a + (b - a) * t, h = (i: number, j: number, k: number) => hash3(xi + i, yi + j, zi + k);
  return 2 * L(L(L(h(0, 0, 0), h(1, 0, 0), u), L(h(0, 1, 0), h(1, 1, 0), u), v), L(L(h(0, 0, 1), h(1, 0, 1), u), L(h(0, 1, 1), h(1, 1, 1), u), v), w) - 1;
}
type Prof = [number, number][];
function lathe(profile: Prof, seg = 48, smooth = 6) {
  const pts = profile.slice().reverse().map(([r, z]) => new THREE.Vector2(Math.max(r, 0), z));
  const g = new THREE.LatheGeometry(new THREE.SplineCurve(pts).getPoints(Math.max(8, pts.length * smooth)), seg);
  g.rotateX(Math.PI / 2);
  return g;
}
function deform(g: THREE.BufferGeometry, fn: (v: THREE.Vector3) => void) {
  const p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v); p.setXYZ(i, v.x, v.y, v.z); }
  p.needsUpdate = true; g.computeVertexNormals(); return g;
}
const sphereGeo = (sx: number, sy: number, sz: number, seg = 32) => new THREE.SphereGeometry(1, seg, Math.round(seg * 0.6)).scale(sx, sy, sz);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function scribble() {
  const rnd = rngOf(HL.hSeed), pts: THREE.Vector3[] = []; let z = 0, vz = 0, cx = 0, cy = 0;
  const u = (a: number, b: number) => a + (b - a) * rnd();
  for (let i = 0; i < HL.hLoops; i++) {
    const th = i * 0.42 + u(-0.25, 0.25);
    vz = Math.max(-0.03, Math.min(0.03, vz + u(-0.01, 0.01)));
    z = Math.min(P.neck_h, Math.max(0, z + vz + 0.0015));
    cx = Math.max(-P.neck_rx * 0.25, Math.min(P.neck_rx * 0.25, cx + u(-0.01, 0.01)));
    cy = Math.max(-P.neck_ry * 0.25, Math.min(P.neck_ry * 0.25, cy + u(-0.01, 0.01)));
    const rr = u(HL.hLoose, 1);
    pts.push(new THREE.Vector3(cx + P.neck_rx * rr * Math.cos(th), cy + P.neck_ry * rr * Math.sin(th), z + 0.06 * Math.sin(th) * P.neck_h));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, HL.hLine, 4);
}
function nubGeo(size: number, thumb: number) {
  return deform(new THREE.SphereGeometry(1, 28, 18), (co) => {
    co.x *= size * 0.85; co.y *= size * 0.7; co.z *= size * 1.25;
    const b = Math.exp(-(((co.x - thumb * size * 0.6) ** 2 + (co.y + size * 0.3) ** 2 + (co.z - size * 0.2) ** 2) / (size * 0.35) ** 2));
    co.x += thumb * b * size * 0.35;
  });
}
function shoeGeo() {
  const [sx, sy, sz] = P.shoe;
  return deform(new THREE.SphereGeometry(1, 32, 20), (co) => {
    co.x *= sx; co.y *= sy; co.z *= sz;
    if (co.y < 0) { const t = -co.y / sy; co.x *= 1 + 0.18 * t; co.z += 0.05 * t * t; }
    if (co.z < -sz * 0.6) co.z = -sz * 0.6 - (co.z + sz * 0.6) * 0.3;
  });
}
function headGeo() {
  const F = FACE, fz = -F.height * F.flat;
  return deform(new THREE.SphereGeometry(1, 96, 64), (co) => {
    const nx = co.x, ny = co.y, nz = co.z, ls = F.lumpScale, off = F.seed * 7.31;
    const k = 1 + F.lump * (vnoise(nx * ls + off, ny * ls, nz * ls + off) * 1.6 + vnoise(nx * ls * 2.7, ny * ls * 2.7 + off, nz * ls * 2.7) * 0.5);
    co.set(nx * F.width * k, ny * F.depth * k, nz * F.height * k);
    if (co.z < fz) co.z = fz + (co.z - fz) * 0.22;
    const p = Math.exp(-(((nx + 0.55) ** 2 + (ny + 0.6) ** 2 + (nz + 0.55) ** 2) / 0.35));
    co.x += F.pinch * p * F.width * 0.5; co.z += F.pinch * p * F.height * 0.35;
  });
}

// ── materials: toon shading + an inverted-hull outline ────────────────────
const OUTW = { value: 0.012 };
export const outlineMat = new THREE.MeshBasicMaterial({ color: '#17121f', side: THREE.BackSide, transparent: true });
outlineMat.onBeforeCompile = (sh) => { (sh.uniforms as any).outlineW = OUTW; sh.vertexShader = 'uniform float outlineW;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3( position ) + normal * outlineW;'); };
// RGBA, not RedFormat: expo-gl on iPhone leaves an R8 texture incomplete and the toon body draws black.
const ramp = (() => { const t = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
const toon = (c: string) => new THREE.MeshToonMaterial({ color: c, gradientMap: ramp });
export const M: Record<string, THREE.Material> = {
  cap: toon(LOOK.skin), neck: new THREE.MeshBasicMaterial({ color: LOOK.neckColor }), top: toon(LOOK.topColor), under: toon(LOOK.underColor),
  bottom: toon(LOOK.botColor), shoe: toon(LOOK.shoeColor), skin: toon(LOOK.skin), eye: toon(FACE.eyeColor), brow: toon(FACE.browColor),
};
/** Fade the whole figure (every role material and the outline hull). */
export function setFigureAlpha(a: number) {
  for (const k in M) { const m = M[k] as THREE.Material & { opacity: number }; if (m.opacity !== a) { m.transparent = a < 1; m.opacity = a; m.needsUpdate = true; } }
  if (outlineMat.opacity !== a) outlineMat.opacity = a;
}

const node = (parent: THREE.Object3D, pos: [number, number, number] = [0, 0, 0]) => { const e = new THREE.Object3D(); e.rotation.order = 'ZYX'; e.position.set(...pos); parent.add(e); return e; };
const bone = (parent: THREE.Object3D, pos: [number, number, number] = [0, 0, 0]) => { const b = new THREE.Bone(); b.rotation.order = 'ZYX'; b.position.set(...pos); parent.add(b); return b; };
function mesh(geo: THREE.BufferGeometry, role: string, parent: THREE.Object3D, pos?: [number, number, number] | null, outline = true) {
  const m = new THREE.Mesh(geo, M[role]);
  if (pos) m.position.set(...pos);
  if (outline) { const o = new THREE.Mesh(geo, outlineMat); o.userData.outline = true; m.add(o); }
  parent.add(m); return m;
}
type Weights = (v: THREE.Vector3) => [number, number][];
function skinned(geo: THREE.BufferGeometry, role: string, parent: THREE.Object3D, bones: THREE.Bone[], weights: Weights, binds: (() => void)[], offset?: [number, number, number]) {
  if (offset) geo.translate(...offset);
  const pos = geo.attributes.position as THREE.BufferAttribute, n = pos.count, idx = new Uint16Array(n * 4), wt = new Float32Array(n * 4), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    const list = weights(v).filter(([, w]) => w > 1e-4).slice(0, 4), sum = list.reduce((t, [, w]) => t + w, 0) || 1;
    list.forEach(([b, w], k) => { idx[i * 4 + k] = b; wt[i * 4 + k] = w / sum; });
    if (!list.length) wt[i * 4] = 1;
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
  const m = new THREE.SkinnedMesh(geo, M[role]); m.frustumCulled = false; parent.add(m);
  const o = new THREE.SkinnedMesh(geo, outlineMat); o.userData.outline = true; o.frustumCulled = false; parent.add(o);
  binds.push(() => { const sk = new THREE.Skeleton(bones); m.bind(sk); o.bind(sk); });
  return m;
}

export interface Rig {
  root: THREE.Object3D; torso: THREE.Object3D; head: THREE.Object3D;
  parts: Record<'L' | 'R', { shoulder: THREE.Object3D; elbow: THREE.Object3D; wrist: THREE.Object3D; hip: THREE.Object3D; knee: THREE.Object3D }>;
  hemL: THREE.Bone; hemR: THREE.Bone; legBones: Record<'L' | 'R', { hipB: THREE.Bone; kneeB: THREE.Bone }>; baseZ: number;
}

/** Build the figure into `scene`. Root sits at z 2.3; applyPose() moves it from there. */
export function buildFigure(scene: THREE.Scene): Rig {
  const T = JACKET, B = WIDE, ct = P.ct;
  const root = node(scene, [0, 0, 2.3]); const torso = node(root);
  const binds: (() => void)[] = [];
  // top: one continuous garment, hem bones follow the thighs
  const sh = T.shoulder, hem = T.hem, len = T.len;
  const prof: Prof = [[0, ct + 0.04], [0.17, ct + 0.03], [0.24, ct - 0.04], [sh * 0.9, ct - 0.2], [sh, ct - 0.34], [sh * 0.97, ct - 0.7], [hem * 0.93, len + 0.25], [hem, len + 0.03], [hem * 0.97, len]];
  const topRoot = bone(torso), hemL = bone(topRoot, [P.hip_x, 0, P.hip_z]), hemR = bone(topRoot, [-P.hip_x, 0, P.hip_z]);
  const topWeights: Weights = (v) => { const h = smooth(-0.12, len + 0.05, v.z), side = smooth(-0.32, 0.32, v.x); return [[0, 1 - h], [1, h * side], [2, h * (1 - side)]]; };
  skinned(lathe(prof, 64).scale(1, T.depth, 1), 'top', torso, [topRoot, hemL, hemR], topWeights, binds);

  // neck + the locked head and face
  const neck = node(torso, [0, 0, ct - 0.02]);
  mesh(scribble(), 'neck', neck, null, false);
  const F = FACE, fz = -F.height * F.flat, bottomZ = fz - F.height * (1 - F.flat) * 0.22;
  const head = node(neck, [0, 0, P.neck_h - 0.02 - bottomZ]);
  const cap = mesh(headGeo(), 'cap', head); cap.rotation.y = d2r(F.roll);
  root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const onSkin = (x: number, z: number, lift: number) => {
    const o = head.localToWorld(new THREE.Vector3(x, -4, z)), d = new THREE.Vector3(0, 1, 0).transformDirection(head.matrixWorld);
    ray.set(o, d); const hit = ray.intersectObject(cap, false)[0];
    const g = new THREE.Group(); g.up.set(0, 0, 1); head.add(g);
    if (!hit || !hit.face) { g.position.set(x, -F.depth, z); g.lookAt(head.localToWorld(new THREE.Vector3(x, -5, z))); return g; }
    const n = hit.face.normal.clone().transformDirection(cap.matrixWorld);
    g.position.copy(head.worldToLocal(hit.point.clone().addScaledVector(n, lift))); head.updateMatrixWorld(true);
    g.lookAt(hit.point.clone().addScaledVector(n, 1)); return g;
  };
  const bw = F.browThick, bl = F.browLen, dd = (bw / 2) * Math.tan(d2r(F.browShear)), bs = new THREE.Shape();
  bs.moveTo(-dd, -bw / 2); bs.lineTo(bl - dd, -bw / 2); bs.lineTo(bl + dd, bw / 2); bs.lineTo(dd, bw / 2); bs.closePath();
  const browG = new THREE.ExtrudeGeometry(bs, { depth: F.browDepth, bevelEnabled: false });
  const eyeG = new THREE.CylinderGeometry(F.eyeR, F.eyeR, F.eyeDepth, 48).rotateX(Math.PI / 2).translate(0, 0, F.eyeDepth / 2);
  const fa = d2r(F.browAngle), reach = F.browReach * F.eyeR;
  for (const sx of [1, -1]) {
    mesh(eyeG, 'eye', onSkin(sx * F.eyeX, F.eyeZ, 0));
    const qx = sx * (F.eyeX + F.browSpread), qz = F.eyeZ + F.browBite * F.eyeR;
    const slab = mesh(browG, 'brow', onSkin(qx + sx * Math.cos(fa) * (bl / 2 - reach), qz + Math.sin(fa) * (bl / 2 - reach), F.browLift));
    slab.position.set(-sx * Math.cos(fa) * bl / 2, -Math.sin(fa) * bl / 2, 0);
    slab.rotation.z = sx > 0 ? fa : Math.PI - fa;
  }

  const parts = {} as Rig['parts'], legBones = {} as Rig['legBones'];
  for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
    // arms (fitted sleeves, flared cuff)
    const a = P.arm_r, half = P.arm_len / 2, up = T.up;
    const shoulder = node(torso, [sx * (sh + 0.02), 0, ct - 0.3]);
    const elbow = node(shoulder, [0, 0, -half]);
    const upper = mesh(deform(lathe([[a * 1.12 * up, 0.06], [a * 1.18 * up, -half * 0.2], [a * 1.06 * up, -half * 0.5], [a * 1.12 * up, -half * 0.75], [a * 0.98 * up, -half]], 36),
      (co) => { co.y += 0.035 * Math.sin(Math.PI * Math.min(1, -co.z / half)); }), 'top', shoulder); upper.scale.set(1, 0.9, 1);
    mesh(sphereGeo(a * 1.12 * up, a * 1.12 * up, a * 1.12 * up), 'top', shoulder);
    mesh(sphereGeo(a, a, a, 20), 'top', elbow);
    const cuff: Prof = [[a * 0.98, 0.04], [a * 1.08, -half * 0.18], [a * 1.0, -half * 0.36], [a * 1.18, -half * 0.52], [a * 1.12, -half * 0.68], [a * 1.42, -half * 0.88], [a * 1.55, -half], [a * 1.4, -half - 0.015]];
    const fore = mesh(deform(lathe(cuff, 36), (co) => { co.y -= 0.03 * Math.sin(Math.PI * Math.min(1, -co.z / half)); }), 'top', elbow); fore.scale.set(1, 0.88, 1);
    const wrist = node(elbow, [0, 0, -half + 0.04]);
    mesh(nubGeo(P.hand_r, -sx), 'skin', wrist, [0, -0.01, -0.1]);

    // legs: one trouser leg hip to hem, skinned to hip + knee bones
    const hip = node(torso, [sx * P.hip_x, 0, P.hip_z]);
    const L = P.leg_len, K = L / 2, rk = B.knee;
    const knee = node(hip, [0, 0, -K]);
    const hipB = bone(torso, [sx * P.hip_x, 0, P.hip_z]), kneeB = bone(hipB, [0, 0, -K]);
    legBones[side] = { hipB, kneeB };
    const shoeZ = -K - 0.09;
    const shin: Prof = [[(rk + B.bot) / 2, -K * 0.55], [B.bot, -K + 0.02], [B.bot * 0.98, -K - 0.01]];
    const legProf: Prof = ([[B.top * 0.95, 0.05], [B.top, -0.1], [rk * 1.0, -K * 0.55], [rk, -K - 0.02], [rk * 1.0, -K - 0.12]] as Prof).concat(shin.map(([r, z]) => [r, z - K] as [number, number]));
    const hemZ = legProf[legProf.length - 1][1];
    const legG = deform(lathe(legProf, 48, 5), (co) => {
      const k = smooth(hemZ + 0.2, hemZ, co.z), r = Math.hypot(co.x, co.y) || 1, front = -co.y / r;
      co.z += k * 0.05 * front - k * 0.03 * (1 - front) * 0.5; co.x *= 1 + 0.06 * k; co.y *= 1 + 0.06 * k;
    }).scale(1, 0.85, 1);
    skinned(legG, 'bottom', torso, [hipB, kneeB], (v) => { const local = v.z - P.hip_z, w = smooth(-K + 0.16, -K - 0.16, local); return [[0, 1 - w], [1, w]]; }, binds, [sx * P.hip_x, 0, P.hip_z]);
    mesh(sphereGeo(rk * 0.9, rk * 0.78, rk * 0.9), 'bottom', knee);
    mesh(shoeGeo(), 'shoe', knee, [0, -0.1, shoeZ]);
    parts[side] = { shoulder, elbow, wrist, hip, knee };
  }
  root.updateMatrixWorld(true);
  for (const f of binds) f();
  return { root, torso, head, parts, hemL, hemR, legBones, baseZ: 2.3 };
}

// ── motion: the falling drift and the loops the user mixed ─────────────────
type Pose = Record<string, number>;
const CH = ['rx', 'ry', 'rz', 'hx', 'hy', 'hz', 'aL', 'aR', 'eL', 'eR', 'wL', 'wR', 'kL', 'sL', 'kR', 'sR', 'nL', 'nR', 'dz'];
const GROUP: Record<string, 'sway' | 'cap' | 'arms' | 'legs' | 'bob'> = { rx: 'sway', ry: 'sway', rz: 'sway', hx: 'cap', hy: 'cap', hz: 'cap', aL: 'arms', aR: 'arms', eL: 'arms', eR: 'arms', wL: 'arms', wR: 'arms', kL: 'legs', sL: 'legs', kR: 'legs', sR: 'legs', nL: 'legs', nR: 'legs', dz: 'bob' };
const TAU = Math.PI * 2;
const BASE: Pose = { rx: -24, ry: -14, rz: 32, hx: -12, hy: 8, hz: 4, aL: 55, aR: 42, eL: -45, eR: -60, wL: -24, wR: -34, kL: -24, sL: 5, kR: -8, sR: 3, nL: 36, nR: 52, dz: 0 };
const w = (b: number, a: number, ph: number, t: number, f = 1) => b + a * Math.sin(TAU * t * f + ph);
function drift(t: number): Pose {
  return { rx: w(-24, 4, 0, t), ry: w(-14, 3, 0.8, t), rz: w(32, 3.5, 1.6, t), hx: w(-12, 3.5, -0.6, t), hy: w(8, 3, 0.2, t), hz: w(4, 2, 1, t),
    aL: w(55, 8, -0.3, t), aR: w(42, 8, 0.9, t), eL: w(-45, 7, -0.9, t), eR: w(-60, 7, 0.3, t), wL: w(-24, 6, -1.5, t), wR: w(-34, 6, -0.3, t),
    kL: w(-24, 7, -0.4, t), sL: w(5, 2, 0.5, t), kR: w(-8, 7, 1.2, t), sR: 3, nL: w(36, 8, -1, t), nR: w(52, 8, 0.6, t), dz: 0 };
}
const ease = (x: number) => 0.5 - 0.5 * Math.cos(TAU * x);
const LOOPS: ((t: number) => Pose)[] = [
  (t) => drift(t),
  (t) => ({ ...drift(t), rx: -14, ry: -10, rz: 32 + 360 * t }),
  (t) => ({ ...drift(t), rx: -20 + 14 * Math.sin(TAU * t) }),
  (t) => ({ ...drift(t), rx: -18, ry: -12 + 16 * Math.sin(TAU * t) }),
  (t) => ({ ...drift(t), aL: 60 + 26 * Math.sin(TAU * t * 2), aR: 48 + 26 * Math.sin(TAU * t * 2 + 1.7), eL: -50 + 22 * Math.sin(TAU * t * 2 - 0.8), eR: -62 + 22 * Math.sin(TAU * t * 2 + 0.9) }),
  (t) => ({ ...drift(t), kL: -26 + 22 * Math.sin(TAU * t), kR: -26 + 22 * Math.sin(TAU * t + Math.PI), nL: 50 + 26 * Math.sin(TAU * t - 0.9), nR: 50 + 26 * Math.sin(TAU * t + Math.PI - 0.9) }),
  (t) => ({ ...drift(t), dz: 0.06 * Math.sin(TAU * t) }),
  (t) => ({ ...drift(t), dz: -0.28 * ease(t) }),
  (t) => ({ ...drift(0.25), hx: -12 + 9 * Math.sin(TAU * t * 2), hy: 8 + 9 * Math.sin(TAU * t * 2 + 1.2) }),
  (t) => ({ ...drift(t), eL: -30 - 50 * ease(t), eR: -30 - 50 * ease(t), nL: 20 + 70 * ease(t), nR: 30 + 70 * ease(t - 0.064), aL: 70 - 40 * ease(t), aR: 60 - 40 * ease(t - 0.048) }),
  (t) => ({ ...drift(t), rx: -22 + 10 * Math.sin(TAU * t * 2), ry: -12 + 12 * Math.sin(TAU * t) }),
  (t) => ({ ...drift(t), rx: -18, ry: -10, rz: 32 + 50 * Math.sin(TAU * t) }),
];
export const PERIOD = 2; // seconds per loop at speed 1
export interface Motion { mix: number[]; intensity: number; variance: number; arms: number; legs: number; sway: number; cap: number; bob: number }
const LIM: Record<string, [number, number]> = { rx: [-80, 40], ry: [-60, 60], hx: [-45, 30], hy: [-40, 40], hz: [-30, 30], aL: [-5, 150], aR: [-5, 150], eL: [-125, 0], eR: [-125, 0],
  wL: [-70, 15], wR: [-70, 15], kL: [-110, 40], sL: [-10, 35], kR: [-110, 40], sR: [-10, 35], nL: [0, 125], nR: [0, 125], dz: [-0.6, 0.4] };
export function posed(time: number, m: Motion): Pose {
  const t = time / PERIOD, out: Pose = { ...BASE };
  for (let i = 0; i < LOOPS.length; i++) {
    const wt = m.mix[i]; if (!wt) continue;
    const p = LOOPS[i](t);
    for (const c of CH) out[c] += wt * (p[c] - BASE[c]) * m[GROUP[c]] * m.intensity;
  }
  if (m.variance > 0) CH.forEach((c, k) => { out[c] += (c === 'dz' ? 0.05 : 7) * m.variance * vnoise(time * 0.22, k * 3.1, 0.5) * m[GROUP[c]]; });
  for (const c in LIM) out[c] = Math.min(LIM[c][1], Math.max(LIM[c][0], out[c]));
  return out;
}
export function applyPose(rig: Rig, p: Pose) {
  const { root, head, parts } = rig;
  root.rotation.set(d2r(p.rx), d2r(p.ry), d2r(p.rz)); root.position.z = rig.baseZ + p.dz;
  head.rotation.set(d2r(p.hx), d2r(p.hy), d2r(p.hz));
  const L = parts.L, R = parts.R;
  L.shoulder.rotation.set(0, d2r(-p.aL), 0); R.shoulder.rotation.set(0, d2r(p.aR), 0);
  L.hip.rotation.set(d2r(p.kL), d2r(-p.sL), 0); R.hip.rotation.set(d2r(p.kR), d2r(p.sR), 0);
  L.elbow.rotation.set(d2r(p.eL), d2r(-8), 0); R.elbow.rotation.set(d2r(p.eR), d2r(8), 0);
  L.knee.rotation.set(d2r(p.nL), 0, 0); R.knee.rotation.set(d2r(p.nR), 0, 0);
  const lb = rig.legBones;
  lb.L.hipB.rotation.copy(L.hip.rotation); lb.R.hipB.rotation.copy(R.hip.rotation);
  lb.L.kneeB.rotation.copy(L.knee.rotation); lb.R.kneeB.rotation.copy(R.knee.rotation);
  rig.hemL.rotation.set(L.hip.rotation.x * 0.85, L.hip.rotation.y * 0.6, 0);
  rig.hemR.rotation.set(R.hip.rotation.x * 0.85, R.hip.rotation.y * 0.6, 0);
  L.wrist.rotation.set(d2r(p.wL), d2r(-10), d2r(12)); R.wrist.rotation.set(d2r(p.wR), d2r(14), d2r(-8));
}
// View lock, as on the model sheet: always a little neck and a sliver under the head.
const tmpV = new THREE.Vector3(), tmpU = new THREE.Vector3(), qW = new THREE.Quaternion(), qP = new THREE.Quaternion(), qT = new THREE.Quaternion();
export function viewLock(rig: Rig, camera: THREE.Camera, lo = -0.24, hi = -0.07) {
  const head = rig.head; head.updateWorldMatrix(true, false);
  head.getWorldQuaternion(qW); tmpU.set(0, 0, 1).applyQuaternion(qW);
  head.getWorldPosition(tmpV); tmpV.subVectors(camera.position, tmpV).normalize();
  const d = tmpU.dot(tmpV); if (d >= lo && d <= hi) return;
  const target = d < lo ? lo : hi, axis = new THREE.Vector3().crossVectors(tmpU, tmpV);
  if (axis.lengthSq() < 1e-10) axis.set(1, 0, 0);
  qT.setFromAxisAngle(axis.normalize(), Math.acos(Math.max(-1, Math.min(1, d))) - Math.acos(target));
  head.parent!.getWorldQuaternion(qP);
  head.quaternion.copy(qP.invert().multiply(qT.multiply(qW)));
}
