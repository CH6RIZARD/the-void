// Root layout: boot the logic core, fonts + theme before first paint, providers,
// and the modal stack.
import '../src/lib/polyfills';
import 'react-native-reanimated';
import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FONT_ASSETS, ThemeProvider, useTheme } from '../src/theme/tokens';
import { ToastHost } from '../src/ui/Toast';
import { bootCore } from '../src/lib/core';
import { AuthProvider } from '../src/lib/auth';
import { SensingProvider } from '../src/lib/sensing';
import { AudioOwnerProvider } from '../src/features/live';
import { registerPhotoViewer } from '../src/features/photo';
import { Image as ExpoImage } from 'expo-image';
import { Observe, ObserveRoot } from 'expo-observe';

SplashScreen.preventAutoHideAsync().catch(() => {});
// EAS Observe: launch time, per-screen time-to-render/interactive and slow/frozen frames,
// all collected natively and sent in batches. Network tracking stays off (the feed makes
// many requests); debug builds are not dispatched.
Observe.configure({ integrations: { 'expo-router': true } });
// configureCore + initAuth + loadModeration start before React renders anything.
const corePromise = bootCore();
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

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.bg).catch(() => {});
  }, [theme.colors.bg]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // Backgrounding is the one safe moment to hand the decoded-image cache back: the
  // disk cache still has every file, so returning re-decodes at the size now needed
  // instead of holding the old bitmaps. Measured 2026-09-20: ~162 MB of graphics memory.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') ExpoImage.clearMemoryCache().catch(() => {});
    });
    return () => sub.remove();
  }, []);

  if (!ready) return <View style={[styles.fill, { backgroundColor: '#04020c' }]} />;

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
              <Stack.Screen name="auth-callback" options={{ animation: 'none' }} />
            </Stack>
            <ToastHost />
          </View>
        </AudioOwnerProvider>
      </SensingProvider>
    </AuthProvider>
  );
}

export default function RootLayout() {
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
