// Root layout: boot the logic core, fonts + theme before first paint, providers,
// and the modal stack.
import '../src/lib/polyfills';
import 'react-native-reanimated';
// LiveKit's WebRTC globals (RTCPeerConnection, MediaStream, ...) must exist before
// any Room is built, and the earliest moment is here, before React renders. A
// require inside try/catch rather than an import: a dev client built before the
// native module was added would otherwise throw at boot instead of just losing
// calls (CallScreen reports "calls need a rebuilt app" in that case).
try {
  (require('@livekit/react-native') as typeof import('@livekit/react-native')).registerGlobals();
} catch {
  /* no native LiveKit module in this binary: rebuild the dev client */
}
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, InteractionManager, StyleSheet, View } from 'react-native';
import { mark, startHeartbeat } from '../src/core/slow';
import { earthAstcAsync } from '../src/features/globe/astcMap';
// Module evaluation time: the earliest moment JS can see. [boot] lines count from here.
const BOOT_T0 = Date.now();

// A GL SURFACE THAT COMES BACK EMPTY MUST NOT KILL THE APP. expo-gl's own
// onSurfaceCreate does getGl(id) -> global.__EXGLContexts[id] -> configureLogging(gl)
// with no check, so when the surface is re-created and the id is no longer registered
// it sets a property on undefined and throws on the JS thread. In a release build that
// is a hard crash, and it is what killed the app on tab switches (device log 09-23
// 12:24: "Cannot set property '__expoSetLogging' of undefined" from _onSurfaceCreate).
// Handing back an inert object instead turns that into a globe that reports it cannot
// start - GlobeCanvas checks the context it is given and shows its fallback.
(() => {
  const g = globalThis as any;
  if (g.__voidExglGuard) return;
  g.__voidExglGuard = true;
  let store: Record<string, any> = g.__EXGLContexts || {};
  Object.defineProperty(g, '__EXGLContexts', {
    configurable: true,
    get() {
      return new Proxy(store, {
        get(t, k: string) {
          const v = (t as any)[k];
          if (v !== undefined || typeof k === 'symbol') return v;
          return { __voidMissingContext: true };   // inert: GlobeCanvas refuses it
        },
      });
    },
    set(v) { store = v || {}; },
  });
})();
import { Stack } from 'expo-router';

// THE NIGHT MAP IS DECODED AT BOOT, NOT AT SCENE BUILD.
//
// The earth texture is an 8MB blob inflated in small yielding slices on the JS
// thread. Decoding it when the globe scene builds - which is also the moment
// the wall is creating players and connecting streams - meant every slice
// queued behind that storm, the decode crawled for minutes, and the user saw
// the purple fallback "forever" (measured: zero [globe] texture logs in a whole
// session). The map is now a file read natively (astcMap.ts), so it no longer
// competes with that storm for the JS thread and is warmed at launch: the
// pixels are a cache hit by the time anyone opens the globe tab, and the sphere
// is textured on its first frame. earthAstcAsync is memoized, so the
// scene's own call simply joins this one.
function useWarmEarthTexture() {
  useEffect(() => {
    earthAstcAsync().catch(() => {});
  }, []);
}
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FONT_ASSETS, ThemeProvider, useTheme } from '../src/theme/tokens';
import { ToastHost } from '../src/ui/Toast';
import { bootCore } from '../src/lib/core';
import { setVideoCacheSizeAsync } from 'expo-video';
import { CLIP_CACHE_BYTES } from '../src/features/feed/videoStore';
import { warmCodecs } from '../modules/expo-void-media';
import { AuthProvider } from '../src/lib/auth';
import { SensingProvider } from '../src/lib/sensing';
import { AudioOwnerProvider } from '../src/features/live';
import { registerPhotoViewer } from '../src/features/photo';
import { IncomingCallHost } from '../src/features/calls/IncomingCallSheet';
import { Image as ExpoImage } from 'expo-image';
import { Observe, ObserveRoot } from 'expo-observe';
import { LoadingScreen } from '../src/features/loading/LoadingScreen';
import { LOADING } from '../src/features/loading/arrivals';

SplashScreen.preventAutoHideAsync().catch(() => {});
// EAS Observe: launch time, per-screen time-to-render/interactive and slow/frozen frames,
// all collected natively and sent in batches. Network tracking stays off (the feed makes
// many requests); debug builds are not dispatched.
Observe.configure({ integrations: { 'expo-router': true } });
// configureCore + initAuth + loadModeration start before React renders anything.
const corePromise = bootCore();
// Must run before the first VideoPlayer exists (expo-video rule). Default is 1 GB.
setVideoCacheSizeAsync(CLIP_CACHE_BYTES).catch(() => {});
// Image taps anywhere (feed, carousel, thread OP) open /photo instead of the thread.
registerPhotoViewer();

export { ErrorBoundary } from 'expo-router';

function useCoreReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    corePromise.catch(() => {}).finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

function Shell() {
  const theme = useTheme();
  const coreReady = useCoreReady();
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const ready = coreReady && theme.ready && (fontsLoaded || !!fontError);
  // THE LOADING SCREEN (the user's Void Loading Lab, 2026-10-17) plays while the core boots and
  // for at least LOADING.minMs, so its arrivals finish even when boot is quick.
  const [held, setHeld] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setHeld(false), LOADING.minMs);
    return () => clearTimeout(t);
  }, []);
  const show = ready && !held;
  // The native splash gives way the moment the loading screen has drawn its first frame.
  const splashGone = useRef(false);
  const onLoadingFrame = useCallback(() => {
    if (splashGone.current) return;
    splashGone.current = true;
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.bg).catch(() => {});
  }, [theme.colors.bg]);

  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch(() => {});
    // The first frame of the real app. Everything before this was a dark view.
    mark('boot:ready');
    // Decoder list + one real decoder, off the first frame (report A.4 #6).
    InteractionManager.runAfterInteractions(() => warmCodecs());
    try {
      console.warn('[boot] ready after ' + (Date.now() - BOOT_T0) + 'ms (core ' + coreReady + ', theme ' + theme.ready + ', fonts ' + (fontsLoaded || !!fontError) + ')');
    } catch {}
  }, [ready]);

  // Backgrounding is the one safe moment to hand the decoded-image cache back: the
  // disk cache still has every file, so returning re-decodes at the size now needed
  // instead of holding the old bitmaps. Measured 2026-09-20: ~162 MB of graphics memory.
  // THE GLOBE TAB SHOULD NOT PAY FOR THREE.JS ON THE FRAME IT IS PRESSED.
  // The globe screen's module graph pulls in the whole of three, and the tab is
  // lazy, so the first press paid to evaluate it - several hundred milliseconds of
  // JS before anything to do with the globe had even started. Evaluating it at
  // startup would only move that cost onto the splash screen, so it happens a few
  // seconds after first paint instead, while the feed is being read: by the time
  // the tab is pressed the module is already in the registry and the press does
  // nothing but build the scene.
  //
  // Confirmed (cold_launch, 2026-10-08): the require is the ~420ms 'idle' stall
  // at the four-second mark. A timer alone fires it mid-scroll if the reader is
  // already in the feed, and a 400ms JS block under a fling is a run of dropped
  // frames. runAfterInteractions holds it until no touch or animation is in
  // flight, so the block lands between gestures, where nothing is drawing.
  useEffect(() => {
    let task: { cancel(): void } | undefined;
    const t = setTimeout(() => {
      task = InteractionManager.runAfterInteractions(() => {
        try {
          mark('boot:globeScene');
          require('../src/features/globe/globeScene');
          mark('idle');
        } catch {
          /* the tab still works, it just pays for itself again */
        }
      });
    }, 4000);
    return () => {
      clearTimeout(t);
      task?.cancel();
    };
  }, []);

  // The search discovery pool is session-global, and the first SEARCH open used
  // to start it from nothing - a blank grid for a full network round. Stocked a
  // few seconds in (the web's own setTimeout(pullSearchDiscovery, 5000)), the
  // first open deals instantly.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        (require('../src/core') as typeof import('../src/core')).pullSearchDiscovery().catch(() => 0);
      } catch {
        /* search still works, it just pays for its own first pull */
      }
    }, 5000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const stopHeartbeat = startHeartbeat();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') ExpoImage.clearMemoryCache().catch(() => {});
    });
    return () => {
      stopHeartbeat();
      sub.remove();
    };
  }, []);

  if (!show) return <LoadingScreen fontsReady={fontsLoaded || !!fontError} onFirstFrame={onLoadingFrame} />;

  const bg = theme.colors.bg;
  return (
    <AuthProvider>
      <SensingProvider>
        {/* One audio owner for every surface that can play sound (globe wall, reels, feed). */}
        <AudioOwnerProvider>
          <View style={[styles.fill, { backgroundColor: bg }]}>
            <StatusBar style={theme.isLight ? 'dark' : 'light'} />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg }, animation: 'fade' }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="index" />
              <Stack.Screen name="nation/[iso]" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
              {/* The thread draws its own scrim and lift-from-card animation. */}
              <Stack.Screen name="thread/[id]" options={{ presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: 'transparent' }, gestureEnabled: false }} />
              <Stack.Screen name="messages/[id]" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="u/[handle]" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="blocked" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
              <Stack.Screen name="reels" options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: '#05020e' } }} />
              {/* #photo-overlay: draws its own dark surface and swipe-down fade. */}
              <Stack.Screen name="photo" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' }, gestureEnabled: false }} />
              <Stack.Screen name="composer" options={{ presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: 'transparent' } }} />
              <Stack.Screen name="settings" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
              <Stack.Screen name="sign-in" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
              {/* A call: no swipe-away, the end button is the only way out. */}
              <Stack.Screen name="call" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: '#05020e' } }} />
              {/* Jump In: first launch (index.tsx) and every way back out of an account. */}
              <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: '#04020c' } }} />
              <Stack.Screen name="auth-callback" options={{ animation: 'none' }} />
            </Stack>
            <ToastHost />
            {/* Rings over any screen; inside AuthProvider so it knows whose calls to watch. */}
            <IncomingCallHost />
          </View>
        </AudioOwnerProvider>
      </SensingProvider>
    </AuthProvider>
  );
}

export default function RootLayout() {
  useWarmEarthTexture();
  return (
    <ObserveRoot>
      <GestureHandlerRootView style={styles.fill}>
        <SafeAreaProvider>
          <ThemeProvider>
            <Shell />
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ObserveRoot>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
