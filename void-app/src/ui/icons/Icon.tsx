// <Icon name="bolt" size={19} color="gold" /> — hairline icon (stroke 1.5), port of the web `.vi` SVGs.
// Drawn as one native view (see Glyph.tsx), not an Svg tree.
import React, { memo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useColors } from '../../theme/ThemeProvider';
import type { Palette } from '../../theme/palettes';
import { ICONS, type IconName, type IconShape } from './paths';
import { Glyph } from './Glyph';

export interface IconProps {
  name: IconName;
  /** px; the web renders .vi at 1.15em, the nav at 19px. Default 19. */
  size?: number;
  /** palette key or colour string. Default --white. */
  color?: keyof Palette | (string & {});
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}

export const Icon = memo(function Icon({ name, size = 19, color, strokeWidth = 1.5, style }: IconProps) {
  const colors = useColors();
  const c = color ? ((colors as any)[color] as string | undefined) ?? (color as string) : colors.white;
  const def = ICONS[name] as { filled?: boolean; shapes: IconShape[] };
  return <Glyph shapes={def.shapes} filled={!!def.filled} size={size} color={c} strokeWidth={strokeWidth} style={style} />;
});

export default Icon;
