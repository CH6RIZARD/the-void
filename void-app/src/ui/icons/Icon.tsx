// <Icon name="bolt" size={19} color="gold" /> — hairline icon (stroke 1.5), port of the web `.vi` SVGs.
import React, { memo } from 'react';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import type { StyleProp, ViewStyle } from 'react-native';
import { useColors } from '../../theme/ThemeProvider';
import type { Palette } from '../../theme/palettes';
import { ICONS, type IconName, type IconShape } from './paths';

export interface IconProps {
  name: IconName;
  /** px; the web renders .vi at 1.15em, the nav at 19px. Default 19. */
  size?: number;
  /** palette key or colour string. Default --white. */
  color?: keyof Palette | (string & {});
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}

function shape(s: IconShape, i: number) {
  switch (s.t) {
    case 'path':
      return <Path key={i} d={s.d} />;
    case 'circle':
      return <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} />;
    case 'ellipse':
      return <Ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} />;
    case 'rect':
      return <Rect key={i} x={s.x} y={s.y} width={s.width} height={s.height} rx={s.rx} />;
  }
}

export const Icon = memo(function Icon({ name, size = 19, color, strokeWidth = 1.5, style }: IconProps) {
  const colors = useColors();
  const c = color ? ((colors as any)[color] as string | undefined) ?? (color as string) : colors.white;
  const def = ICONS[name] as { filled?: boolean; shapes: IconShape[] };
  const filled = !!def.filled;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <G
      fill={filled ? c : 'none'}
      stroke={filled ? undefined : c}
      strokeWidth={filled ? undefined : strokeWidth}
      strokeLinecap={filled ? undefined : 'round'}
      strokeLinejoin={filled ? undefined : 'round'}
      >
        {def.shapes.map(shape)}
      </G>
    </Svg>
  );
});

export default Icon;
