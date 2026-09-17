// Card + Backdrop primitives.
//   Card variant 'post'  = .post{background:var(--card);border-radius:20px;padding:18px;
//                              box-shadow:var(--elev),inset 0 1px 0 rgba(255,255,255,.06)}
//   Card variant 'tile'  = .nation-card{border-radius:12px;background:var(--card);
//                              box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}   LIGHT: var(--elev),inset .85
//   Card variant 'highlight' = .post.highlight gradient (VOID purple glass)
//   Backdrop = html,body{background:var(--bg);background-image:var(--bg-radial)}
import React from 'react';
import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';
import type { RadialSpec } from '../theme/palettes';

export type CardVariant = 'post' | 'tile' | 'highlight';

export interface CardProps extends ViewProps {
  variant?: CardVariant;
  /** Remove the default padding (18 post / 10x11 tile). */
  flush?: boolean;
  onPress?: PressableProps['onPress'];
  onLongPress?: PressableProps['onLongPress'];
  style?: StyleProp<ViewStyle>;
}

export function Card({ variant = 'post', flush, onPress, onLongPress, style, children, ...rest }: CardProps) {
  const { colors, isLight } = useTheme();
  let base: ViewStyle;
  if (variant === 'tile') {
    base = {
      borderRadius: 12,
      backgroundColor: colors.card,
      boxShadow: isLight ? `${colors.elev}, inset 0px 1px 0px rgba(255,255,255,0.85)` : 'inset 0px 1px 0px rgba(255,255,255,0.05)',
      ...(flush ? null : { paddingVertical: 10, paddingHorizontal: 11 }),
    };
  } else {
    base = {
      borderRadius: 20,
      backgroundColor: colors.card,
      boxShadow: `${colors.elev}, inset 0px 1px 0px rgba(255,255,255,0.06)`,
      ...(flush ? null : { padding: 18 }),
    };
  }
  const inner =
    variant === 'highlight' ? (
      <LinearGradient
        // linear-gradient(160deg, rgba(124,58,237,.14), rgba(13,8,32,.9) 60%)
        colors={['rgba(124,58,237,0.14)', 'rgba(13,8,32,0.9)']}
        locations={[0, 0.6]}
        start={{ x: 0.33, y: 0 }}
        end={{ x: 0.67, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: 20 }]}
      />
    ) : null;
  const finalStyle = [base, variant === 'highlight' ? { backgroundColor: 'transparent' } : null, style];
  if (onPress || onLongPress) {
    return (
      <Pressable onPress={onPress} onLongPress={onLongPress} style={finalStyle} {...(rest as any)}>
        {inner}
        {children}
      </Pressable>
    );
  }
  return (
    <View style={finalStyle} {...rest}>
      {inner}
      {children}
    </View>
  );
}

let gradSeq = 0;

/** Paints a CSS radial-gradient spec behind its parent (absolute fill). */
export function RadialFill({ spec, style }: { spec: RadialSpec; style?: StyleProp<ViewStyle> }) {
  const id = React.useMemo(() => `vr${++gradSeq}`, []);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          {/* Ellipse of rx% x ry% (CSS "W% H%" are the ellipse radii), centred at cx%, cy%. */}
          <RadialGradient id={id} cx={spec.cx} cy={spec.cy} rx={spec.rx} ry={spec.ry} fx={spec.cx} fy={spec.cy} gradientUnits="userSpaceOnUse">
            {spec.stops.map((s, i) => (
              <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={1} />
            ))}
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** Screen background: var(--bg) + var(--bg-radial). Use as the root of every screen. */
export function Backdrop({ style, children, media, ...rest }: ViewProps & { media?: boolean }) {
  const { colors } = useTheme();
  if (media) {
    // globe / reels / photo viewer stay dark in every theme
    return (
      <View style={[{ flex: 1, backgroundColor: '#05020e' }, style]} {...rest}>
        {children}
      </View>
    );
  }
  return (
    <View style={[{ flex: 1, backgroundColor: colors.bg }, style]} {...rest}>
      {colors.bgRadial ? <RadialFill spec={colors.bgRadial} /> : null}
      {children}
    </View>
  );
}
