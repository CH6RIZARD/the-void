// Loader timing: when a loader may animate, and the native-driver loops that animate it.
// The web CSS animations are linear loops with negative animation-delay; useLoaderLoop
// reproduces them exactly and, like the web, ignores the OS reduce-motion setting.
// The user rule: loaders ALWAYS animate — while they can be seen.
//
// A loader that can't be seen does not tick. Every loader used to run a frame
// callback for as long as it was mounted, including on screens covered by a modal,
// on the hidden side of the globe tab's GLOBE/REELS slide, and on other tabs.
// Android detaches those views, so each frame's prop update failed with
// RetryableMountingLayerException and Reanimated logged a full Java stack trace for
// it — on the main thread, per loader, per frame. On the Helio P35 test phone that
// jammed input for 5 s+ (ANRs 2026-09-21 11:04 and 11:07). Loaders now run only
// while their screen is focused, their surface is shown, and the app is foregrounded.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing } from 'react-native';
import { NavigationContext } from 'expo-router/build/react-navigation/core';

/** For a surface that stays mounted while hidden (the globe tab's off-side view):
 *  wrap it in <LoaderActiveContext.Provider value={visible}>. Default: shown. */
export const LoaderActiveContext = createContext(true);

// ONE APPSTATE LISTENER FOR THE WHOLE APP.
// useScreenShown runs once per loader, and the wall mounts one loader per tile that
// is not yet playing - up to two dozen. Each was adding its own AppState listener
// and its own piece of state, so every foreground/background transition woke two
// dozen subscriptions to deliver one identical boolean. The value is global, so it
// is kept in one place and read from there.
let appActiveNow = AppState.currentState === 'active';
const appActiveSubs = new Set<(v: boolean) => void>();
AppState.addEventListener('change', (st) => {
  const v = st === 'active';
  if (v === appActiveNow) return;
  appActiveNow = v;
  for (const fn of appActiveSubs) fn(v);
});

function useAppActive(): boolean {
  const [v, setV] = useState(appActiveNow);
  useEffect(() => {
    setV(appActiveNow); // it may have changed between render and effect
    appActiveSubs.add(setV);
    return () => {
      appActiveSubs.delete(setV);
    };
  }, []);
  return v;
}

/** Focused screen (null-safe outside a navigator) and foregrounded app. */
function useScreenShown(): boolean {
  const nav = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => (nav ? nav.isFocused() : true));
  const appActive = useAppActive();
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
  return focused && appActive;
}

/** True while a loader can be seen: its screen focused, its surface shown, the app
 *  foregrounded, and the caller's own flag (e.g. not fading out) set. */
export function useLoaderShown(active = true): boolean {
  const surfaceShown = useContext(LoaderActiveContext);
  const screenShown = useScreenShown();
  return active && surfaceShown && screenShown;
}

// ── Native-driver loops ─────────────────────────────────────────────────────
// The loaders used to drive every particle from a Reanimated frame callback: one
// useAnimatedStyle per dot, 14 dots per SparkleLoader, re-evaluated every frame.
// With Reanimated's synchronous-props flag off (the default), each of those updates
// is a ShadowTree commit + layout on the UI thread, so a wall of 24 loading tiles
// was ~670 commits per frame - the "view layout" 85-91% on the test phone. A
// native-driver Animated.loop runs the same linear 0->1 ramp entirely on the UI
// thread: no JS, no commit, no layout. The curves are identical (linear, same
// duration, same negative-delay phase), so the loaders look exactly the same.

/**
 * A 0->1 linear ramp repeating every `duration` ms, `lead` ms ahead (a CSS negative
 * animation-delay), on the native driver. Runs only while `running`; when it resumes,
 * it picks the phase up from the wall clock, so it looks continuous.
 */
export function useLoaderLoop(duration: number, lead: number, running: boolean): Animated.Value {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const from = ((Date.now() + lead) % duration) / duration;
    v.setValue(from);
    if (!running) return;
    let alive = true;
    let anim: Animated.CompositeAnimation = Animated.timing(v, {
      toValue: 1,
      duration: Math.max(1, duration * (1 - from)),
      easing: Easing.linear,
      useNativeDriver: true,
      isInteraction: false,
    });
    anim.start(({ finished }) => {
      if (!finished || !alive) return;
      v.setValue(0);
      anim = Animated.loop(Animated.timing(v, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true, isInteraction: false }));
      anim.start();
    });
    return () => {
      alive = false;
      anim.stop();
    };
  }, [v, duration, lead, running]);
  return v;
}
