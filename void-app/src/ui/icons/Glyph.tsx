// One hairline glyph drawn as ONE native view.
//
// Why (ANR 2026-09-21 23:29, test phone): the main thread sat in
//   com.horcrux.svg.PathView.<init>  ←  Fabric IntBufferBatchMountItem
// creating react-native-svg views. Every <Svg>, <G> and <Path>/<Circle> is its own
// native Android ViewGroup, so one icon is 3-6 views, and a feed card's action row,
// ⋯ button and veil icon come to dozens. Mounting a screenful of cards (or reels)
// created thousands of views in one commit and froze input for 5 s+.
//
// A glyph is static artwork, so it is rendered from the same SVG markup as a single
// expo-image view (Glide + AndroidSVG decode it off the main thread and cache it).
// Same viewBox, stroke, caps and colour: it looks identical. If the image ever fails
// to decode, the glyph falls back to the react-native-svg drawing, so an icon can
// never go missing.
import React, { memo, useMemo, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import type { IconShape } from './paths';

export interface GlyphProps {
  shapes: IconShape[];
  filled?: boolean;
  size: number;
  color: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}

/** 'rgba(r,g,b,a)' / '#rrggbbaa' → an opaque colour + opacity (AndroidSVG-safe paint). */
function paint(color: string): { c: string; o: number } {
  const m = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(color);
  if (m) return { c: `rgb(${m[1]},${m[2]},${m[3]})`, o: Number(m[4]) };
  const h = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(color);
  if (h) return { c: `#${h[1]}`, o: parseInt(h[2], 16) / 255 };
  return { c: color, o: 1 };
}

function shapeMarkup(s: IconShape): string {
  switch (s.t) {
    case 'path':
      return `<path d="${s.d}"/>`;
    case 'circle':
      return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}"/>`;
    case 'ellipse':
      return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}"/>`;
    case 'rect':
      return `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}"${s.rx != null ? ` rx="${s.rx}"` : ''}/>`;
  }
}

const uriCache = new Map<string, string>();

function glyphUri(shapes: IconShape[], filled: boolean, color: string, strokeWidth: number): string {
  const { c, o } = paint(color);
  const g = filled
    ? `<g fill="${c}" fill-opacity="${o}" stroke="none">`
    : `<g fill="none" stroke="${c}" stroke-opacity="${o}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${g}${shapes.map(shapeMarkup).join('')}</g></svg>`;
  let uri = uriCache.get(svg);
  if (!uri) {
    uri = `data:image/svg+xml;base64,${btoa(svg)}`;
    if (uriCache.size > 500) uriCache.clear();
    uriCache.set(svg, uri);
  }
  return uri;
}

function drawShape(s: IconShape, i: number) {
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

export const Glyph = memo(function Glyph({ shapes, filled = false, size, color, strokeWidth = 1.5, style }: GlyphProps) {
  const uri = useMemo(() => glyphUri(shapes, filled, color, strokeWidth), [shapes, filled, color, strokeWidth]);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
        <G
          fill={filled ? color : 'none'}
          stroke={filled ? undefined : color}
          strokeWidth={filled ? undefined : strokeWidth}
          strokeLinecap={filled ? undefined : 'round'}
          strokeLinejoin={filled ? undefined : 'round'}
        >
          {shapes.map(drawShape)}
        </G>
      </Svg>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={[{ width: size, height: size }, style as any]}
      contentFit="contain"
      cachePolicy="memory"
      transition={0}
      accessible={false}
      onError={() => setFailed(true)}
    />
  );
});
