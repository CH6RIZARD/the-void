// The mailbox: a port of the handoff's `void-mailbox.js` (THE-VOID-22b, direction 2a
// Deep Tunnel) as the mock mounts it: a 44×44 button, 34px stage, a 32px gold-rimmed
// disc behind (rises with the back arrow), and the box at size 26, nudge 1.4 0.6.
//
// Same 24-grid paths, planes and pivots as the source: hull (ink), the side band
// (mid -> ink on back), the gold interior behind the door, the door panel (shade -> ink)
// with its latch bar, the flag at the rear of the side, and the chevron head.
// full = flag up + gold, door ajar to .88 over the gold crescent. empty = flag flipped
// down (scaleY -1), lavender, door flush. back = the body compresses about (11.75, 12.75)
// to scale(.76, .176) into a shaft, side and door resolve to ink, the flag and latch
// fade, the chevron unfolds from the door end. 300ms out / 500ms home, the source's ease.
// Each moving part is its own Svg layer turned by view transforms about its source
// transform-origin (animated SVG group props do not render on device).
// Taps within 80ms are ignored, as the source's mailLock.
import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect } from 'react-native-svg';
import { WEB } from '../../theme/motion';

const INK = '#c9bfe8';
const MID = '#9f93c9';
const SHADE = '#6f62a3';
const GOLD = '#c9a84c';
const EASE = WEB.SHEET; // cubic-bezier(.32,.72,.28,1)
const RM = ReduceMotion.System;

const HULL = 'M2.5 19V12A5.5 5.5 0 0 1 8 6.5H16A5 5 0 0 1 21 11.5V18.6Z';
const BAND = 'M13.5 19V12A5.5 5.5 0 0 0 8 6.5H16A5 5 0 0 1 21 11.5V18.6Z';
const DOOR = 'M3.5 18V12A4.5 4.5 0 0 1 12.5 12V18Z';
const FLAG = 'M18.5 9.5V3.6A.6.6 0 0 1 19.1 3H22A.6.6 0 0 1 22.6 3.6V4.7A.6.6 0 0 1 22 5.3H19.8V9.5Z';
const HEAD = 'M10 7L5 12L10 17';
// the empty flag: FLAG mirrored about the pivot line y = 9 (the source's scale(1,-1)), drawn as
// its own path because a negative scale does not render on Android
const FLAG_DOWN = 'M18.5 8.5V14.4A.6.6 0 0 0 19.1 15H22A.6.6 0 0 0 22.6 14.4V13.3A.6.6 0 0 0 22 12.7H19.8V8.5Z';

const SIZE = 26;
const K = SIZE / 24; // 24-grid unit -> px
const NUDGE = { x: 1.4, y: 0.6 };
const o = (x: number, y: number) => `${x * K}px ${y * K}px`;

/** one 24-grid layer at the box size */
function L({ children }: { children: React.ReactNode }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24" style={StyleSheet.absoluteFill}>
      {children}
    </Svg>
  );
}

export function Mailbox({ unread, open, onPress, hidden }: { unread: number; open: boolean; onPress: () => void; hidden: boolean }) {
  const full = unread > 0;
  const b = useSharedValue(open ? 1 : 0); // back
  const f = useSharedValue(full && !open ? 1 : 0); // full and showing the box
  const vis = useSharedValue(hidden ? 0 : 1);
  const first = useRef(true);
  useEffect(() => {
    const t = (ms: number, d = 0) => (first.current ? { duration: 0 } : { duration: ms, easing: EASE, reduceMotion: RM });
    b.value = open ? withTiming(1, t(300)) : withTiming(0, t(500));
    // the door / flag settle after the body on the way home, as the source's delays
    f.value = open ? withTiming(0, t(200)) : withDelay(first.current ? 0 : 140, withTiming(full ? 1 : 0, t(380)));
    first.current = false;
  }, [open, full, b, f]);
  useEffect(() => {
    vis.value = withTiming(hidden ? 0 : 1, { duration: hidden ? 220 : 300, easing: EASE, reduceMotion: ReduceMotion.Never });
  }, [hidden, vis]);

  const last = useRef(0);
  const press = () => {
    const now = Date.now();
    if (now - last.current < 80) return;
    last.current = now;
    onPress();
  };

  const wrap = useAnimatedStyle(() => ({ opacity: vis.value }));
  // the body: translate(nudge) scale(1) <-> translate(0,-.75) scale(.76,.176) about (11.75, 12.75)
  const body = useAnimatedStyle(() => ({
    transform: [
      { translateX: NUDGE.x * (1 - b.value) * K },
      { translateY: (NUDGE.y * (1 - b.value) - 0.75 * b.value) * K },
      { scaleX: 1 - 0.24 * b.value },
      { scaleY: 1 - 0.824 * b.value },
    ],
  }));
  const toInk = useAnimatedStyle(() => ({ opacity: b.value }));
  const offInk = useAnimatedStyle(() => ({ opacity: 1 - b.value }));
  const inner = useAnimatedStyle(() => ({ opacity: f.value }));
  const door = useAnimatedStyle(() => ({ transform: [{ scaleY: 1 - 0.12 * f.value }] }));
  const pull = useAnimatedStyle(() => ({ opacity: 1 - b.value }));
  // flag: scale(1,-1) when empty, none when full; gone on back
  // the fold through the pivot: up shrinks to the hinge as down grows from it (scale(1,-1) as two halves)
  const flagUp = useAnimatedStyle(() => ({ opacity: (1 - b.value) * Math.min(1, f.value * 2), transform: [{ scaleY: Math.max(0.01, f.value) }] }));
  const flagDown = useAnimatedStyle(() => ({ opacity: (1 - b.value) * Math.min(1, (1 - f.value) * 2), transform: [{ scaleY: Math.max(0.01, 1 - f.value) }] }));
  // chevron: scale(.25,0) -> none about (5, 12)
  const head = useAnimatedStyle(() => ({ opacity: b.value, transform: [{ scaleX: 0.25 + 0.75 * b.value }, { scaleY: b.value }] }));
  // the disc behind: scale(.7) -> none
  const disc = useAnimatedStyle(() => ({ opacity: b.value, transform: [{ scale: 0.7 + 0.3 * b.value }] }));

  return (
    <Animated.View style={[styles.hit, wrap]} pointerEvents={hidden ? 'none' : 'auto'}>
      <Pressable onPress={press} accessibilityRole="button" accessibilityLabel={open ? 'Back' : full ? `Mail · ${unread} new` : 'Mail'} style={styles.hit}>
        <View style={styles.stage}>
          <Animated.View style={[styles.disc, disc]}>
            <LinearGradient colors={['#1b1336', '#0f0a24']} style={styles.discFill} />
            <View pointerEvents="none" style={styles.discRing} />
          </Animated.View>
          <View style={styles.box}>
            <Animated.View style={[styles.layer, { transformOrigin: o(11.75, 12.75) }, body]}>
              <L>
                <Path d={HULL} fill={INK} />
              </L>
              <Animated.View style={[styles.layer, offInk]}>
                <L>
                  <Path d={BAND} fill={MID} />
                </L>
              </Animated.View>
              <Animated.View style={[styles.layer, toInk]}>
                <L>
                  <Path d={BAND} fill={INK} />
                </L>
              </Animated.View>
              <Animated.View style={[styles.layer, inner]}>
                <L>
                  <Path d={DOOR} fill={GOLD} />
                </L>
              </Animated.View>
              <Animated.View style={[styles.layer, { transformOrigin: o(8, 18) }, door]}>
                <Animated.View style={[styles.layer, offInk]}>
                  <L>
                    <Path d={DOOR} fill={SHADE} />
                  </L>
                </Animated.View>
                <Animated.View style={[styles.layer, toInk]}>
                  <L>
                    <Path d={DOOR} fill={INK} />
                  </L>
                </Animated.View>
                <Animated.View style={[styles.layer, pull]}>
                  <L>
                    <Rect x={6.6} y={8.4} width={2.8} height={0.9} rx={0.45} fill={INK} />
                  </L>
                </Animated.View>
              </Animated.View>
              <Animated.View style={[styles.layer, { transformOrigin: o(19.15, 9) }, flagDown]}>
                <L>
                  <Path d={FLAG_DOWN} fill={INK} />
                </L>
              </Animated.View>
              <Animated.View style={[styles.layer, { transformOrigin: o(19.15, 9) }, flagUp]}>
                <L>
                  <Path d={FLAG} fill={GOLD} />
                </L>
              </Animated.View>
            </Animated.View>
            <Animated.View style={[styles.layer, { transformOrigin: o(5, 12) }, head]}>
              <L>
                <Path d={HEAD} fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              </L>
            </Animated.View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -1 },
  stage: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  disc: { position: 'absolute', top: 1, left: 1, right: 1, bottom: 1, borderRadius: 16, boxShadow: '0px 3px 8px rgba(0,0,0,0.6)' },
  discFill: { flex: 1, borderRadius: 16 },
  discRing: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16, boxShadow: 'inset 0px 0px 0px 1px rgba(201,168,76,0.28), inset 0px 1px 0px rgba(255,230,160,0.12)' },
  box: { width: SIZE, height: SIZE },
  layer: { position: 'absolute', top: 0, left: 0, width: SIZE, height: SIZE },
});
export default Mailbox;
