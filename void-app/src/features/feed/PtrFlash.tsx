// #ptr-flash — the pull-to-refresh wash, pixel-for-pixel the web's showPtrFlash():
//
//   #ptr-flash{position:fixed;inset:0;z-index:90;pointer-events:none;opacity:0;transition:opacity .3s}
//   background rgba(3,1,10,.85)
//   20 × .sparkle-fallback-particle{2x2;radius 50%;gold;animation:pfloat linear infinite}
//      left: 0-100%  bottom: 0-100%  duration: 1.5-4.5s  delay: +0-1.5s  opacity: .2-.7 (until pfloat starts)
//   @keyframes pfloat{0%{opacity:.4;translate(0,0)}100%{opacity:0;translate(15px,-70px)}}
//   label "REFRESHING" Syne Mono 9px var(--muted) .18em, dead centre
//
// OFF THE JS THREAD. The old wash was `{refreshing ? <SparkleLoader/> : null}`: it
// could not appear until React rendered, and refreshVoidFeed() was busy on that same
// thread rebuilding the feed, so the flash showed late or after the list had already
// jumped. This one is mounted for good at opacity 0; showing it is ONE shared-value
// write (`flash.value = 1`), the fade runs as a Reanimated timing on the UI thread,
// and the twenty dots step in the SparkleLoader's UI-thread Skia clock. Nothing in
// the picture waits on JS once the write has landed.
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { ReduceMotion, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { Atlas, Canvas, Circle, rect, useColorBuffer, useRSXformBuffer, useTexture } from '@shopify/react-native-skia';
import { WEB } from '../../theme/motion';
import { FONTS, em } from '../../theme/palettes';
import { useTheme } from '../../theme/ThemeProvider';
import { ensureSparkleLoop, registerSparkleClock, unregisterSparkleClock } from '../../ui/SparkleLoader';
import { VText } from '../../ui/Text';

const COUNT = 20;
const DOT = 2;
const TEX = 12;

interface P { x: number; y: number; dur: number; delay: number; op: number }
const make = (): P[] => Array.from({ length: COUNT }, () => ({ x: Math.random(), y: Math.random(), dur: (1.5 + Math.random() * 3) * 1000, delay: Math.random() * 1500, op: 0.2 + Math.random() * 0.5 }));

/** `flash`: 1 shows, 0 hides. Written from anywhere (JS or a worklet); no render needed. */
export function PtrFlash({ flash }: { flash: SharedValue<number> }) {
  const { colors } = useTheme();
  // fresh random particles per show, like the web's innerHTML rebuild (regenerated while hidden, off the critical path)
  const [gen, setGen] = useState(0);
  const particles = useMemo(make, [gen]);
  useAnimatedReaction(
    () => flash.value,
    (now, before) => {
      if (before === 1 && now === 0) runOnJS(setGen)(Date.now());
    },
  );

  const op = useSharedValue(0);
  const t = useSharedValue(0);
  const on = useSharedValue(0);
  const boxW = useSharedValue(0);
  const boxH = useSharedValue(0);
  useAnimatedReaction(
    () => flash.value,
    (v) => {
      op.value = withTiming(v ? 1 : 0, { duration: 300, easing: WEB.EASE, reduceMotion: ReduceMotion.Never });
      if (v) {
        t.value = 0; // the web rebuilds the particles at t=0 on every show
        on.value = 1;
        ensureSparkleLoop();
      } else on.value = 0;
    },
  );
  useEffect(() => {
    registerSparkleClock(t, on);
    return () => unregisterSparkleClock(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fx = useMemo(() => particles.map((p) => p.x), [particles]);
  const fy = useMemo(() => particles.map((p) => p.y), [particles]);
  const fd = useMemo(() => particles.map((p) => p.dur), [particles]);
  const fl = useMemo(() => particles.map((p) => p.delay), [particles]);
  const fo = useMemo(() => particles.map((p) => p.op), [particles]);
  const sprites = useMemo(() => particles.map(() => rect(0, 0, TEX, TEX)), [particles]);
  const texture = useTexture(<Circle cx={TEX / 2} cy={TEX / 2} r={TEX / 2 - 1} color={colors.gold} />, { width: TEX, height: TEX });
  const transforms = useRSXformBuffer(COUNT, (val, i) => {
    'worklet';
    const w = boxW.value, h = boxH.value;
    if (!w || !h) { val.set(1, 0, -10, -10); return; }
    const e = t.value - fl[i];
    const ph = e <= 0 ? 0 : (e % fd[i]) / fd[i];
    val.set(DOT / TEX, 0, fx[i] * w + 15 * ph, h - fy[i] * h - DOT - 70 * ph);
  });
  const colorsBuf = useColorBuffer(COUNT, (c, i) => {
    'worklet';
    const e = t.value - fl[i];
    const a = e <= 0 ? fo[i] : 0.4 * (1 - (e % fd[i]) / fd[i]);
    c[0] = 1; c[1] = 1; c[2] = 1; c[3] = a;
  });
  const style = useAnimatedStyle(() => ({ opacity: op.value }));

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wash, style]}>
      <View style={StyleSheet.absoluteFill} onLayout={(e) => { boxW.value = e.nativeEvent.layout.width; boxH.value = e.nativeEvent.layout.height; }}>
        <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Atlas image={texture} sprites={sprites} transforms={transforms} colors={colorsBuf} />
        </Canvas>
      </View>
      <VText style={[styles.label, { color: colors.muted }]}>REFRESHING</VText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wash: { zIndex: 90, backgroundColor: 'rgba(3,1,10,0.85)', alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.18) },
});
export default PtrFlash;
