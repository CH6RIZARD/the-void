// voidToast — port of the web's single failure surface:
//   #void-toast{position:fixed;left:50%;bottom:96px;transform:translate(-50%,8px);padding:9px 16px;border-radius:20px;
//     background:var(--nav-bg);box-shadow:0 8px 24px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.07);
//     font-family:'Syne Mono';font-size:8px;letter-spacing:.2em;color:var(--white);opacity:0;transition:opacity .2s,transform .2s}
//   #void-toast.on{opacity:1;transform:translate(-50%,0)}   hidden again after 2200ms.
// Usage anywhere (no hook needed):  voidToast('SIGNAL LOST · RETRY')
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming, useReducedMotion } from 'react-native-reanimated';
import { WEB } from '../theme/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, em } from '../theme/palettes';
import { VText } from './Text';

export const TOAST = {
  signalLost: 'SIGNAL LOST · RETRY',
  tooLong: 'TOO LONG · 280 MAX',
  nothingToDrop: 'NOTHING TO DROP',
} as const;

type Listener = (msg: string) => void;
const listeners = new Set<Listener>();

/** Show the toast (latest message wins, 2.2s). Safe to call before the host mounts (no-op). */
export function voidToast(msg: string): void {
  listeners.forEach((l) => l(msg));
}

export function useToast() {
  return voidToast;
}

const EASE = WEB.EASE;

/** Mount once near the root (app/_layout.tsx does). */
export function ToastHost() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState('');
  const on = useSharedValue(0);
  const rise = useReducedMotion() ? 0 : 8; // reduced motion: fade only
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const l: Listener = (m) => {
      setMsg(m);
      on.value = withTiming(1, { duration: 200, easing: EASE, reduceMotion: ReduceMotion.Never });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        on.value = withTiming(0, { duration: 200, easing: EASE, reduceMotion: ReduceMotion.Never });
      }, 2200);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [on]);

  const style = useAnimatedStyle(() => ({ opacity: on.value, transform: [{ translateY: (1 - on.value) * rise }] }));

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.host]}>
      <Animated.View style={[styles.toast, { bottom: 96 + insets.bottom, backgroundColor: colors.navBg }, style]}>
        <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.2), color: colors.white }}>{msg}</VText>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { zIndex: 300, alignItems: 'center' },
  toast: {
    position: 'absolute',
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 20,
    boxShadow: '0px 8px 24px rgba(0,0,0,0.5), inset 0px 1px 0px rgba(255,255,255,0.07)',
  },
});

/** Aliases (other modules read the toast defensively). */
export const showToast = voidToast;
export default voidToast;
