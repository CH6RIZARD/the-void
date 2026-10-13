// The masthead (handoff THE-VOID-22b §1): `THE⬡` + a three-line stagger icon, one
// button. Tap -> the second word (Polls on Feed, Feed on Polls) unfolds on the same
// baseline, behind a 22px gold hairline, where the icon was. Tap the word -> switch
// section; tap anywhere else (full-screen scrim) -> folds back.
//
// Four reveals, rotated every ~30h (floor(now / 108e6) % 4) so a reader meets all of
// them across days: a collapse · b sweep · c flip · d type-on. Easing (.32,.72,.28,1).
// Hidden (thread / topic / suggest sheet / Mail): opacity 0, 14px left, .22s / .3s.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme/ThemeProvider';
import { FONTS, em } from '../../theme/palettes';
import { WEB } from '../../theme/motion';
import { VText } from '../../ui/Text';

const CB = WEB.SHEET; // cubic-bezier(.32,.72,.28,1)
const RM = ReduceMotion.System;
export type RevealKind = 'collapse' | 'sweep' | 'flip' | 'type-on';
const KINDS: RevealKind[] = ['collapse', 'sweep', 'flip', 'type-on'];
export const revealForNow = (now = Date.now()): RevealKind => KINDS[Math.floor(now / 108e6) % 4];
const LINE_W = [16, 10, 13];
const MAX_LETTERS = 5;

export interface MastheadProps {
  section: 'feed' | 'polls';
  onSwitch: (to: 'feed' | 'polls') => void;
  hidden: boolean;
  /** which reveal; default rotates every 30h */
  reveal?: RevealKind;
  /** the mailbox (and whatever else) sits in the same row, right-aligned */
  right?: React.ReactNode;
}

/** Owns the open / fold state; renders its own scrim. Mount it absolute-fill with pointerEvents="box-none". */
export function Masthead({ section, onSwitch, hidden, reveal, right }: MastheadProps) {
  const { colors, isLight } = useTheme();
  const insets = useSafeAreaInsets();
  const kind = reveal || revealForNow();
  const word = section === 'feed' ? 'Polls' : 'Feed';
  const letters = useMemo(() => word.split(''), [word]);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);

  const icon = useSharedValue(1); // 1 shown .. 0 gone
  const lines = [useSharedValue(0), useSharedValue(0), useSharedValue(0)]; // 0 rest .. 1 folded
  const rule = useSharedValue(0);
  const clip = useSharedValue(0);
  const L = [useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const hide = useSharedValue(hidden ? 1 : 0);
  const [wordW, setWordW] = useState(0);

  useEffect(() => {
    hide.value = withTiming(hidden ? 1 : 0, { duration: hidden ? 220 : 300, easing: CB, reduceMotion: ReduceMotion.Never });
    if (hidden && openRef.current) fold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

  const run = useCallback(
    (to: boolean) => {
      const n = letters.length;
      const T = (v: SharedValue<number>, target: number, ms: number, delay: number) => {
        v.value = withDelay(Math.round(delay * 1000), withTiming(target, { duration: ms, easing: CB, reduceMotion: RM }));
      };
      if (kind === 'collapse') {
        [0, 2].forEach((i) => T(lines[i], to ? 1 : 0, 280, to ? 0 : 0.2));
        T(icon, to ? 0 : 1, 180, to ? 0.16 : 0.14);
        T(rule, to ? 1 : 0, 300, to ? 0.22 : 0.05);
        T(clip, to ? 1 : 0, 400, to ? 0.3 : 0);
        L.forEach((v) => (v.value = 1));
      } else if (kind === 'sweep') {
        T(icon, to ? 0 : 1, 300, to ? 0 : 0.1);
        T(rule, to ? 1 : 0, 300, to ? 0.14 : 0.04);
        clip.value = 1;
        L.forEach((v) => T(v, to ? 1 : 0, 380, to ? 0.2 : 0));
      } else if (kind === 'flip') {
        T(icon, to ? 0 : 1, 300, to ? 0 : 0.12);
        T(rule, to ? 1 : 0, 300, to ? 0.16 : 0.04);
        clip.value = 1;
        L.forEach((v, i) => T(v, to ? 1 : 0, 400, to ? 0.18 + i * 0.035 : (n - 1 - i) * 0.02));
      } else {
        lines.forEach((v, i) => T(v, to ? 1 : 0, 220, to ? i * 0.06 : 0.2 + (2 - i) * 0.05));
        icon.value = 1;
        T(rule, to ? 1 : 0, 300, to ? 0.2 : 0.08);
        clip.value = 1;
        L.forEach((v, i) => T(v, to ? 1 : 0, 300, to ? 0.3 + i * 0.055 : (n - 1 - i) * 0.03));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, letters.length],
  );
  const unfold = () => {
    if (openRef.current) return;
    openRef.current = true;
    setOpen(true);
    run(true);
  };
  const fold = () => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    run(false);
  };
  const go = () => {
    const to = section === 'feed' ? 'polls' : 'feed';
    fold();
    onSwitch(to);
  };

  // ─── styles ──────────────────────────────────────────────────────────────
  const hudStyle = useAnimatedStyle(() => ({ opacity: 1 - hide.value, transform: [{ translateX: -14 * hide.value }] }));
  const iconStyle = useAnimatedStyle(() => {
    const g = 1 - icon.value;
    if (kind === 'sweep') return { opacity: icon.value, transform: [{ rotate: `${-90 * g}deg` }, { scale: 1 - 0.7 * g }] };
    if (kind === 'flip') return { opacity: icon.value, transform: [{ perspective: 120 }, { rotateX: `${90 * g}deg` }] };
    return { opacity: icon.value };
  });
  const lineStyles = [
    useAnimatedStyle(() => (kind === 'collapse' ? { transform: [{ translateY: 5 * lines[0].value }] } : kind === 'type-on' ? { transform: [{ scaleX: 1 - lines[0].value }] } : {})),
    useAnimatedStyle(() => (kind === 'type-on' ? { transform: [{ scaleX: 1 - lines[1].value }] } : {})),
    useAnimatedStyle(() => (kind === 'collapse' ? { transform: [{ translateY: -5 * lines[2].value }] } : kind === 'type-on' ? { transform: [{ scaleX: 1 - lines[2].value }] } : {})),
  ];
  const ruleStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: rule.value }] }));
  const clipStyle = useAnimatedStyle(() => ({ width: wordW ? wordW * clip.value : undefined }));
  const letterStyles = L.map((v) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => {
      const g = 1 - v.value;
      if (kind === 'sweep') return { opacity: v.value, transform: [{ translateX: -14 * g }] };
      if (kind === 'flip') return { opacity: v.value, transform: [{ perspective: 120 }, { rotateX: `${-90 * g}deg` }] };
      if (kind === 'type-on') return { opacity: v.value, transform: [{ translateY: 7 * g }] };
      return { opacity: 1 };
    }),
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {open ? <Pressable style={[StyleSheet.absoluteFill, { zIndex: 61 }]} onPress={fold} accessibilityLabel="Close" /> : null}
      <Animated.View pointerEvents={hidden ? 'none' : 'box-none'} style={[styles.hud, { paddingTop: insets.top }, hudStyle]}>
        <View style={styles.row} pointerEvents="box-none">
          {/* the icon, centred in the header */}
          <View style={styles.center} pointerEvents="box-none">
            <Pressable onPress={open ? fold : unfold} accessibilityLabel={open ? 'Close' : 'Sections'} hitSlop={8} style={styles.mark}>
              <VText style={[styles.logo, { color: colors.white }]}>
                THE<VText style={[styles.logo, { color: colors.gold }]}>⬡</VText>
              </VText>
            </Pressable>
          </View>
          {/* the menu (stagger icon) and the Polls / Feed word it unfolds into, on the left */}
          <Pressable onPress={open ? undefined : unfold} disabled={open} accessibilityLabel="Sections" style={styles.slot}>
            {/* the icon, in the word's place */}
            <Animated.View pointerEvents="none" style={[styles.icon, iconStyle]}>
              {LINE_W.map((w, i) => (
                <Animated.View key={i} style={[{ width: w, height: 1.5, borderRadius: 1, backgroundColor: colors.gold }, lineStyles[i]]} />
              ))}
            </Animated.View>
            {/* the word */}
            <Pressable onPress={go} disabled={!open} accessibilityLabel={word} style={[styles.wordRow, !open && { opacity: 0 }]} pointerEvents={open ? 'auto' : 'none'}>
              <Animated.View style={[styles.rule, ruleStyle]}>
                <LinearGradient colors={['#c9a84c', 'rgba(201,168,76,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
              </Animated.View>
              <Animated.View style={[styles.clip, clipStyle]}>
                <View onLayout={(e) => setWordW(Math.ceil(e.nativeEvent.layout.width) + 8)} style={styles.letters}>
                  {letters.slice(0, MAX_LETTERS).map((ch, i) => (
                    <Animated.View key={word + i} style={letterStyles[i]}>
                      <VText style={[styles.word, isLight && { color: colors.gold }]}>{ch}</VText>
                    </Animated.View>
                  ))}
                </View>
              </Animated.View>
            </Pressable>
          </Pressable>
          <View style={styles.right} pointerEvents="box-none">
            {right}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

// ponytail: the word is flat gold, not the mock's #f6e7b0 -> #8a6d2c text gradient (needs masked-view).

const styles = StyleSheet.create({
  hud: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 62 },
  row: { height: 44, flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 10 },
  center: { position: 'absolute', left: 0, right: 0, top: 0, height: 44, alignItems: 'center', justifyContent: 'center' },
  mark: { paddingVertical: 8, paddingHorizontal: 8 },
  logo: { fontFamily: FONTS.sansExtraBold, fontSize: 15, letterSpacing: em(15, 0.14) },
  slot: { height: 44, minWidth: 44, justifyContent: 'center' },
  icon: { position: 'absolute', left: 0, top: 14, height: 16, justifyContent: 'space-between', alignItems: 'flex-start' },
  wordRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  rule: { width: 22, height: 1, marginRight: 8, overflow: 'hidden', transformOrigin: 'left' },
  clip: { overflow: 'hidden' },
  letters: { flexDirection: 'row', alignItems: 'flex-end' },
  word: { fontFamily: FONTS.serifItalic, fontSize: 20, lineHeight: 24, color: '#e2c56a' },
  right: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center' },
});
