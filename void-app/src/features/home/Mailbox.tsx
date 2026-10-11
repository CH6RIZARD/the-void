// The mailbox, 1:1 with the handoff mock (THE-VOID-22b `Void Toggle Options.dc.html`,
// MAILBOX · ring cut): a 32px lavender (#c9bfe8) flag mailbox outlined inside an 11r
// circle, in a 42×36 hit area right of the masthead. Unread: flag up with a gold paddle,
// door hanging open below the body (scaleY(-1) on its hinge), 9px gold dot top-right
// ringed by the ground. Tap -> Mail opens and it is seen: the flag folds down (90°,
// .45s), the door swings shut (.5s), the paddle hollows, the dot scales out. While Mail
// is open the box cross-fades into the back arrow in a 32px gold-rimmed disc
// (box rotate(-90deg) scale(.4) out, arrow rotate(90deg) scale(.4) in, .34s).
//
// The door and flag are their own 32px Svg layers over the body, turned with RN
// transforms about `transformOrigin` = the mock's pivot (door hinge 50% 100%, flag
// 28% 100%) mapped through the mock's inner transform
// translate(12 12) scale(.6) translate(-10.65 -11.95) and the 24 -> 32 viewBox scale.
import React, { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { WEB } from '../../theme/motion';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon } from '../../ui/icons';

const GOLD = '#c9a84c';
const INK = '#c9bfe8';
const CB = WEB.SHEET;
const RM = ReduceMotion.System;
const INNER = 'translate(12, 12) scale(0.6) translate(-10.65, -11.95)';
// pivots in the 32px box: door hinge (8, 17.5) and flag foot (16.21, 7.4) in inner units
const px = (x: number, y: number) => [((12 + 0.6 * (x - 10.65)) * 32) / 24, ((12 + 0.6 * (y - 11.95)) * 32) / 24] as const;
const [DOOR_X, DOOR_Y] = px(8, 17.5);
const [FLAG_X, FLAG_Y] = px(16.21, 7.4);

const svgProps = { width: 32, height: 32, viewBox: '0 0 24 24', fill: 'none', stroke: INK, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

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
  const door = useAnimatedStyle(() => ({ transform: [{ scaleY: 1 - 2 * (1 - seen.value) }] }));
  const flag = useAnimatedStyle(() => ({ transform: [{ rotate: `${90 * seen.value}deg` }] }));
  const dot = useAnimatedStyle(() => ({ opacity: 1 - seen.value, transform: [{ scale: 0.4 + 0.6 * (1 - seen.value) }] }));

  return (
    <Animated.View style={[styles.hit, wrap]} pointerEvents={hidden ? 'none' : 'auto'}>
      <Pressable onPress={onPress} accessibilityLabel={open ? 'Back' : unread ? 'Mail, new' : 'Mail'} style={styles.hit}>
        <Animated.View style={[styles.box, box]}>
          {/* ring, body, post */}
          <Svg {...svgProps}>
            <Circle cx={12} cy={12} r={11} />
            <G transform={INNER} strokeWidth={2.7}>
              <Path d="M2.5 17.5V12.5A5.5 5.5 0 0 1 8 7h5a5.5 5.5 0 0 1 5.5 5.5v5Z" />
              <Path d="M12.7 17.5v4" />
            </G>
          </Svg>
          {/* door, hinged at its bottom; hangs open while unread */}
          <Animated.View style={[styles.layer, { transformOrigin: `${DOOR_X}px ${DOOR_Y}px` }, door]}>
            <Svg {...svgProps}>
              <G transform={INNER}>
                <Path d="M5.5 17.5V13a2.5 2.5 0 0 1 5 0v4.5" strokeWidth={2.4} />
              </G>
            </Svg>
          </Animated.View>
          {/* flag: stem and paddle, folds down the right side once seen */}
          <Animated.View style={[styles.layer, { transformOrigin: `${FLAG_X}px ${FLAG_Y}px` }, flag]}>
            <Svg {...svgProps}>
              <G transform={INNER} strokeWidth={2.7}>
                <Path d="M16.2 7.4V5.2" />
                <Rect x={15.2} y={2.4} width={3.6} height={2.8} rx={0.6} strokeWidth={2.2} fill={unread ? GOLD : 'none'} stroke={unread ? GOLD : INK} />
              </G>
            </Svg>
          </Animated.View>
          <Animated.View style={[styles.dot, { borderColor: colors.bg }, dot]}>
            <LinearGradient colors={['#f6e7b0', GOLD]} style={styles.dotFill} />
          </Animated.View>
        </Animated.View>
        <Animated.View style={[styles.arrow, arrow]} pointerEvents="none">
          <LinearGradient colors={['#1b1336', '#0f0a24']} style={styles.disc}>
            <Icon name="back" size={16} color={GOLD} />
          </LinearGradient>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hit: { width: 42, height: 36, alignItems: 'center', justifyContent: 'center' },
  box: { width: 32, height: 32 },
  layer: { position: 'absolute', top: 0, left: 0, width: 32, height: 32 },
  dot: { position: 'absolute', top: -1, right: -1, width: 13, height: 13, borderRadius: 7, borderWidth: 2, overflow: 'hidden', boxShadow: '0px 0px 10px rgba(201,168,76,0.5)' },
  dotFill: { flex: 1 },
  arrow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  disc: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0px 0px 0px 1px rgba(201,168,76,0.28), inset 0px 1px 0px rgba(255,230,160,0.12), 0px 3px 8px rgba(0,0,0,0.6)' },
});
export default Mailbox;
