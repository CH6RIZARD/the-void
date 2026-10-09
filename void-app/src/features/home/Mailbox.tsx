// The mailbox (handoff THE-VOID-22b §2, `ring` cut): a flag mailbox outlined inside an
// 11r circle, 32px, in a 42×36 hit area right of the masthead. Unread: flag up, door
// hanging open below the body, gold dot top-right. Tap -> Mail opens and it is seen:
// the flag folds down the right side (90°, .45s), the door swings shut (.5s), the dot
// scales out. While Mail is open the box cross-fades into the back arrow in place
// (box rotate(-90deg) scale(.4) out, arrow rotate(90deg) scale(.4) in, .34s).
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { WEB } from '../../theme/motion';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';

const GOLD = '#c9a84c';
const CB = WEB.SHEET;
const RM = ReduceMotion.System;

export function Mailbox({ unread, open, onPress, hidden }: { unread: boolean; open: boolean; onPress: () => void; hidden: boolean }) {
  const { colors } = useTheme();
  const seen = useSharedValue(unread ? 0 : 1);
  const mail = useSharedValue(open ? 1 : 0);
  const vis = useSharedValue(hidden ? 0 : 1);
  useEffect(() => {
    seen.value = withTiming(unread ? 0 : 1, { duration: 500, easing: CB, reduceMotion: RM });
  }, [unread, seen]);
  useEffect(() => {
    mail.value = withTiming(open ? 1 : 0, { duration: 340, easing: CB, reduceMotion: RM });
  }, [open, mail]);
  useEffect(() => {
    vis.value = withTiming(hidden ? 0 : 1, { duration: hidden ? 220 : 300, easing: CB, reduceMotion: ReduceMotion.Never });
  }, [hidden, vis]);

  const wrap = useAnimatedStyle(() => ({ opacity: vis.value }));
  const box = useAnimatedStyle(() => ({ opacity: 1 - mail.value, transform: [{ rotate: `${-90 * mail.value}deg` }, { scale: 1 - 0.6 * mail.value }] }));
  const arrow = useAnimatedStyle(() => ({ opacity: mail.value, transform: [{ rotate: `${90 * (1 - mail.value)}deg` }, { scale: 0.4 + 0.6 * mail.value }] }));
  // the flag box is centred on its pivot (22,13); the door box on the hinge (14,19)
  const flag = useAnimatedStyle(() => ({ transform: [{ rotate: `${90 * seen.value}deg` }] }));
  const door = useAnimatedStyle(() => ({ transform: [{ scaleY: 1 - 2 * (1 - seen.value) }] }));
  const dot = useAnimatedStyle(() => ({ opacity: 1 - seen.value, transform: [{ scale: 0.4 + 0.6 * (1 - seen.value) }] }));

  return (
    <Animated.View style={[styles.hit, wrap]} pointerEvents={hidden ? 'none' : 'auto'}>
      <Pressable onPress={onPress} accessibilityLabel={open ? 'Back' : unread ? 'Mail, new' : 'Mail'} style={styles.hit}>
        <Animated.View style={[styles.box, box]}>
          <Svg width={32} height={32} viewBox="0 0 32 32">
            <Circle cx={16} cy={16} r={11} stroke={GOLD} strokeOpacity={0.35} strokeWidth={1} fill="none" />
            {/* body: dome top, post under the right half */}
            <Path d="M9 19V13a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5v6H9z" stroke={GOLD} strokeWidth={1.4} strokeLinejoin="round" fill="none" />
            <Path d="M20 19v5" stroke={GOLD} strokeWidth={1.4} strokeLinecap="round" />
          </Svg>
          {/* door: arched, hinged at the body's bottom edge */}
          <Animated.View style={[styles.part, { left: 9, top: 13, width: 10, height: 12 }, door]}>
            <Svg width={10} height={12} viewBox="9 13 10 12">
              <Path d="M11 19v-3a3 3 0 0 1 6 0v3z" stroke={GOLD} strokeWidth={1.2} fill="none" strokeLinejoin="round" />
            </Svg>
          </Animated.View>
          {/* flag: stem and paddle, pivot at the stem's foot */}
          <Animated.View style={[styles.part, { left: 16, top: 7, width: 12, height: 12 }, flag]}>
            <Svg width={12} height={12} viewBox="16 7 12 12">
              <Path d="M22 13V8.5" stroke={GOLD} strokeWidth={1.4} strokeLinecap="round" />
              <Rect x={22} y={8} width={3.5} height={2.5} rx={0.5} fill={GOLD} />
            </Svg>
          </Animated.View>
          <Animated.View style={[styles.dot, dot]} />
        </Animated.View>
        <Animated.View style={[styles.arrow, arrow]} pointerEvents="none">
          <Icon name="back" size={18} color={colors.white} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hit: { width: 42, height: 36, alignItems: 'center', justifyContent: 'center' },
  box: { width: 32, height: 32 },
  part: { position: 'absolute' },
  dot: { position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD },
  arrow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
export default Mailbox;
