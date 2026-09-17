// Typography primitives mirroring the web's three families:
//   Syne (body / UI), Syne Mono (7-9px letter-spaced labels), DM Serif Display (monuments).
// Letter spacing is given in em like the CSS and converted to px.
import React from 'react';
import { Text as RNText, type TextProps, type TextStyle, type StyleProp } from 'react-native';
import { FONTS, em, type Palette } from '../theme/palettes';
import { useColors } from '../theme/ThemeProvider';

export type TextVariant =
  | 'body' //      Syne 14 --white
  | 'mono' //      Syne Mono 8 .2em --nav-dim        (generic label)
  | 'eyebrow' //   Syne Mono 8 .28em --nav-dim       (.composer-eyebrow / .ro-label)
  | 'micro' //     Syne Mono 7 .22em --nav-dim       (.si-lbl, .img-load-lbl sizes)
  | 'handle' //    Syne Mono 9 .06em --muted         (.post-handle)
  | 'name' //      Syne 700 12 --white               (.post-name)
  | 'serif' //     DM Serif Display 21/1.38 --white  (.si-monument, regular)
  | 'monument' //  DM Serif Display italic 21/1.38   (.si-monument)
  | 'logo'; //     Syne 800 26 .18em                 (.loader-logo)

type Weight = 400 | 600 | 700 | 800;

const VARIANTS: Record<TextVariant, { family: string; size: number; tracking: number; color: keyof Palette; lineHeight?: number }> = {
  body: { family: FONTS.sans, size: 14, tracking: 0, color: 'white' },
  mono: { family: FONTS.mono, size: 8, tracking: 0.2, color: 'navDim' },
  eyebrow: { family: FONTS.mono, size: 8, tracking: 0.28, color: 'navDim' },
  micro: { family: FONTS.mono, size: 7, tracking: 0.22, color: 'navDim' },
  handle: { family: FONTS.mono, size: 9, tracking: 0.06, color: 'muted' },
  name: { family: FONTS.sansBold, size: 12, tracking: 0, color: 'white' },
  serif: { family: FONTS.serif, size: 21, tracking: 0, color: 'white', lineHeight: 1.38 },
  monument: { family: FONTS.serifItalic, size: 21, tracking: 0, color: 'white', lineHeight: 1.38 },
  logo: { family: FONTS.sansExtraBold, size: 26, tracking: 0.18, color: 'white' },
};

const SYNE_BY_WEIGHT: Record<Weight, string> = { 400: FONTS.sans, 600: FONTS.sansSemiBold, 700: FONTS.sansBold, 800: FONTS.sansExtraBold };

export interface VTextProps extends TextProps {
  variant?: TextVariant;
  /** px */
  size?: number;
  /** letter-spacing in em (CSS units) */
  tracking?: number;
  /** palette key ('gold', 'dim', ...) or any colour string */
  color?: keyof Palette | (string & {});
  /** Syne weights only (400/600/700/800). Ignored for mono / serif. */
  weight?: Weight;
  italic?: boolean;
  /** line-height as a multiple of size (CSS unitless) */
  lineHeight?: number;
  uppercase?: boolean;
  align?: TextStyle['textAlign'];
  style?: StyleProp<TextStyle>;
}

export function VText({ variant = 'body', size, tracking, color, weight, italic, lineHeight, uppercase, align, style, ...rest }: VTextProps) {
  const colors = useColors();
  const v = VARIANTS[variant];
  const fontSize = size ?? v.size;
  let family = v.family;
  const isSyne = family.startsWith('Syne') && family !== FONTS.mono;
  if (weight && isSyne) family = SYNE_BY_WEIGHT[weight];
  if (italic && family === FONTS.serif) family = FONTS.serifItalic;
  const colorValue = color ? ((colors as any)[color] as string | undefined) ?? (color as string) : (colors[v.color] as string);
  const lh = lineHeight ?? v.lineHeight;
  return (
    <RNText
      allowFontScaling={false}
      {...rest}
      style={[
        {
          fontFamily: family,
          fontSize,
          letterSpacing: em(fontSize, tracking ?? v.tracking),
          color: colorValue,
          ...(lh ? { lineHeight: fontSize * lh } : null),
          ...(uppercase ? { textTransform: 'uppercase' as const } : null),
          ...(align ? { textAlign: align } : null),
        },
        style,
      ]}
    />
  );
}

export default VText;
