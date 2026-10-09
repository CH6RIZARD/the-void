// tcDealIn as a wrapper: opacity 0 / 24px down -> rest, .46s cubic-bezier(.34,1.32,.64,1)
// after `delay` ms. Mail rows (60 + 45i), poll tiles (120 + 50i) and topic replies
// (120 + 60i) all deal with it. The thread's CommentCard keeps its own copy because
// it also deals OUT on close.
import React, { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

const DEAL_IN = Easing.bezier(0.34, 1.32, 0.64, 1);

export function DealIn({ delay = 0, children, style, rise = 24, pop }: { delay?: number; children: React.ReactNode; style?: StyleProp<ViewStyle>; rise?: number; /** tPopIn: 12px, .4s ease-out */ pop?: boolean }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(delay, withTiming(1, { duration: pop ? 400 : 460, easing: pop ? Easing.out(Easing.quad) : DEAL_IN, reduceMotion: ReduceMotion.System }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const a = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, v.value)), transform: [{ translateY: (1 - v.value) * (pop ? 12 : rise) }] }));
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}
