// A UI-thread millisecond clock for the loaders.
// The web CSS animations are continuous time functions; driving them from a frame
// clock reproduces them exactly (including negative animation-delay) and, unlike
// withTiming/withRepeat, is never shortened or skipped by the OS reduce-motion
// setting. The user rule: loaders ALWAYS animate — while they can be seen.
//
// A loader that can't be seen does not tick. Every loader used to run a frame
// callback for as long as it was mounted, including on screens covered by a modal,
// on the hidden side of the globe tab's GLOBE/REELS slide, and on other tabs.
// Android detaches those views, so each frame's prop update failed with
// RetryableMountingLayerException and Reanimated logged a full Java stack trace for
// it — on the main thread, per loader, per frame. On the Helio P35 test phone that
// jammed input for 5 s+ (ANRs 2026-09-21 11:04 and 11:07). The clock now runs only
// while its screen is focused, its surface is shown, and the app is foregrounded.
import { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { NavigationContext } from 'expo-router/build/react-navigation/core';

/** For a surface that stays mounted while hidden (the globe tab's off-side view):
 *  wrap it in <LoaderActiveContext.Provider value={visible}>. Default: shown. */
export const LoaderActiveContext = createContext(true);

/** Focused screen (null-safe outside a navigator) and foregrounded app. */
function useScreenShown(): boolean {
  const nav = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => (nav ? nav.isFocused() : true));
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    if (!nav) return;
    setFocused(nav.isFocused());
    const offFocus = nav.addListener('focus', () => setFocused(true));
    const offBlur = nav.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [nav]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setAppActive(st === 'active'));
    return () => sub.remove();
  }, []);
  return focused && appActive;
}

export function useLoaderClock(active = true): SharedValue<number> {
  const surfaceShown = useContext(LoaderActiveContext);
  const screenShown = useScreenShown();
  const clock = useSharedValue(0);
  useFrameCallback(
    (frame) => {
      'worklet';
      clock.value = frame.timeSinceFirstFrame;
    },
    active && surfaceShown && screenShown,
  );
  return clock;
}
