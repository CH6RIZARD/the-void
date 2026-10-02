// Jump In, screen 2: the decorative globe — a port of the mock's <void-globe>
// (void-globe.js) to expo-gl. Dark body, dotted land, twinkling nation lights,
// gold/violet rim; the centre sits on the bottom edge so only the upper hemisphere
// shows. Drag to turn; it drifts on its own otherwise. The scene itself lives in
// globeBuild.ts (depth-independent — see there for why).
//
// Deliberately NOT the app's globeScene: no textures, no stars, no raycasting. If a
// device can't draw GL at all, the gradient + gold horizon underneath still read as
// the screen, and the GL layer only fades in once it has drawn a frame.
import React, { useCallback, useEffect, useRef } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as THREE from 'three';
import { landPositions } from './landDots';
import { buildGlobe } from './globeBuild';

/** A three.js renderer on an expo-gl context — the same shims as globeScene.ts. */
function makeRenderer(gl: ExpoWebGLRenderingContext): THREE.WebGLRenderer {
  const rawPixelStorei = gl.pixelStorei.bind(gl);
  const allowed = new Set<number>([gl.UNPACK_FLIP_Y_WEBGL, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, gl.UNPACK_ALIGNMENT, gl.PACK_ALIGNMENT]);
  (gl as any).pixelStorei = (p: number, v: any) => {
    if (allowed.has(p)) rawPixelStorei(p as any, v);
  };
  const w = gl.drawingBufferWidth,
    h = gl.drawingBufferHeight;
  const canvas: any = { width: w, height: h, style: {}, clientWidth: w, clientHeight: h, addEventListener: () => {}, removeEventListener: () => {}, getContext: () => gl };
  // three ≥ r163 rejects a context that passes `instanceof WebGLRenderingContext`.
  const G = globalThis as any;
  const saved = G.WebGLRenderingContext;
  let hid = false;
  try {
    if (saved && gl instanceof saved) {
      G.WebGLRenderingContext = function NotWebGL1() {};
      hid = true;
    }
  } catch {}
  try {
    const r = new THREE.WebGLRenderer({ canvas, context: gl as any, antialias: false, alpha: true, precision: 'mediump' } as any);
    r.setPixelRatio(1);
    r.setSize(w, h, false);
    r.setClearColor(0x000000, 0);
    return r;
  } finally {
    if (hid) G.WebGLRenderingContext = saved;
  }
}

export function OnboardGlobe({ running = true }: { running?: boolean }) {
  const rot = useRef({ x: 0.25, y: -1.2, vel: 0, drag: false });
  const runRef = useRef(running);
  runRef.current = running;
  const raf = useRef<number | null>(null);
  const shown = useSharedValue(0);
  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));

  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
    },
    [],
  );

  const onContextCreate = useCallback(
    (gl: ExpoWebGLRenderingContext) => {
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = makeRenderer(gl);
      } catch {
        return; // no GL on this device: the static layer stays
      }
      const { scene, camera, group, setTime } = buildGlobe(THREE, gl.drawingBufferWidth, gl.drawingBufferHeight, PixelRatio.get(), landPositions(1.0));
      const t0 = Date.now();
      let first = true;
      const loop = () => {
        raf.current = requestAnimationFrame(loop);
        if (!runRef.current) return;
        const r = rot.current;
        if (!r.drag) {
          r.y += 0.0016 + r.vel;
          r.vel *= 0.95;
        }
        group.rotation.set(r.x, r.y, 0);
        setTime((Date.now() - t0) / 1000);
        renderer.render(scene, camera);
        gl.endFrameEXP();
        if (first) {
          first = false;
          // 600ms was long enough to read as the globe arriving LATE, after the
          // headline and the button were already there. This scene carries no
          // textures, so the only real wait is the GL context; once the first
          // frame is on screen there is nothing to hide behind a slow fade.
          shown.value = withTiming(1, { duration: 220 });
        }
      };
      loop();
    },
    [shown],
  );

  const pan = Gesture.Pan()
    .runOnJS(true)
    .onBegin(() => {
      rot.current.drag = true;
    })
    .onChange((e) => {
      const r = rot.current;
      r.y += e.changeX * 0.006;
      r.vel = e.changeX * 0.006;
      r.x = Math.max(-0.4, Math.min(0.9, r.x + e.changeY * 0.003));
    })
    .onFinalize(() => {
      rot.current.drag = false;
    });

  return (
    <GestureDetector gesture={pan}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, fade]}>
          <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} msaaSamples={4} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
