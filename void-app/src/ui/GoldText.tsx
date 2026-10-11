// The mock's `.v22-gold` text: linear-gradient(180deg, #f6e7b0, #c9a84c 55%, #8a6d2c)
// clipped to the glyphs. RN has no background-clip:text, so the text is an SVG <Text>
// filled with the same gradient; react-native-svg resolves expo-font families.
// Width is a glyph estimate (serif digits ~.55em, caps sans ~.75em + tracking); pass
// `width` to pin it.
import React, { useId } from 'react';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';

export function GoldText({ text, size, family, letterSpacing = 0, em = 0.55, width, height }: { text: string; size: number; family: string; letterSpacing?: number; em?: number; width?: number; height?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const w = width ?? Math.ceil(text.length * (size * em + letterSpacing)) + 2;
  const h = height ?? Math.ceil(size * 1.1);
  return (
    <Svg width={w} height={h}>
      <Defs>
        <LinearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#f6e7b0" />
          <Stop offset="0.55" stopColor="#c9a84c" />
          <Stop offset="1" stopColor="#8a6d2c" />
        </LinearGradient>
      </Defs>
      <SvgText x={0} y={h / 2} fontFamily={family} fontSize={size} letterSpacing={letterSpacing} fill={`url(#g${id})`} alignmentBaseline="central">
        {text}
      </SvgText>
    </Svg>
  );
}
export default GoldText;
