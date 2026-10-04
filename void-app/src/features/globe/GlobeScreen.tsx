// GLOBE TAB — DUAL MODE (patch3 §5). One tab, two surfaces side by side:
//   REELS (default) ⇄ GLOBE (the original globe screen: globe canvas + LIVE FEEDS wall).
// web: #screen-globe, setGlobeMode(), initGlobeSwipe(), setGlobeOffset/clearGlobeOffset.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
import { onTabReselect } from '../../nav/reselect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ToastModule from '../../ui/Toast';
import { GlobeModeToggle } from './GlobeModeToggle';
import { bundledEarthPixelsAsync } from './textures';
import { GlobeCanvas, useGlobeHeight } from './GlobeCanvas';
import { ReelsView } from './ReelsView';
import { LiveWall, type LiveWallHandle } from '../live/LiveWall';
import { Icon } from '../../ui/icons/Icon';
import { cachedGlobeMode, loadGlobeMode, loadGrid3, saveGlobeMode, type GlobeMode } from './persist';
import { useLiveTheme } from '../live/liveTheme';
import type { Country } from '../live/core';
import { LoaderActiveContext } from '../../ui/loaders/useLoaderClock';

// #globe-reels-view,#globe-map-view{transition:transform .34s cubic-bezier(.22,.61,.36,1)}
const SLIDE = { duration: 340, easing: Easing.bezier(0.22, 0.61, 0.36, 1) };

function voidToast(msg: string) {
  const m: any = ToastModule;
  const fn = m.voidToast || m.showToast || m.toast || m.default;
  try {
    if (typeof fn === 'function') fn(msg);
    else if (fn && typeof fn.show === 'function') fn.show(msg);
  } catch {}
}

export interface GlobeScreenProps {
  /** Space the floating nav pill occupies at the bottom (web .screen{bottom:58px}). */
  bottomInset?: number;
}

export function GlobeScreen({ bottomInset = 58 }: GlobeScreenProps) {
  const t = useLiveTheme();
  const { width } = useWindowDimensions();
  const [mode, setModeState] = useState<GlobeMode | null>(cachedGlobeMode());
  const [grid3, setGrid3] = useState(false);
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    let alive = true;
    loadGlobeMode().then((m) => {
      if (alive) setModeState((cur) => cur ?? m);
    });
    loadGrid3().then((g) => {
      if (alive) setGrid3(g);
    });
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  return (
    // A GL SURFACE DOES NOT LEAVE WHEN YOU LEAVE THE TAB.
    //
    // GLView renders into its own window layer, composited by the system rather
    // than drawn into the app's view hierarchy - the same property the live wall
    // documents for its video tiles. Tabs never unmount here
    // (detachInactiveScreens={false}), so navigating away left the globe's
    // surface sitting ON TOP of whatever screen came next: the void feed with a
    // frozen globe over it and the nav pill correctly showing VOID, which reads
    // as the app having crashed.
    //
    // display:'none' is View.GONE on Android, and a GONE surface is released and
    // stops compositing. The wall has done this since September; the globe never
    // did.
    <View style={[styles.screen, { backgroundColor: t.bg }, focused ? null : styles.gone]}>
      {mode ? (
        <GlobeSurfaces
          initialMode={mode}
          width={width}
          grid3={grid3}
          focused={focused}
          appActive={appActive}
          bottomInset={bottomInset}
        />
      ) : null}
    </View>
  );
}

// THE WALL NEVER SHOWED (2026-09-21, test phone). The screen mounted before the stored
// mode had loaded, so the slide's shared values were created at REELS (0). When
// 'globe' arrived, an effect wrote modeSV = 1 in the same commit that mounted the two
// Animated.Views - and on Fabric that write can land before the views exist on the UI
// side, where Reanimated drops it. The surfaces stayed parked on REELS while every
// piece of state said GLOBE: the toggle lit GLOBE, the wall mounted and its players
// ran (visible in the thread dump), and the screen showed "PULLING SIGNAL...". Tapping
// GLOBE did nothing because it was already the mode, and the swipe only travels
// toward the OTHER mode, so there was no way out.
//
// Now the surfaces mount only once the mode is known, with their shared values BORN
// at that mode - there is no post-mount write to lose. Tapping the active mode
// re-snaps the slide, and the position is re-asserted a frame after mount.
function GlobeSurfaces({
  initialMode,
  width,
  grid3,
  focused,
  appActive,
  bottomInset,
}: {
  initialMode: GlobeMode;
  width: number;
  grid3: boolean;
  focused: boolean;
  appActive: boolean;
  bottomInset: number;
}) {
  const insets = useSafeAreaInsets();
  // Pull-to-refresh on the wall rebuilds the globe above it: they are one screen.
  const [globeNonce, setGlobeNonce] = useState(0);
  // DECODE THE MAP BEFORE ANY SCENE EXISTS TO LOSE IT.
  //
  // The night map reaches the sphere one of two ways: a direct GL upload, which
  // this chipset refuses with INVALID_OPERATION (the texture file documents it),
  // or a JS decode of the bundled pixels. The JS decode was kicked off BY THE
  // SCENE - so every GLView remount, and there is one on every pause, resume and
  // refresh, disposed the scene while the decode was still running and threw the
  // result away. The globe then kept the flat purple fallback, which is exactly
  // what the device watcher photographed.
  //
  // The decode caches its result for the life of the process, so it only has to
  // finish ONCE. Starting it here - on the screen, which outlives every canvas -
  // means the pixels are already in hand by the time any scene asks, and no
  // dispose can interrupt them.
  useEffect(() => {
    bundledEarthPixelsAsync().catch(() => {});
  }, []);
  // TAP THE GLOBE TAB AGAIN TO REFRESH IT.
  //
  // Pull-to-refresh lives on the WALL's scroll view, which is below the globe -
  // so pulling down ON the globe never reached it, and the globe's own gesture
  // takes that drag anyway to turn the sphere. There was no way to refresh the
  // half of the screen people were actually looking at.
  //
  // Re-tapping the tab is unambiguous, cannot be triggered by accident while
  // exploring, and is the same gesture that already refreshes the feed.
  useEffect(() => onTabReselect('globe', () => setGlobeNonce((n) => n + 1)), []);
  // TRUE WHILE THE TWO PANELS ARE MOVING.
  //
  // The wall's tiles render into SurfaceViews - a separate Android window layer
  // composited by the system - so they DO NOT move with their parent's transform.
  // Mid-swipe, the globe panel slides but its video surfaces stay put, and the
  // reels underneath come out from behind a live grid that is no longer where it
  // appears to be. LiveWall already knows the cure: display:'none' is View.GONE,
  // and a GONE SurfaceView releases its surface. Only the surface goes - players,
  // buffers and sockets survive, so settling re-attaches instead of reconnecting.
  const [sliding, setSliding] = useState(false);
  // THE GLOBE DOES NOT RENDER WHILE YOU ARE SCROLLING THE WALL - but that
  // lives on the UI thread now. The wall stamps wallScrollAtSV on every scroll
  // event and the render worklet holds its own frame while the stamp is fresh
  // (see wallScrollSignal.ts). The React latch that used to carry this signal
  // engaged frames late under load and cost a whole-tree commit per gesture.
  // True while a finger is on the globe. Expires by itself:
  // a gesture that ends without a clean release must not leave the wall asleep.
  const [globeTouching, setGlobeTouching] = useState(false);
  const touchOffT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markGlobeTouching = useCallback((on: boolean) => {
    if (touchOffT.current) clearTimeout(touchOffT.current);
    setGlobeTouching(on);
    if (on) touchOffT.current = setTimeout(() => setGlobeTouching(false), 1200);
  }, []);
  useEffect(() => () => { if (touchOffT.current) clearTimeout(touchOffT.current); }, []);
  const wallRef = useRef<LiveWallHandle>(null);
  const [refreshing, setRefreshing] = useState(false);
  // One button refreshes the whole tab - the globe above and the wall below are
  // one screen, and nobody wants to refresh half of it.
  const refreshAll = useCallback(() => {
    setRefreshing(true);
    setGlobeNonce((n) => n + 1);
    try {
      wallRef.current?.refresh();
    } catch {}
    setTimeout(() => setRefreshing(false), 900);
  }, []);
  // The globe's own gesture. The panel swipe must fail wherever this one is
  // active, or turning the globe doubles as a swipe to reels.
  const globeGesture = useRef<any>(null);
  const [mode, setModeState] = useState<GlobeMode>(initialMode);
  // modeSV: 0 = the LEFT panel, 1 = the RIGHT one. GLOBE is now the left panel and
  // REELS the right, so the toggle reads GLOBE | REELS in the order they sit in -
  // tapping the left label must not slide to the right view.
  const modeSV = useSharedValue(initialMode === 'reels' ? 1 : 0);
  const modeNum = useSharedValue(initialMode === 'reels' ? 1 : 0);
  const drag = useSharedValue(0);
  const W = useSharedValue(width);
  useEffect(() => {
    W.value = width;
  }, [W, width]);
  useEffect(() => {
    // Belt and braces: once the views surely exist, pin the slide to the mode.
    const id = requestAnimationFrame(() => {
      if (drag.value === 0) modeSV.value = modeNum.value;
    });
    return () => cancelAnimationFrame(id);
  }, [modeSV, modeNum, drag]);

  const setMode = useCallback(
    (m: GlobeMode, announce: boolean) => {
      // Continue from where the finger left the surfaces, then settle.
      modeSV.value = modeSV.value - drag.value;
      drag.value = 0;
      modeSV.value = withTiming(m === 'reels' ? 1 : 0, SLIDE);
      modeNum.value = m === 'reels' ? 1 : 0;
      saveGlobeMode(m);
      setModeState(m);
      // Say where you just landed (silent on initial entry).
      if (announce) voidToast(m === 'reels' ? 'REELS · FOR YOU' : 'GLOBE · TAP A NATION');
    },
    [modeSV, modeNum, drag],
  );

  const slideT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endSlideSoon = useCallback(() => {
    if (slideT.current) clearTimeout(slideT.current);
    slideT.current = setTimeout(() => setSliding(false), SLIDE.duration + 40);
  }, []);
  useEffect(() => () => { if (slideT.current) clearTimeout(slideT.current); }, []);

  // Drag-to-switch: clearly horizontal only, travel only toward the other surface,
  // commit past 22% of the width, else snap back. Gestures that start on the globe
  // canvas never switch (the canvas' manual gesture activates on touch-down).
  const swipe = Gesture.Pan()
    .requireExternalGestureToFail(globeGesture)
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .onStart(() => {
      'worklet';
      runOnJS(setSliding)(true);
    })
    .onUpdate((e) => {
      'worklet';
      const w = Math.max(1, W.value);
      const dx = modeNum.value === 0 ? Math.min(0, e.translationX) : Math.max(0, e.translationX);
      drag.value = dx / w;
    })
    .onEnd(() => {
      'worklet';
      if (Math.abs(drag.value) > 0.22) runOnJS(setMode)(modeNum.value === 0 ? 'reels' : 'globe', true);
      else drag.value = withTiming(0, SLIDE);
      // Give the slide time to land before the surfaces come back.
      runOnJS(endSlideSoon)();
    });

  // The left panel sits at (drag - mode)·100%; the right one a width further on.
  // Swapping which view is which is the whole change - the geometry is untouched.
  const mapStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (drag.value - modeSV.value) * W.value }] }));
  const reelsStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - modeSV.value + drag.value) * W.value }] }));

  const openCountry = useCallback((c: Country) => {
    router.push(`/nation/${c.iso}` as any);
  }, []);

  const globeVisible = focused && appActive && mode === 'globe';
  const reelsVisible = focused && appActive && mode === 'reels';
  // The GL context, the three.js scene and its textures are built the first time
  // GLOBE is shown, not on tab mount: most sessions open on REELS and may never
  // flip, and building the scene is heavy synchronous JS. Until then a panel of
  // the same size holds the layout.
  const globeH = useGlobeHeight();
  const [globeSeen, setGlobeSeen] = useState(initialMode === 'globe');
  useEffect(() => {
    if (mode === 'globe') setGlobeSeen(true);
  }, [mode]);

  return (
    <>
        <GestureDetector gesture={swipe}>
          <View style={styles.fill} collapsable={false}>
            <Animated.View style={[styles.view, { top: insets.top }, reelsStyle]} pointerEvents={mode === 'reels' ? 'auto' : 'none'}>
              {/* The hidden side of the slide stays mounted; its loaders must not tick. */}
              <LoaderActiveContext.Provider value={reelsVisible}>
                <ReelsView active={reelsVisible} />
              </LoaderActiveContext.Provider>
            </Animated.View>
            <Animated.View style={[styles.view, { top: insets.top }, mapStyle]} pointerEvents={mode === 'globe' ? 'auto' : 'none'}>
              <LoaderActiveContext.Provider value={globeVisible}>
                {globeSeen ? (
                  <GlobeCanvas running={globeVisible} onOpenCountry={openCountry} refreshNonce={globeNonce} gestureRef={globeGesture} onTouching={markGlobeTouching} />
                ) : (
                  <View style={{ height: globeH, backgroundColor: '#04020c' }} />
                )}
                {/* Built the first time GLOBE is shown (web: buildGlobeGrid inside setGlobeMode). */}
                <LiveWall ref={wallRef} active={globeVisible && !sliding} grid3={grid3} bottomInset={bottomInset} quiet={globeTouching} />
              </LoaderActiveContext.Provider>
            </Animated.View>
          </View>
        </GestureDetector>
      {/* Tapping the mode you are already in re-snaps the slide instead of doing
          nothing, so a surface that ever drifts out of sync is one tap from fixed. */}
      <GlobeModeToggle mode={mode} topInset={insets.top} onChange={(m) => setMode(m, m !== mode)} />
      {/* Top right, opposite the search button. A deliberate tap, which is the
          whole point - the pull gesture it replaces could not be told apart
          from the start of a scroll. */}
      <Pressable
        onPress={refreshAll}
        accessibilityRole="button"
        accessibilityLabel="Refresh the globe and the live wall"
        hitSlop={10}
        style={({ pressed }: { pressed: boolean }) => [styles.refreshBtn, { top: 10 + insets.top, opacity: pressed || refreshing ? 0.55 : 1 }]}
      >
        <Icon name="repost" size={16} color="#c9a84c" />
      </Pressable>
    </>
  );
}

export default GlobeScreen;

const styles = StyleSheet.create({
  gone: { display: 'none' },
  refreshBtn: { position: 'absolute', right: 16, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(13,8,32,0.72)', zIndex: 31 },
  screen: { flex: 1, overflow: 'hidden' },
  fill: { flex: 1 },
  view: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'column' },
});
