// THE LOADING SCREEN: the void band, the character falling through sparkles, the words "Void Archive".
// A port of the Void Loading Lab artifact; every number comes from LOADING in ./arrivals.ts.
//
// The band, the figure and the sparkles are drawn in one expo-gl surface (three.js), so nothing
// needs a transparent GL layer. The word is a native Text above it, moved by Reanimated.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import * as THREE from 'three';
import { FONTS, useTheme } from '../../theme/tokens';
import { arrive, LOADING, LOADING_THEMES } from './arrivals';
import { applyPose, buildFigure, PERIOD, posed, setFigureAlpha, viewLock, type Rig } from './voidFigure';

type LT = keyof typeof LOADING_THEMES;
const themeKey = (name: string): LT => (name in LOADING_THEMES ? (name as LT) : 'dark');
const CZ = 2.05; // the character's depth; the band sits on the y = 0 plane around it

// A soft dot for the sparkles (the web drew it on a canvas; here it is a small data texture).
function dotTexture() {
  const S = 32, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2), a = r >= 1 ? 0 : r < 0.45 ? 1 : 1 - (r - 0.45) / 0.55;
    const i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(a * 255);
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat); t.needsUpdate = true; return t;
}
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const d2r = THREE.MathUtils.degToRad;

export function LoadingScreen({ fontsReady, onFirstFrame }: { fontsReady: boolean; onFirstFrame?: () => void }) {
  const theme = useTheme();
  const T = LOADING_THEMES[themeKey(theme.name)];
  const themeRef = useRef(T); themeRef.current = T;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => { const { width, height } = e.nativeEvent.layout; setSize({ w: width, h: height }); }, []);
  const t0 = useRef(Date.now());
  const clock = useSharedValue(0);
  useFrameCallback(() => { clock.value = (Date.now() - t0.current) / 1000; });

  // The band in screen px, for the word; the GL side computes the same band in world units.
  const bw = size.w * (1 - 2 * LOADING.bm), bh = bw / 3, fs = bh * 0.3 * LOADING.wsize;
  const wordStyle = useAnimatedStyle(() => {
    const p = arrive(LOADING.word, clock.value);
    return { opacity: p.alpha, transform: [{ translateX: p.dx * bw * 0.5 + (p.jit ? (Math.random() - 0.5) * 18 * p.jit : 0) }, { translateY: p.dy * bh * 0.5 }, { rotate: p.rot + 'deg' }, { scaleX: p.sx }, { scaleY: p.sy }] };
  }, [bw, bh]);

  const gen = useRef(0);
  const firstFrame = useRef(onFirstFrame); firstFrame.current = onFirstFrame;
  const onContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    const g: any = gl;
    if (!g || typeof g.createTexture !== 'function' || g.__voidMissingContext) return;
    const myGen = ++gen.current;
    // expo-gl shims, as the globe does them (globeScene.ts).
    const rawPixelStorei = g.pixelStorei.bind(g);
    const allowed = new Set([g.UNPACK_FLIP_Y_WEBGL, g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, g.UNPACK_ALIGNMENT, g.PACK_ALIGNMENT]);
    g.pixelStorei = (p: number, v: any) => { if (allowed.has(p)) rawPixelStorei(p, v); };
    const bufW = g.drawingBufferWidth, bufH = g.drawingBufferHeight;
    const canvas: any = { width: bufW, height: bufH, style: {}, clientWidth: bufW, clientHeight: bufH, addEventListener: () => {}, removeEventListener: () => {}, getContext: () => g };
    try { (THREE as any).ColorManagement.enabled = false; } catch {}
    const G = globalThis as any, savedGL1 = G.WebGLRenderingContext; let hid = false;
    try { if (savedGL1 && g instanceof savedGL1) { G.WebGLRenderingContext = function NotWebGL1() {}; hid = true; } } catch {}
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, context: g, antialias: false, powerPreference: 'high-performance', precision: 'highp' } as any); }
    finally { if (hid) G.WebGLRenderingContext = savedGL1; }
    try { (renderer as any).outputColorSpace = (THREE as any).LinearSRGBColorSpace; } catch {}
    renderer.setPixelRatio(1); renderer.setSize(bufW, bufH, false);
    renderer.localClippingEnabled = true;

    const scene = new THREE.Scene();
    const aspect = bufW / Math.max(1, bufH);
    const camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 100);
    camera.up.set(0, 0, 1); camera.position.set(0, -10, CZ); camera.lookAt(0, 0, CZ); camera.updateProjectionMatrix();
    const visH = 2 * 10 * Math.tan(d2r(20)), visW = visH * aspect;
    const band = { tw: visW * (1 - 2 * LOADING.bm), th: 0 }; band.th = band.tw / 3;

    // lights: the lab's studio look
    scene.add(new THREE.HemisphereLight(0xffffff, 0x221a33, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-4, -6, 7); scene.add(key);
    const rimL = new THREE.DirectionalLight(0xffbe5c, 0.6); rimL.position.set(-5, 4, 5); scene.add(rimL);
    const rimR = new THREE.DirectionalLight(0xffc76b, 0.6); rimR.position.set(5, 4, 3); scene.add(rimR);

    // the band: a rounded rectangle on the y = 0 plane, facing the camera
    const r = band.th * LOADING.tr, hw = band.tw / 2, hh = band.th / 2, sh = new THREE.Shape();
    sh.moveTo(-hw + r, -hh); sh.lineTo(hw - r, -hh); sh.quadraticCurveTo(hw, -hh, hw, -hh + r); sh.lineTo(hw, hh - r); sh.quadraticCurveTo(hw, hh, hw - r, hh);
    sh.lineTo(-hw + r, hh); sh.quadraticCurveTo(-hw, hh, -hw, hh - r); sh.lineTo(-hw, -hh + r); sh.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
    const bandGeo = new THREE.ShapeGeometry(sh, 12).rotateX(Math.PI / 2);
    const bandMat = new THREE.MeshBasicMaterial({ color: themeRef.current.band, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const bandMesh = new THREE.Mesh(bandGeo, bandMat); bandMesh.position.set(0, 0.01, CZ); bandMesh.renderOrder = -1; scene.add(bandMesh);
    const wipePlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0); bandMat.clippingPlanes = [wipePlane];

    // the character
    const rig: Rig = buildFigure(scene);
    // sparkles: two layers rising past him, kept inside the band by clipping planes
    const bandTop = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), bandBot = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const dot = dotTexture();
    const swarm = [0, 1].map((k) => {
      const n = Math.round(110 * LOADING.sw), pos = new Float32Array(n * 3), geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ size: (k ? 0.028 : 0.04) * (bufH / 852), map: dot, color: themeRef.current.spark[k], transparent: true, depthWrite: false, opacity: 0.95,
        blending: themeRef.current.add ? THREE.AdditiveBlending : THREE.NormalBlending, clippingPlanes: [bandTop, bandBot] });
      const pts = new THREE.Points(geo, mat); scene.add(pts);
      return { pts, pos, mat, data: Array.from({ length: n }, () => ({ x: gauss(), y: gauss() * 0.4, z: Math.random() * 2 - 1, v: 0.6 + Math.random() * 0.9, w: Math.random() * 2 * Math.PI })) };
    });

    const charCenter = new THREE.Vector3();
    let last = Date.now(), lastTheme = themeRef.current, first = true;
    const frame = () => {
      if (gen.current !== myGen) { renderer.dispose(); return; }
      const now = Date.now(), dt = Math.min(0.1, (now - last) / 1000), t = (now - t0.current) / 1000; last = now;
      const TT = themeRef.current;
      if (TT !== lastTheme) { lastTheme = TT; bandMat.color.set(TT.band); swarm.forEach((s, k) => { s.mat.color.set(TT.spark[k]); s.mat.blending = TT.add ? THREE.AdditiveBlending : THREE.NormalBlending; s.mat.needsUpdate = true; }); }
      renderer.setClearColor(new THREE.Color(TT.page), 1);
      // the band
      const pb = arrive(LOADING.band, t);
      bandMesh.scale.set(Math.max(0.001, pb.sx), 1, Math.max(0.001, pb.sy));
      bandMesh.position.x = pb.dx * band.tw + (pb.jit ? (Math.random() - 0.5) * 0.3 * pb.jit : 0);
      bandMesh.position.z = CZ - pb.dy * band.th;
      bandMesh.rotation.y = -d2r(pb.rot);
      bandMat.opacity = pb.alpha;
      wipePlane.constant = CZ - band.th / 2 + band.th * pb.wipe; // clips what is above the wipe line
      // the character: his drift clock starts the moment he arrives, at the loop phase chosen in the lab
      const pc = arrive(LOADING.char, t), cs = Math.min(pc.sx, pc.sy);
      const clockC = LOADING.phase * PERIOD + Math.max(0, t - LOADING.char.delay) * LOADING.speed;
      applyPose(rig, posed(clockC, LOADING.motion));
      const sc = band.th * 0.2 * LOADING.ls, root = rig.root; root.scale.setScalar(sc * Math.max(0.001, cs));
      root.position.x = band.tw * (0.317 + LOADING.lx * 0.2) + pc.dx * band.th * 0.8;
      root.position.y = LOADING.lz * band.th * 0.8;
      root.position.z = CZ + 0.25 * sc + LOADING.ly * band.th * 0.4 + (root.position.z - rig.baseZ) * sc - pc.dy * band.th * 0.8 + (pc.jit ? (Math.random() - 0.5) * 0.04 * pc.jit : 0);
      root.rotation.x += d2r(LOADING.pitch); root.rotation.y += d2r(LOADING.yaw + pc.rot); root.rotation.z += d2r(LOADING.roll);
      viewLock(rig, camera);
      setFigureAlpha(pc.alpha);
      charCenter.set(root.position.x, root.position.y, root.position.z - 0.2 * sc);
      // sparkles
      bandTop.constant = CZ + (band.th / 2) * pb.sy; bandBot.constant = -(CZ - (band.th / 2) * pb.sy);
      const size = sc * 3 * Math.max(0.05, cs), spread = size * 0.32 * LOADING.sspread;
      for (const s of swarm) {
        s.data.forEach((q, i) => {
          q.z += dt * q.v * 0.35 * LOADING.srise;
          if (q.z > 1) { q.z = -1; q.x = gauss(); q.y = gauss() * 0.4; }
          const sway = Math.sin(t * 1.3 + q.w) * 0.06;
          s.pos[i * 3] = charCenter.x + (q.x * 0.55 + sway) * spread; s.pos[i * 3 + 1] = charCenter.y + q.y * spread; s.pos[i * 3 + 2] = charCenter.z + q.z * size * 0.6;
        });
        (s.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }
      renderer.render(scene, camera);
      g.endFrameEXP();
      if (first) { first = false; firstFrame.current?.(); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, []);
  useEffect(() => () => { gen.current += 1; }, []);

  return (
    <View style={[styles.fill, { backgroundColor: T.page }]} onLayout={onLayout}>
      {size.w > 0 ? <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} msaaSamples={0} /> : null}
      {LOADING.wshow && size.w > 0 ? (
        <Animated.Text
          style={[wordStyle, { position: 'absolute', left: (size.w - bw) / 2 + bh * 0.22, top: (size.h - bh) / 2 + bh * 0.56 - fs * 0.78, fontSize: fs, lineHeight: fs * 1.05, color: T.word, fontStyle: fontsReady ? 'normal' : 'italic' },
            fontsReady ? { fontFamily: FONTS.serifItalic } : null]}
          numberOfLines={1}
          allowFontScaling={false}>
          Void Archive
        </Animated.Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
