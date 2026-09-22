// The moderation layer's own hairline glyphs (web `const IC={more,flag,block,mute,eyeOff}`).
// Identical to the feed's moderation glyphs, so this is that set under the reels' names.
import { VmodIcon, type VmodIconName } from '../feed/vmodIcons';
import type React from 'react';

export type ModIconName = Exclude<VmodIconName, 'ext'>;
export const ModIcon = VmodIcon as React.ComponentType<{ name: ModIconName; size?: number; color: string }>;
