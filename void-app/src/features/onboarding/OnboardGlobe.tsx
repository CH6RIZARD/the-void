// Jump In, screen 2: the decorative globe — a port of the mock's <void-globe>
// (void-globe.js) to expo-gl. Dark body, dotted land, twinkling nation lights,
// gold/violet atmosphere; the centre sits on the bottom edge so only the upper
// hemisphere shows. Drag to turn; it drifts on its own otherwise.
//
// Deliberately NOT the app's globeScene: no textures, no stars, no raycasting, one
// draw per layer. The test phone (Helio P35) never got the full globe to render;
// if this one can't either, the gradient + gold horizon underneath still read as
// the screen, and the GL layer only fades in once it has drawn a frame.
import React, { useCallback, useEffect, useRef } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as THREE from 'three';
import { landPositions } from './landDots';

const NATIONS: ReadonlyArray<readonly [number, number]> = [
  [35.68, 139.69], [41.01, 28.98], [40.71, -74.0], [37.57, 126.98], [-33.87, 151.21], [31.77, 35.21], [25.03, 121.56], [40.41, 49.87],
  [40.18, 44.51], [50.45, 30.52], [59.93, 30.32], [9.03, 38.74], [48.86, 2.35], [52.52, 13.4], [51.5, -0.13], [55.75, 37.62],
  [39.9, 116.4], [28.61, 77.2], [19.08, 72.88], [13.76, 100.5], [1.35, 103.82], [-6.21, 106.85], [14.6, 120.98], [30.04, 31.24],
  [-1.29, 36.82], [6.52, 3.38], [-26.2, 28.05], [33.59, -7.6], [-23.55, -46.63], [-34.6, -58.38], [-12.05, -77.04], [4.71, -74.07],
  [19.43, -99.13], [34.05, -118.24], [41.88, -87.63], [45.5, -73.57], [64.15, -21.94], [24.71, 46.68], [25.2, 55.27], [35.69, 51.39],
  [33.31, 44.37], [41.3, 69.24], [47.92, 106.92], [21.03, 105.85], [27.72, 85.32], [-36.85, 174.76], [-17.83, 31.05], [15.5, 32.56],
  [14.69, -17.45], [5.6, -0.19], [36.75, 3.06], [38.72, -9.14], [40.42, -3.7], [41.9, 12.5], [59.33, 18.07], [60.17, 24.94],
  [52.37, 4.9], [50.08, 14.44], [47.5, 19.04], [44.43, 26.1], [37.98, 23.73], [-4.44, 15.27], [12.36, -1.53], [3.87, 11.52],
];

function toXYZ(lat: number, lon: number, r: number): [number, number, number] {
  const phi = ((90 - lat) * Math.PI) / 180,
    theta = ((lon + 180) * Math.PI) / 180;
  return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}

const RIM_VS = 'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';

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
      const W = gl.drawingBufferWidth,
        H = gl.drawingBufferHeight;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, W / Math.max(1, H), 0.1, 50);
      const group = new THREE.Group();
      scene.add(group);

      group.add(new THREE.Mesh(new THREE.SphereGeometry(0.992, 48, 48), new THREE.MeshBasicMaterial({ color: 0x07031a })));
      group.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(1.08, 48, 48),
          new THREE.ShaderMaterial({
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexShader: RIM_VS,
            fragmentShader:
              'varying vec3 vN;void main(){float i=pow(0.72-dot(vN,vec3(0.0,0.0,1.0)),3.5);gl_FragColor=vec4(vec3(0.79,0.66,0.30)*i*0.9+vec3(0.35,0.18,0.7)*i*0.5,i);}',
          }),
        ),
      );
      group.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(1.0, 48, 48),
          new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexShader: RIM_VS,
            fragmentShader: 'varying vec3 vN;void main(){float i=pow(1.0-abs(dot(vN,vec3(0.0,0.0,1.0))),4.0);gl_FragColor=vec4(vec3(0.49,0.36,0.93)*i,i*0.55);}',
          }),
        ),
      );

      // Land: 7,322 dots from the precomputed mask.
      const land = new THREE.BufferGeometry();
      land.setAttribute('position', new THREE.BufferAttribute(landPositions(1.0), 3));
      group.add(new THREE.Points(land, new THREE.PointsMaterial({ color: 0x8d7cc0, size: 0.011, transparent: true, opacity: 0.7, depthWrite: false, sizeAttenuation: true })));

      // Nation lights, each on its own phase and speed.
      const n = NATIONS.length,
        pos = new Float32Array(n * 3),
        phase = new Float32Array(n),
        speed = new Float32Array(n);
      NATIONS.forEach(([lat, lon], i) => {
        pos.set(toXYZ(lat, lon, 1.003), i * 3);
        phase[i] = Math.random() * Math.PI * 2;
        speed[i] = 0.6 + Math.random() * 1.4;
      });
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      lg.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
      lg.setAttribute('speed', new THREE.BufferAttribute(speed, 1));
      const lightMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        // The mock sized lights in CSS px × devicePixelRatio; the buffer here IS device px.
        uniforms: { uTime: { value: 0 }, uPR: { value: PixelRatio.get() }, uColor: { value: new THREE.Color(0xc9a84c) } },
        vertexShader:
          'attribute float phase;attribute float speed;uniform float uTime;uniform float uPR;varying float vA;void main(){float tw=0.5+0.5*sin(uTime*speed+phase);tw=pow(tw,3.0);vA=0.12+0.88*tw;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=(7.0+16.0*tw)*(3.0/-mv.z)*uPR;gl_Position=projectionMatrix*mv;}',
        fragmentShader:
          'uniform vec3 uColor;varying float vA;void main(){float d=length(gl_PointCoord-0.5);if(d>0.5)discard;float a=smoothstep(0.5,0.05,d);float core=smoothstep(0.16,0.0,d);gl_FragColor=vec4(uColor+vec3(core*0.7),a*vA);}',
      });
      group.add(new THREE.Points(lg, lightMat));

      // Globe centre on the view's bottom edge, width ≈ 1.08× the view (mock's fit()).
      camera.aspect = W / Math.max(1, H);
      const halfH = 1.16 / camera.aspect;
      camera.position.set(0, 0, halfH / Math.tan((camera.fov * Math.PI) / 360));
      group.position.y = -halfH * 0.98;
      camera.updateProjectionMatrix();

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
        lightMat.uniforms.uTime.value = (Date.now() - t0) / 1000;
        renderer.render(scene, camera);
        gl.endFrameEXP();
        if (first) {
          first = false;
          shown.value = withTiming(1, { duration: 600 });
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
          <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
