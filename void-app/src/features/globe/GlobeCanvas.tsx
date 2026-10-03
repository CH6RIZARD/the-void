// #globe-canvas-wrap: the three.js globe on expo-gl + its overlays
// (#gtip tap label, #globe-search-icon, .globe-hint-line, #globe-search-modal).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import Svg, { Circle, Path } from 'react-native-svg';
import { createGlobeScene, type GlobeScene } from './globeScene';
import { GlobeSearch } from './GlobeSearch';
import { countries, type Country } from '../live/core';
import { em, useLiveTheme } from '../live/liveTheme';
import { useObserve } from 'expo-observe';

export interface GlobeCanvasProps {
  /**
   * Handed down so the REELS/GLOBE swipe can be made to wait on this gesture.
   * Turning the globe is a drag, and a drag that starts on the globe was also
   * reaching the panel swipe - so exploring sometimes threw you into reels.
   */
  gestureRef?: React.MutableRefObject<any>;
  /** True while a finger is on the globe, so the wall can stand down. */
  onTouching?: (touching: boolean) => void;
  /** Bumped by pull-to-refresh: rebuild the canvas from scratch. */
  refreshNonce?: number;
  /** Render loop runs only while true (tab focused, GLOBE mode, app foregrounded). */
  running: boolean;
  onOpenCountry(c: Country): void;
}

/** #globe-canvas-wrap{height:clamp(240px,42vh,320px)} */
export function useGlobeHeight() {
  const { height } = useWindowDimensions();
  return Math.max(240, Math.min(height * 0.42, 320));
}

export function GlobeCanvas({ running, onOpenCountry, refreshNonce = 0, gestureRef, onTouching }: GlobeCanvasProps) {
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
  // THE THREE RETRIES ARE PER OUTAGE, NOT PER SESSION.
  //
  // glRetries only ever counted up. Three context losses at any point in the
  // session - and they happen, because leaving for a nation feed tears down and
  // rebuilds surfaces while a dozen video decoders fight over the GPU - burned
  // the budget permanently. After that retryGl was a no-op, so the NEXT loss
  // left a black panel with the country label still drawn over it, for as long
  // as the app stayed open. Coming back to the globe from a nation is exactly
  // the path that spends them.
  //
  // A frame that actually draws means the context is healthy, so the budget is
  // spent and can be given back. Three FAILURES IN A ROW still gives up.
  const noteGlHealthy = useCallback(() => {
    glRetries.current = 0;
  }, []);
  // A pull-to-refresh rebuilds the canvas, and gives back the retry budget with
  // it: an explicit refresh is exactly when someone is telling us the picture is
  // wrong, so it should never be refused for failures that happened earlier.
  const firstNonce = useRef(refreshNonce);
  useEffect(() => {
    if (refreshNonce === firstNonce.current) return;
    glRetries.current = 0;
    setGlAttempt((a) => a + 1);
  }, [refreshNonce]);
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
      // Consume whatever the finger did since the last JS frame. The shared
      // values accumulated on the UI thread; read-and-zero here keeps the
      // gesture exact across stalls - nothing lost, nothing replayed.
      const inp = s.input;
      const dY = accY.value;
      const dX = accX.value;
      const dZ = accZoom.value;
      if (dY !== 0) { accY.value = 0; inp.tRotY += dY; }
      if (dX !== 0) { accX.value = 0; inp.tRotX = Math.max(-1.3, Math.min(1.3, inp.tRotX + dX)); }
      if (dZ !== 0) { accZoom.value = 0; inp.tZoom = Math.max(1.5, Math.min(4, inp.tZoom + dZ)); }
      const dragging = dragSV.value === 1;
      if (dragging !== inp.drag) {
        inp.drag = dragging;
        if (!dragging) { try { touchingRef.current?.(false); } catch {} }
      }
      if (dragging) { inp.rVelY = velY.value; inp.rVelX = velX.value; }
      let drew = false;
      try {
        drew = s.frame(ts || Date.now());
      } catch (e) {
        console.warn('[globe] frame failed - rebuilding the canvas', e);
        alive = false;
        retryGl();
        return;
      }
      if (drew) {
        noteGlHealthy();
        if (!markedRef.current) {
          markedRef.current = true;
          interactiveRef.current({ params: { surface: 'globe' } });
        }
      }
    };
    rafId.current = requestAnimationFrame(loop);
    return () => {
      alive = false;
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      rafId.current = null;
    };
  }, [sceneReady, running, appActive, noteGlHealthy]);
  useEffect(
    () => () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      scene.current?.dispose();
      scene.current = null;
    },
    [],
  );

  // ── touch handling: web touchstart/touchmove/touchend, 1:1 ───────────────
  const touchingRef = useRef(onTouching);
  touchingRef.current = onTouching;
  const onTouchStartJS = useCallback(() => {
    try { touchingRef.current?.(true); } catch {}
    const sc = scene.current;
    if (!sc) return;
    setTip(null); // the tap label lives until the next touch
    sc.clearHover();
  }, []);
  const onTapJS = useCallback((x: number, y: number) => {
    const sc = scene.current;
    if (!sc) return;
    // Mobile web fires the emulated hover on a tap: the marker lights and
    // #gtip shows the name at the finger, then the nation opens.
    const c = sc.hover(x, y);
    if (c) {
      setTip({ x: x + 14, y: y + 10, name: c.n });
      openRef.current(c);
    }
  }, []);
  const gesture = Gesture.Manual()
    .withRef(gestureRef as any)
    .onTouchesDown((e, mgr) => {
      'worklet';
      mgr.activate(); // the globe owns its gestures; the REELS-GLOBE swipe must not start here
      if (e.numberOfTouches === 1) {
        const pt = e.allTouches[0];
        dragSV.value = 1;
        tg.value = { px: pt.x, py: pt.y, sx: pt.x, sy: pt.y, st: performance.now(), pinch: 0, tap: 1 };
      } else {
        tg.value = { ...tg.value, pinch: 0, tap: 0 }; // a second finger is never a tap
      }
      runOnJS(onTouchStartJS)();
    })
    .onTouchesMove((e) => {
      'worklet';
      const g = tg.value;
      if (e.numberOfTouches === 1 && dragSV.value === 1) {
        const pt = e.allTouches[0];
        if (g.pinch === 0) {
          const dx = pt.x - g.px;
          const dy = pt.y - g.py;
          accY.value += dx * 0.007;
          accX.value += dy * 0.007;
          velY.value = dx * 0.007;
          velX.value = dy * 0.007;
        }
        // coming back from a pinch re-anchors instead of jumping
        tg.value = { ...g, px: pt.x, py: pt.y, pinch: 0 };
      }
      if (e.numberOfTouches === 2) {
        const a2 = e.allTouches[0];
        const b2 = e.allTouches[1];
        const d = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        if (g.pinch > 0) accZoom.value += (g.pinch - d) * 0.005;
        tg.value = { ...g, pinch: d, tap: 0 };
      }
    })
    .onTouchesUp((e, mgr) => {
      'worklet';
      if (e.numberOfTouches > 0) return;
      dragSV.value = 0;
      const g = tg.value;
      const pt = e.changedTouches[0];
      if (g.tap === 1 && pt && Math.abs(pt.x - g.sx) < 12 && Math.abs(pt.y - g.sy) < 12 && performance.now() - g.st < 280) {
        runOnJS(onTapJS)(pt.x, pt.y);
      }
      mgr.end();
    })
    .onTouchesCancelled((_e, mgr) => {
      'worklet';
      dragSV.value = 0;
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
          {/* msaaSamples={0}.

              I turned antialias off in the three.js renderer and reported the
              globe's multisampling gone. It was not: THIS is the setting that
              controls it. expo-gl creates the surface, and it was still being
              asked for 4x MSAA - every pixel resolved four times, on a GPU that
              is also running the live wall's decoders directly underneath.

              The renderer flag was the wrong knob; this is the right one. */}
          {/* OPAQUE, BECAUSE IT IS.

              expo-gl's GLView is a TextureView hard-marked isOpaque=false, so
              HWUI alpha-blends its whole 720x640 area into the window every
              frame it is on screen - a read-modify-write over the largest
              layer on this screen, including while the globe is holding still
              during a wall scroll. The scene clears to solid 0x04020c (alpha 1,
              globeScene.ts); there is no transparent pixel to blend. Warm, the
              globe is the worst surface in the app and its cost is the GPU
              stage alone (p50 14.6ms of a 16.7ms frame). This is the one lever
              that removes work from that stage without touching the look.

              `opaque` is a prop this app adds to expo-gl (patches/expo-gl); the
              onboarding globe clears to alpha 0 and must not set it. */}
          <GLView key={glAttempt} style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} msaaSamples={0} opaque />
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
