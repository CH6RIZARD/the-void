// #globe-canvas-wrap: the three.js globe on expo-gl + its overlays
// (#gtip tap label, #globe-search-icon, .globe-hint-line, #globe-search-modal).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import Svg, { Circle, Path } from 'react-native-svg';
import { createGlobeScene, type GlobeScene } from './globeScene';
import { GlobeSearch } from './GlobeSearch';
import { countries, type Country } from '../live/core';
import { em, useLiveTheme } from '../live/liveTheme';
import { useObserve } from 'expo-observe';

export interface GlobeCanvasProps {
  /** Render loop runs only while true (tab focused, GLOBE mode, app foregrounded). */
  running: boolean;
  onOpenCountry(c: Country): void;
}

/** #globe-canvas-wrap{height:clamp(240px,42vh,320px)} */
export function useGlobeHeight() {
  const { height } = useWindowDimensions();
  return Math.max(240, Math.min(height * 0.42, 320));
}

export function GlobeCanvas({ running, onOpenCountry }: GlobeCanvasProps) {
  const t = useLiveTheme();
  const { width } = useWindowDimensions();
  const height = useGlobeHeight();
  const scene = useRef<GlobeScene | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const size = useRef({ w: width, h: height });
  size.current = { w: width, h: height };
  const [tip, setTip] = useState<{ x: number; y: number; name: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const openRef = useRef(onOpenCountry);
  openRef.current = onOpenCountry;
  // EAS Observe TTI for the globe tab: the first frame the globe actually draws.
  const { markInteractive } = useObserve();
  const interactiveRef = useRef(markInteractive);
  interactiveRef.current = markInteractive;
  const markedRef = useRef(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // ── GL context + render loop ─────────────────────────────────────────────
  // The loop runs ONLY while the globe is the visible surface and the app is
  // foregrounded. It used to re-arm requestAnimationFrame 60x/s for as long as the
  // tab was mounted and just return early when hidden, which woke the JS thread
  // every frame on every tab for the rest of the session.
  const rafId = useRef<number | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  // A GL context or shader that fails on some GPU must never leave a black panel: the
  // globe falls back to the static night map, and search still opens every nation.
  // Each value mounts a fresh GLView. A context that comes back unusable bumps it
  // rather than leaving the screen empty for the session.
  const [glAttempt, setGlAttempt] = useState(0);
  const glRetries = useRef(0);
  const retryGl = useCallback(() => {
    if (glRetries.current >= 3) return;
    glRetries.current += 1;
    setTimeout(() => setGlAttempt(a => a + 1), 400 * glRetries.current);
  }, []);
  const onContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    // See the guard in app/_layout.tsx: a re-created surface can hand back a context
    // that is not real. Building a renderer on it would fail in a dozen places.
    if (!gl || typeof (gl as any).createTexture !== 'function' || (gl as any).__voidMissingContext) {
      try {
        console.warn('[globe] context unusable - rebuilding the canvas');
      } catch {}
      retryGl();
      return;
    }
    try {
      scene.current = createGlobeScene(gl, countries(), size.current.w, size.current.h);
      setSceneReady(true);
    } catch (e) {
      console.warn('[globe] scene failed - rebuilding the canvas', e);
      scene.current = null;
      retryGl();
    }
  }, []);
  useEffect(() => {
    const s = scene.current;
    if (!sceneReady || !s || !running || !appActive) return;
    let alive = true;
    const loop = (ts: number) => {
      if (!alive) return;
      rafId.current = requestAnimationFrame(loop);
      let drew = false;
      try {
        drew = s.frame(ts || Date.now());
      } catch (e) {
        console.warn('[globe] frame failed - rebuilding the canvas', e);
        alive = false;
        retryGl();
        return;
      }
      if (drew && !markedRef.current) {
        markedRef.current = true;
        interactiveRef.current({ params: { surface: 'globe' } });
      }
    };
    rafId.current = requestAnimationFrame(loop);
    return () => {
      alive = false;
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      rafId.current = null;
    };
  }, [sceneReady, running, appActive]);
  useEffect(
    () => () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      scene.current?.dispose();
      scene.current = null;
    },
    [],
  );

  // ── touch handling: web touchstart/touchmove/touchend, 1:1 ───────────────
  const tr = useRef({ prev: null as null | { x?: number; y?: number; pinch?: number }, start: null as null | { x: number; y: number; t: number } }).current;
  const gesture = Gesture.Manual()
    .runOnJS(true)
    .onTouchesDown((e, mgr) => {
      mgr.activate(); // the globe owns its gestures; the REELS⇄GLOBE swipe must not start here
      const s = scene.current;
      if (!s) return;
      setTip(null); // the tap label lives until the next touch
      s.clearHover();
      if (e.numberOfTouches === 1) {
        const p = e.allTouches[0];
        s.input.drag = true;
        tr.prev = { x: p.x, y: p.y };
        tr.start = { x: p.x, y: p.y, t: Date.now() };
      } else {
        tr.start = null; // a second finger is never a tap
      }
    })
    .onTouchesMove((e) => {
      const s = scene.current;
      if (!s) return;
      const i = s.input;
      if (e.numberOfTouches === 1 && i.drag && tr.prev && tr.prev.x != null && tr.prev.y != null) {
        const p = e.allTouches[0];
        const dx = p.x - tr.prev.x,
          dy = p.y - tr.prev.y;
        i.rVelY = dx * 0.007;
        i.rVelX = dy * 0.007;
        i.tRotY += dx * 0.007;
        i.tRotX += dy * 0.007;
        i.tRotX = Math.max(-1.3, Math.min(1.3, i.tRotX));
        tr.prev = { x: p.x, y: p.y };
      } else if (e.numberOfTouches === 1) {
        // coming back from a pinch: re-anchor instead of computing against a pinch record
        const p = e.allTouches[0];
        tr.prev = { x: p.x, y: p.y };
      }
      if (e.numberOfTouches === 2) {
        const a = e.allTouches[0],
          b = e.allTouches[1];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (tr.prev?.pinch) i.tZoom = Math.max(1.5, Math.min(4, i.tZoom + (tr.prev.pinch - d) * 0.005));
        tr.prev = { pinch: d };
      }
    })
    .onTouchesUp((e, mgr) => {
      const s = scene.current;
      if (e.numberOfTouches > 0) return;
      if (s) {
        s.input.drag = false;
        const p = e.changedTouches[0];
        if (tr.start && p && Math.abs(p.x - tr.start.x) < 12 && Math.abs(p.y - tr.start.y) < 12 && Date.now() - tr.start.t < 280) {
          // Mobile web fires the emulated hover on a tap: the marker lights and #gtip
          // shows the name at the finger, then the nation opens.
          const c = s.hover(p.x, p.y);
          if (c) {
            setTip({ x: p.x + 14, y: p.y + 10, name: c.n });
            openRef.current(c);
          }
        }
      }
      tr.prev = null;
      tr.start = null;
      mgr.end();
    })
    .onTouchesCancelled((_e, mgr) => {
      if (scene.current) scene.current.input.drag = false;
      tr.prev = null;
      tr.start = null;
      mgr.end();
    });

  // .globe-hint-line{animation:fout 5s ease forwards 3s}
  const hintO = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const a = Animated.sequence([Animated.delay(3000), Animated.timing(hintO, { toValue: 0, duration: 5000, easing: Easing.bezier(0.25, 0.1, 0.25, 1), useNativeDriver: true })]);
    a.start();
    return () => a.stop();
  }, [hintO]);

  return (
    <View style={[styles.wrap, { height }]}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          {/* The globe screen shows the GLOBE. There is no flat-map stand-in: a still
              picture of the world is not this screen, and it was on show every time the
              first canvas failed - which is why the globe only appeared after leaving
              and coming back, since that rebuilt the canvas and usually worked. A failed
              context now just rebuilds itself (glAttempt), and while that happens the
              screen stays dark rather than pretending to be a map. */}
          <GLView key={glAttempt} style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} msaaSamples={4} />
        </View>
      </GestureDetector>

      {tip ? (
        <View pointerEvents="none" style={[styles.tip, { left: tip.x, top: tip.y, borderColor: t.glow }]}>
          <Text numberOfLines={1} style={{ fontFamily: t.mono, fontSize: 8, letterSpacing: em(8, 0.15), color: t.white }}>
            {tip.name}
          </Text>
        </View>
      ) : null}

      <Pressable onPress={() => setSearchOpen(true)} style={[styles.searchIcon, { borderColor: t.border }]} hitSlop={8}>
        <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(4,2,12,0.8)' }]} />
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={t.white} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <Circle cx={11} cy={11} r={6.5} />
          <Path d="m20.5 20.5-4.8-4.8" />
        </Svg>
      </Pressable>

      <Animated.View pointerEvents="none" style={[styles.hint, { opacity: hintO }]}>
        <Text style={{ fontFamily: t.mono, fontSize: 7, letterSpacing: em(7, 0.2), color: t.dim }}>DRAG · PINCH · TAP NATION</Text>
      </Animated.View>

      {searchOpen ? (
        <GlobeSearch
          onClose={() => setSearchOpen(false)}
          onPick={(c) => {
            setSearchOpen(false);
            onOpenCountry(c);
          }}
        />
      ) : null}
    </View>
  );
}

// eslint-disable-next-line @typescript-eslint/no-var-requires

const styles = StyleSheet.create({
  wrap: { position: 'relative', width: '100%', flexShrink: 0, overflow: 'hidden', backgroundColor: '#04020c' },
  // #gtip{background:rgba(13,8,32,.95);border:1px solid var(--glow);padding:3px 9px;border-radius:2px}
  tip: { position: 'absolute', zIndex: 10, backgroundColor: 'rgba(13,8,32,0.95)', borderWidth: 1, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 2 },
  // #globe-search-icon{top:10px;left:12px;width:30px;height:30px;border-radius:50%}
  searchIcon: {
    position: 'absolute',
    top: 10,
    left: 12,
    zIndex: 15,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // .globe-hint-line{bottom:8px;left:50%;transform:translateX(-50%)}
  hint: { position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center', zIndex: 5 },
});
