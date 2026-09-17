// A UI-thread millisecond clock for the loaders.
// The web CSS animations are continuous time functions; driving them from a frame
// clock reproduces them exactly (including negative animation-delay) and, unlike
// withTiming/withRepeat, is never shortened or skipped by the OS reduce-motion
// setting. The user rule: loaders ALWAYS animate.
import { useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';

export function useLoaderClock(active = true): SharedValue<number> {
  const clock = useSharedValue(0);
  useFrameCallback((frame) => {
    'worklet';
    clock.value = frame.timeSinceFirstFrame;
  }, active);
  return clock;
}
