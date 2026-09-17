// The moderation layer's own hairline glyphs (web `const IC={more,flag,block,mute,eyeOff,x}`),
// which are not part of src/ui/icons. Same 24-box, stroke 1.5, round caps as `.vi`.
import React, { memo } from 'react';
import Svg, { Circle, G, Path } from 'react-native-svg';

export type ModIconName = 'more' | 'flag' | 'block' | 'mute' | 'eyeOff';

const SHAPES: Record<ModIconName, React.ReactNode> = {
  more: (
    <>
      <Circle cx={5} cy={12} r={1} />
      <Circle cx={12} cy={12} r={1} />
      <Circle cx={19} cy={12} r={1} />
    </>
  ),
  flag: <Path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  block: (
    <>
      <Circle cx={12} cy={12} r={8.5} />
      <Path d="M6 6l12 12" />
    </>
  ),
  mute: (
    <>
      <Path d="M4 9h4l5-4v14l-5-4H4z" />
      <Path d="M17 9.5l4 5M21 9.5l-4 5" />
    </>
  ),
  eyeOff: (
    <>
      <Path d="M3 3l18 18" />
      <Path d="M10.6 5.6A10 10 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.1 3.8M6.3 7.3A17 17 0 0 0 2 12s3.6 6.5 10 6.5a9.6 9.6 0 0 0 4.2-.9" />
      <Path d="M9.9 9.9a2.8 2.8 0 0 0 4 4" />
    </>
  ),
};

export const ModIcon = memo(function ModIcon({ name, size = 17, color }: { name: ModIconName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        {SHAPES[name]}
      </G>
    </Svg>
  );
});
