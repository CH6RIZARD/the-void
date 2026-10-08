// The ring: a sheet over whatever screen is open, accept or decline. Mounted once
// (IncomingCallHost, app/_layout.tsx) next to ToastHost, so it needs no screen's
// cooperation; it shows itself whenever callStore says ringing-in.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { FONTS, em } from '../../theme/palettes';
import { VText } from '../../ui/Text';
import { Sheet } from '../../ui/Sheet';
import { PersonPfp } from '../../ui/Pfp';
import { Icon, type IconProps } from '../../ui/icons/Icon';
import { voidToast } from '../../ui/Toast';
import { ROUTES } from '../../nav/routes';
import { useAuth } from '../../lib/auth';
import { acceptCall, declineCall, subscribeIncomingCalls } from './callsApi';
import { useCallStore } from './callStore';

/** Sheet's close timing (src/ui/Sheet.tsx withTiming 220). */
const SHEET_CLOSE_MS = 220;

/**
 * A round call button: 64pt disc, label under it. Press feedback is a 120ms scale
 * on the UI thread (Reanimated CSS transition); reduced motion keeps the opacity
 * dip and drops the scale.
 */
export function CallButton({ icon, label, bg, color = '#fff', onPress, size = 64, accessibilityLabel }: { icon: IconProps['name']; label?: string; bg: string; color?: string; onPress: () => void; size?: number; accessibilityLabel?: string }) {
  const [pressed, setPressed] = useState(false);
  const still = useReducedMotion();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} onPress={onPress} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} hitSlop={8} pressRetentionOffset={16} style={[st.btnWrap, { minWidth: size }]}>
      <Animated.View style={[st.btn, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }, pressed ? (still ? st.btnDim : st.btnPressed) : null]}>
        <Icon name={icon} size={Math.round(size * 0.4)} color={color} />
      </Animated.View>
      {label ? <VText style={st.btnLabel}>{label}</VText> : null}
    </Pressable>
  );
}

export function IncomingCallSheet() {
  const { colors } = useTheme();
  const { phase, peer, kind, call } = useCallStore();
  const visible = phase === 'ringing-in' && !!peer && !!call;

  const accept = async () => {
    const convId = call?.conversation_id;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const err = await acceptCall();
    if (err) {
      voidToast(err);
      return;
    }
    // The accept flips phase to live, which closes the Sheet (220ms). Its Modal
    // must be gone before the call route presents: iOS refuses a second
    // presentation while one is in flight, and the callee would be live in the
    // room with no screen to hang up from.
    // ponytail: timed to Sheet's close; an onClosed prop on Sheet if it drifts
    if (convId) setTimeout(() => router.push({ pathname: ROUTES.call, params: { id: convId, kind } } as any), SHEET_CLOSE_MS + 40);
  };

  return (
    <Sheet visible={visible} onClose={declineCall} dismissOnScrim={false} draggable={false} scroll={false}>
      <View style={st.body}>
        <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.28), color: colors.navDim }}>{kind === 'video' ? 'INCOMING VIDEO CALL' : 'INCOMING VOICE CALL'}</VText>
        <View style={{ marginTop: 18 }}>
          <PersonPfp uid={peer?.id} handle={peer?.handle} label={peer?.name} size={84} ring />
        </View>
        <VText numberOfLines={1} style={{ marginTop: 14, fontFamily: FONTS.serif, fontSize: 22, color: colors.white }}>{peer?.name || 'void'}</VText>
        <VText style={{ marginTop: 4, fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.12), color: colors.dim }}>@{peer?.handle || 'void'}</VText>
        <View style={st.actions}>
          <CallButton icon="phoneEnd" label="DECLINE" bg="#ef4444" onPress={declineCall} />
          <CallButton icon={kind === 'video' ? 'camera' : 'phone'} label="ACCEPT" bg="#22c55e" onPress={accept} />
        </View>
      </View>
    </Sheet>
  );
}

/** Subscribes to my ringing rows while signed in, and renders the sheet. */
export function IncomingCallHost() {
  const { session } = useAuth();
  const me = session?.user?.id || null;
  useEffect(() => {
    if (!me) return;
    return subscribeIncomingCalls(me);
  }, [me]);
  return <IncomingCallSheet />;
}

const st = StyleSheet.create({
  body: { alignItems: 'center', paddingTop: 18, paddingBottom: 6 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 56, marginTop: 30 },
  btnWrap: { alignItems: 'center', gap: 10 },
  btn: {
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ scale: 1 }],
    opacity: 1,
    transitionProperty: ['transform', 'opacity'],
    transitionDuration: '120ms',
    transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
  } as any, // Reanimated CSS transition keys (same cast as ReelItem.follow)
  btnPressed: { transform: [{ scale: 0.95 }], opacity: 0.9 },
  btnDim: { opacity: 0.8 },
  btnLabel: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.2), color: '#a89bd6' },
});
