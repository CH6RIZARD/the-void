// Bottom sheet, port of #composer-overlay / .composer-sheet:
//   overlay  rgba(0,0,0,.55), content aligned to the bottom
//   sheet    width:100%; max-height:88dvh; border-radius:24px 24px 0 0; background:var(--sheet);
//            box-shadow:0 -12px 48px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.06); padding:0 22px 24px
//   handle   32x3, rgba(255,255,255,.15) (LIGHT: --hairline), radius 2, margin 12px auto 0
//   open     @keyframes cSlideUp{from{translateY(60px);opacity:0}}  .22s ease
//   close    @keyframes cSlideDown{to{translateY(100%);opacity:0}}
// Drag the handle area down (or tap the scrim / hardware back) to dismiss.
import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { ReduceMotion, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { SPRING_SNAP, WEB } from '../theme/motion';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

const EASE = WEB.EASE; // CSS `ease`

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Wrap children in a ScrollView (default true; the web sheet scrolls past 88dvh). */
  scroll?: boolean;
  /** Fraction of the window height (default .88). */
  maxHeight?: number;
  /** Tap on the scrim closes (default true). */
  dismissOnScrim?: boolean;
  /** Top corner radius (default 24; the reply sheet uses 26). */
  radius?: number;
  contentStyle?: StyleProp<ViewStyle>;
  /** Drag-to-dismiss on the handle (default true). */
  draggable?: boolean;
}

export function Sheet({ visible, onClose, children, scroll = true, maxHeight = 0.88, dismissOnScrim = true, radius = 24, contentStyle, draggable = true }: SheetProps) {
  const { colors, isLight } = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0); // 0 closed, 1 open
  const closing = useSharedValue(0); // 0 = opening curve (60px), 1 = closing curve (100%)
  const drag = useSharedValue(0);
  const sheetH = useSharedValue(height);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      drag.value = 0;
      // Reopened mid-close: carry on from where it is, on the close's own path,
      // instead of jumping back to the start of the open.
      if (progress.value === 0) closing.value = 0;
      progress.value = withTiming(1, { duration: 220, easing: EASE, reduceMotion: ReduceMotion.Never }, (done) => {
        if (done) closing.value = 0;
      });
    } else if (mounted) {
      closing.value = 1;
      progress.value = withTiming(0, { duration: 220, easing: EASE, reduceMotion: ReduceMotion.Never }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const requestClose = useCallback(() => onClose(), [onClose]);

  const pan = Gesture.Pan()
    .enabled(draggable)
    .activeOffsetY(6)
    .hitSlop({ top: 12, bottom: 14, left: 60, right: 60 })
    .onUpdate((e) => {
      drag.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (drag.value > 90 || e.velocityY > 900) {
        runOnJS(requestClose)();
      } else {
        drag.value = withSpring(0, { ...SPRING_SNAP, velocity: e.velocityY });
      }
    });

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  // Reduced motion: the sheet fades in place (the timings stay on Never so the fade
  // still runs); the drag still follows the finger.
  const still = useReducedMotion();
  const sheetStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const offset = still ? 0 : closing.value ? (1 - p) * sheetH.value : (1 - p) * 60;
    return { opacity: p, transform: [{ translateY: offset + drag.value }] };
  });

  if (!mounted) return null;

  const handleColor = isLight ? colors.hairline : 'rgba(255,255,255,0.15)';
  const Body: React.ComponentType<any> = scroll ? ScrollView : View;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={requestClose}>
      <GestureHandlerRootView style={styles.fill}>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
            <Pressable style={styles.fill} onPress={dismissOnScrim ? requestClose : undefined} accessibilityLabel="Close" />
          </Animated.View>
          <View style={styles.align} pointerEvents="box-none">
            <Animated.View
              onLayout={(e) => {
                sheetH.value = e.nativeEvent.layout.height;
              }}
              style={[
                styles.sheet,
                {
                  maxHeight: height * maxHeight,
                  backgroundColor: colors.sheet,
                  borderTopLeftRadius: radius,
                  borderTopRightRadius: radius,
                  paddingBottom: 24 + insets.bottom,
                },
                sheetStyle,
              ]}
            >
              <GestureDetector gesture={pan}>
                <View style={styles.handleHit}>
                  <View style={[styles.handle, { backgroundColor: handleColor }]} />
                </View>
              </GestureDetector>
              <Body
                {...(scroll ? { keyboardShouldPersistTaps: 'handled' as const, bounces: false, contentContainerStyle: contentStyle, style: styles.shrink } : { style: [styles.shrink, contentStyle] })}
              >
                {children}
              </Body>
            </Animated.View>
          </View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.55)' },
  align: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    paddingHorizontal: 22,
    boxShadow: '0px -12px 48px rgba(0,0,0,0.6), inset 0px 1px 0px rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  handleHit: { paddingTop: 12, alignItems: "center" },
  handle: { width: 32, height: 3, borderRadius: 2 },
  shrink: { flexShrink: 1 },
});

export default Sheet;
