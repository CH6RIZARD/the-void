// Small shared pieces of the Jump In flow, sized from the mock's CSS.
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { FONTS, em } from '../../theme/palettes';
import { VText } from '../../ui/Text';

export const GOLD = '#c9a84c';
export const INK = '#04020c';
export const WHITE = '#f4f0ff';
export const LAV = '#8d7cc0';
export const DIM = '#5c4d8a';
export const RED = '#ef4444';

/** @keyframes vfadeIn { from { opacity:0; translateY(14px) } } .5s ease */
export function Enter({ children, style, delay = 0 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; delay?: number }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) });
  }, [v, delay]);
  const a = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (1 - v.value) * 14 }] }));
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/** The red live dot: @keyframes blink 1.3s. */
export function BlinkDot({ size = 5 }: { size?: number }) {
  const v = useSharedValue(1);
  useEffect(() => {
    v.value = withRepeat(withTiming(0.1, { duration: 650 }), -1, true);
  }, [v]);
  const a = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: RED }, a]} />;
}

/** Gold CTA: padding 16, radius 26, Syne 800 13 .3em (a size up from Pill gold). */
export function CTA({ label, onPress, disabled, ghost, style }: { label: string; onPress: () => void; disabled?: boolean; ghost?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.cta,
        ghost ? { boxShadow: 'inset 0px 0px 0px 1px rgba(255,255,255,0.12)' } : { boxShadow: '0px 10px 30px rgba(201,168,76,0.3)' },
        disabled ? { opacity: 0.55 } : pressed ? { opacity: 0.92 } : null,
        style,
      ]}
    >
      {ghost ? null : <LinearGradient colors={[GOLD, '#a8873a']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 26 }]} />}
      {/* SHOW ME EVERYTHING did not fit and came out as 'SHOW ME EVERYTHI…'.
          At 13px with 0.3em tracking it runs past the pill on a 360dp screen,
          and numberOfLines={1} then ate the end of it. Shrinking beats clipping:
          short labels are untouched, long ones step down until they fit. */}
      <VText
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={{ fontFamily: FONTS.sansExtraBold, fontSize: 13, letterSpacing: em(13, 0.3), color: ghost ? LAV : INK }}
      >
        {label}
      </VText>
    </Pressable>
  );
}

export function Mono({ children, size = 8, tracking = 0.3, color = DIM, style }: { children: React.ReactNode; size?: number; tracking?: number; color?: string; style?: any }) {
  return <VText style={[{ fontFamily: FONTS.mono, fontSize: size, letterSpacing: em(size, tracking), color }, style]}>{children}</VText>;
}

export function Serif({ children, size, style }: { children: React.ReactNode; size: number; style?: any }) {
  return <VText style={[{ fontFamily: FONTS.serifItalic, fontSize: size, lineHeight: size * 1.18, color: WHITE }, style]}>{children}</VText>;
}

export function Logo({ size = 15 }: { size?: number }) {
  return (
    <VText style={{ fontFamily: FONTS.sansExtraBold, fontSize: size, letterSpacing: em(size, 0.14), color: WHITE }}>
      THE
      <VText style={{ fontFamily: FONTS.sansExtraBold, fontSize: size, color: GOLD, textShadowColor: 'rgba(201,168,76,0.6)', textShadowRadius: 18 }}>⬡</VText>
      VOID
    </VText>
  );
}

/** Section rule: GOLD LABEL ────── (optional right label). */
export function Rule({ label, right }: { label: string; right?: string }) {
  return (
    <View style={s.rule}>
      <Mono tracking={0.22} color={GOLD}>
        {label}
      </Mono>
      <LinearGradient colors={['rgba(201,168,76,0.3)', 'rgba(201,168,76,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.ruleLine} />
      {right ? (
        <Mono tracking={0.14} color={DIM}>
          {right}
        </Mono>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  cta: { width: '100%', paddingVertical: 16, borderRadius: 26, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  ruleLine: { flex: 1, height: 1 },
});
