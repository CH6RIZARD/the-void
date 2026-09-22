// GLOBE TAB — DUAL MODE (patch3 §5). One tab, two surfaces side by side:
//   REELS (default) ⇄ GLOBE (the original globe screen: globe canvas + LIVE FEEDS wall).
// web: #screen-globe, setGlobeMode(), initGlobeSwipe(), setGlobeOffset/clearGlobeOffset.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ToastModule from '../../ui/Toast';
import { GlobeModeToggle } from './GlobeModeToggle';
import { GlobeCanvas } from './GlobeCanvas';
import { ReelsView } from './ReelsView';
import { LiveWall } from '../live/LiveWall';
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
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
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
  const [mode, setModeState] = useState<GlobeMode>(initialMode);
  // modeSV: 0 = REELS, 1 = GLOBE. drag: finger offset as a fraction of the width.
  const modeSV = useSharedValue(initialMode === 'globe' ? 1 : 0);
  const modeNum = useSharedValue(initialMode === 'globe' ? 1 : 0);
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
      modeSV.value = withTiming(m === 'globe' ? 1 : 0, SLIDE);
      modeNum.value = m === 'globe' ? 1 : 0;
      saveGlobeMode(m);
      setModeState(m);
      // Say where you just landed (silent on initial entry).
      if (announce) voidToast(m === 'reels' ? 'REELS · FOR YOU' : 'GLOBE · TAP A NATION');
    },
    [modeSV, modeNum, drag],
  );

  // Drag-to-switch: clearly horizontal only, travel only toward the other surface,
  // commit past 22% of the width, else snap back. Gestures that start on the globe
  // canvas never switch (the canvas' manual gesture activates on touch-down).
  const swipe = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      'worklet';
      const w = Math.max(1, W.value);
      const dx = modeNum.value === 0 ? Math.min(0, e.translationX) : Math.max(0, e.translationX);
      drag.value = dx / w;
    })
    .onEnd(() => {
      'worklet';
      if (Math.abs(drag.value) > 0.22) runOnJS(setMode)(modeNum.value === 0 ? 'globe' : 'reels', true);
      else drag.value = withTiming(0, SLIDE);
    });

  // reels: translateX((f - mode)·100%)   map: translateX((1 - mode + f)·100%)
  const reelsStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (drag.value - modeSV.value) * W.value }] }));
  const mapStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - modeSV.value + drag.value) * W.value }] }));

  const openCountry = useCallback((c: Country) => {
    router.push(`/nation/${c.iso}` as any);
  }, []);

  const globeVisible = focused && appActive && mode === 'globe';
  const reelsVisible = focused && appActive && mode === 'reels';

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
                <GlobeCanvas running={globeVisible} onOpenCountry={openCountry} />
                {/* Built the first time GLOBE is shown (web: buildGlobeGrid inside setGlobeMode). */}
                <LiveWall active={globeVisible} grid3={grid3} bottomInset={bottomInset} />
              </LoaderActiveContext.Provider>
            </Animated.View>
          </View>
        </GestureDetector>
      {/* Tapping the mode you are already in re-snaps the slide instead of doing
          nothing, so a surface that ever drifts out of sync is one tap from fixed. */}
      <GlobeModeToggle mode={mode} topInset={insets.top} onChange={(m) => setMode(m, m !== mode)} />
    </>
  );
}

export default GlobeScreen;

const styles = StyleSheet.create({
  screen: { flex: 1, overflow: 'hidden' },
  fill: { flex: 1 },
  view: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'column' },
});
