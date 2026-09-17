// IMAGE loader — exact port of IMG_LOADER + .img-load CSS (hard-locked by the user):
//
//   .img-load{position:absolute;inset:0;flex column centered;gap:10px;background:rgba(3,1,10,.97);border-radius:inherit;z-index:2}
//   .img-load-rings{width:62px;height:62px}
//   .img-load-out{62x62 centered; animation:orbit 3.4s linear infinite}      (rotate 0 -> 360deg)
//   .img-load-in {34x34 centered; animation:orbit-rev 2.2s linear infinite}  (rotate 0 -> -360deg)
//   .img-load-out i{3x3 #c9a84c}  (1) top:-1 left:50% ml:-1.5 glow 0 0 6px rgba(201,168,76,.9)
//                                 (2) bottom:6 left:4 opacity .55 2x2   (3) bottom:6 right:4 opacity .4 2x2
//   .img-load-in i{2x2 #a78bfa (VOID) / var(--dim) (DARK, LIGHT)}
//                                 (1) top:-1 left:50% ml:-1 opacity .7   (2) bottom:1 left:50% ml:-1 opacity .35
//   .img-load-lbl{Syne Mono 7px; letter-spacing .3em; color var(--nav-dim)}  "LOADING IMAGE"
//   Always animates, even with reduce motion on.
import React, { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, em } from '../theme/palettes';
import { VText } from './Text';
import { useLoaderClock } from './loaders/useLoaderClock';

const OUT_MS = 3400;
const IN_MS = 2200;

export interface ImageOrbitLoaderProps {
  /** Default 'LOADING IMAGE'. Pass null to hide. */
  label?: string | null;
  radius?: number;
  /** 'feed' surfaces use the milky panel + dim label in LIGHT theme. */
  surface?: 'media' | 'feed';
  absolute?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const ImageOrbitLoader = memo(function ImageOrbitLoader({ label = 'LOADING IMAGE', radius, surface = 'media', absolute = true, style }: ImageOrbitLoaderProps) {
  const theme = useTheme();
  const clock = useLoaderClock(true);
  const lightFeed = surface === 'feed' && theme.isLight;
  const bg = lightFeed ? '#f7f3ea' : 'rgba(3,1,10,0.97)';
  const inner = theme.name === 'void' ? '#a78bfa' : theme.colors.dim;
  const labelColor = lightFeed ? theme.colors.dim : theme.colors.navDim;

  const outStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${((clock.value % OUT_MS) / OUT_MS) * 360}deg` }] }));
  const inStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-((clock.value % IN_MS) / IN_MS) * 360}deg` }] }));

  return (
    <View pointerEvents="none" style={[absolute ? StyleSheet.absoluteFill : null, styles.box, { backgroundColor: bg }, radius != null ? { borderRadius: radius } : null, style]}>
      <View style={styles.rings}>
        <Animated.View style={[styles.out, outStyle]}>
          <View style={[styles.o1]} />
          <View style={[styles.o2]} />
          <View style={[styles.o3]} />
        </Animated.View>
        <Animated.View style={[styles.in, inStyle]}>
          <View style={[styles.i1, { backgroundColor: inner }]} />
          <View style={[styles.i2, { backgroundColor: inner }]} />
        </Animated.View>
      </View>
      {label ? <VText style={[styles.label, { color: labelColor }]}>{label}</VText> : null}
    </View>
  );
});

const GOLD = '#c9a84c';
const styles = StyleSheet.create({
  box: { zIndex: 2, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, overflow: 'hidden' },
  rings: { width: 62, height: 62 },
  out: { position: 'absolute', top: 0, left: 0, width: 62, height: 62, borderRadius: 31 },
  in: { position: 'absolute', top: 14, left: 14, width: 34, height: 34, borderRadius: 17 },
  o1: { position: 'absolute', top: -1, left: 31 - 1.5, width: 3, height: 3, borderRadius: 1.5, backgroundColor: GOLD, boxShadow: '0px 0px 6px rgba(201,168,76,0.9)' },
  o2: { position: 'absolute', bottom: 6, left: 4, width: 2, height: 2, borderRadius: 1, backgroundColor: GOLD, opacity: 0.55 },
  o3: { position: 'absolute', bottom: 6, right: 4, width: 2, height: 2, borderRadius: 1, backgroundColor: GOLD, opacity: 0.4 },
  i1: { position: 'absolute', top: -1, left: 17 - 1, width: 2, height: 2, borderRadius: 1, opacity: 0.7 },
  i2: { position: 'absolute', bottom: 1, left: 17 - 1, width: 2, height: 2, borderRadius: 1, opacity: 0.35 },
  label: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.3) },
});

export default ImageOrbitLoader;
