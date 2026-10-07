// Overlay chrome of the nation screen, from the web CSS:
//   .c-overlay (radial skin per theme), .c-overlay-head / .c-eyebrow / .c-name /
//   .pulse-tag / .c-close, .cn-cta-head and .cn-feed-lbl (label + gold hairline + em),
//   .nf-status (nfPulse) and .nf-more.
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme';
import { FONTS, em, type RadialSpec } from '../../theme/palettes';
import { RadialFill } from '../../ui/Surface';
import { Icon } from '../../ui/icons';
import { LiveDot } from '../live/TileChrome';

/** .c-overlay{background:radial-gradient(120% 35% at 50% 0%,#12082e 0%,#04020c 55%)} */
const VOID_SKIN: RadialSpec = { rx: 120, ry: 35, cx: 50, cy: 0, stops: [{ color: '#12082e', offset: 0 }, { color: '#04020c', offset: 0.55 }] };
/** :root[data-theme="light"] .c-overlay{background:radial-gradient(120% 35% at 50% 0%,#f2ecdd 0%,#e7e0cf 55%)} */
const LIGHT_SKIN: RadialSpec = { rx: 120, ry: 35, cx: 50, cy: 0, stops: [{ color: '#f2ecdd', offset: 0 }, { color: '#e7e0cf', offset: 0.55 }] };

export function OverlaySkin() {
  const { name, colors } = useTheme();
  // :root[data-theme="dark"] .c-overlay{background:var(--bg)}
  if (name === 'dark') return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} />;
  const spec = name === 'light' ? LIGHT_SKIN : VOID_SKIN;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: spec.stops[1].color }]}>
      <RadialFill spec={spec} />
    </View>
  );
}

/**
 * .c-overlay-head{padding:20px 18px 12px;display:flex;align-items:flex-start;gap:10px}
 * .c-eyebrow{Syne Mono 8px;.3em;gold;margin-bottom:6px}  .c-name{DM Serif Display 32px;line-height:1}
 * .pulse-tag{gap:4px;padding:2px 8px;border:1px solid rgba(239,68,68,.3);border-radius:20px;Syne Mono 7px;.18em;red;margin-left:auto}
 * .c-close{32×32; X 16px; color:var(--dim)}
 */
export function OverlayHead({ eyebrow, name, topInset, onClose }: { eyebrow: string; name: string; topInset: number; onClose: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.head, { paddingTop: 20 + topInset }]}>
      <View style={styles.headId}>
        <Text numberOfLines={1} style={[styles.eyebrow, { color: colors.gold }]}>
          {eyebrow}
        </Text>
        <Text style={[styles.name, { color: colors.white }]}>{name}</Text>
      </View>
      <View style={[styles.pulseTag]}>
        <LiveDot />
        <Text style={[styles.pulseText, { color: colors.red }]}>LIVE</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={6} style={styles.close}>
        {({ pressed }) => <Icon name="x" size={16} color={pressed ? colors.white : colors.dim} />}
      </Pressable>
    </View>
  );
}

/**
 * .cn-cta-head (padding 18 22 10, gold, hairline .3) and .cn-feed-lbl (padding 18 22 8,
 * nav-dim, hairline .2): Syne Mono 7.5px .2em, gap 10, ::after flex:1 1px gradient, em nav-dim.
 * LIGHT: both hairlines rgba(154,123,45,.35).
 */
export function LabelRow({ kind, text, tail }: { kind: 'cta' | 'feed'; text: string; tail: string }) {
  const { colors, isLight } = useTheme();
  const cta = kind === 'cta';
  const hair = isLight ? 'rgba(154,123,45,0.35)' : cta ? 'rgba(201,168,76,0.3)' : 'rgba(201,168,76,0.2)';
  const hairEnd = isLight ? 'rgba(154,123,45,0)' : 'rgba(201,168,76,0)';
  return (
    <View style={[styles.lbl, { paddingBottom: cta ? 10 : 8 }]}>
      <Text style={[styles.lblText, { color: cta ? colors.gold : colors.navDim }]}>{text}</Text>
      <LinearGradient colors={[hair, hairEnd]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.hair} />
      <Text style={[styles.lblText, styles.lblTail, { color: colors.navDim }]}>{tail}</Text>
    </View>
  );
}

/** .nf-status{padding:34px 16px;Syne Mono 8px;.2em;dim;center;animation:nfPulse 1.8s ease-in-out infinite} */
export function FeedStatusLine({ text, onPress }: { text: string; onPress?: () => void }) {
  const { colors } = useTheme();
  const o = useSharedValue(0.45);
  const still = useReducedMotion();
  useEffect(() => {
    // Reduced motion froze the loop on its first frame - the faintest, 0.45 - on a
    // line already in the dim colour. Hold it at full strength instead.
    if (still) {
      o.value = 1;
      return;
    }
    // @keyframes nfPulse{0%,100%{opacity:.45}50%{opacity:1}} — each half 0.9s, CSS ease-in-out.
    o.value = 0.45;
    o.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.bezier(0.42, 0, 0.58, 1) }), -1, true);
  }, [o, still]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  const line = (
    <Animated.View style={[styles.status, style]}>
      <Text style={[styles.statusText, { color: colors.dim }]}>{text}</Text>
    </Animated.View>
  );
  if (!onPress) return line;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {line}
    </Pressable>
  );
}

/** .nf-more{padding:18px 0 6px;center;Syne Mono 7px;.25em;nav-dim} */
export function FeedMore() {
  const { colors } = useTheme();
  return (
    <View style={styles.more}>
      <Text style={[styles.moreText, { color: colors.navDim }]}>PULLING MORE SIGNAL{'…'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 18, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10, flexShrink: 0 },
  headId: { flex: 1, minWidth: 0 },
  eyebrow: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.3), marginBottom: 6 },
  name: { fontFamily: FONTS.serif, fontSize: 32, lineHeight: 32 },
  pulseTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 20,
    marginLeft: 'auto',
  },
  pulseText: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.18) },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  lbl: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 18, paddingHorizontal: 22 },
  lblText: { fontFamily: FONTS.mono, fontSize: 7.5, letterSpacing: em(7.5, 0.2), flexShrink: 1 },
  lblTail: { flexShrink: 0 },
  hair: { flex: 1, height: 1 },
  status: { width: '100%', paddingVertical: 34, paddingHorizontal: 16 },
  statusText: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.2), textAlign: 'center' },
  more: { paddingTop: 18, paddingBottom: 6 },
  moreText: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.25), textAlign: 'center' },
});
