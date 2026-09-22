// The moderation module's own glyphs (void2-final.html `IC`), which src/ui/icons does not
// carry: more, flag, block, mute, eyeOff, ext. Same 24-box, 1.5 stroke, round caps.
// Drawn as one native view each (see ui/icons/Glyph.tsx).
import React, { memo } from 'react';
import { Glyph } from '../../ui/icons/Glyph';
import type { IconShape } from '../../ui/icons';

export type VmodIconName = 'more' | 'flag' | 'block' | 'mute' | 'eyeOff' | 'ext';

const p = (d: string): IconShape => ({ t: 'path', d });
const dot = (cx: number): IconShape => ({ t: 'circle', cx, cy: 12, r: 1 });

export const VMOD_SHAPES: Record<VmodIconName, IconShape[]> = {
  more: [dot(5), dot(12), dot(19)],
  flag: [p('M5 21V4M5 4h11l-2 4 2 4H5')],
  block: [{ t: 'circle', cx: 12, cy: 12, r: 8.5 }, p('M6 6l12 12')],
  mute: [p('M4 9h4l5-4v14l-5-4H4z'), p('M17 9.5l4 5M21 9.5l-4 5')],
  eyeOff: [
    p('M3 3l18 18'),
    p('M10.6 5.6A10 10 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.1 3.8M6.3 7.3A17 17 0 0 0 2 12s3.6 6.5 10 6.5a9.6 9.6 0 0 0 4.2-.9'),
    p('M9.9 9.9a2.8 2.8 0 0 0 4 4'),
  ],
  ext: [p('M14 4h6v6M20 4l-9 9M18 14v6H4V6h6')],
};

export const VmodIcon = memo(function VmodIcon({ name, size = 17, color }: { name: VmodIconName; size?: number; color: string }) {
  return <Glyph shapes={VMOD_SHAPES[name]} size={size} color={color} />;
});
