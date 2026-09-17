// Geometry of the floating bottom nav, so screens can keep content clear of it.
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LAYOUT } from '../theme/palettes';

/** Nav pill height (padding 13 + icon 19 + gap 7 + bar 1 + padding 10). */
export const NAV_PILL_HEIGHT = LAYOUT.navPillHeight;
/** .bnav margin: 12px 16px 16px */
export const NAV_MARGIN = { top: 12, side: 16, bottom: 16 } as const;

/** Bottom offset of the pill from the screen edge (margin + home indicator). */
export function useBottomNavOffset(): number {
  const insets = useSafeAreaInsets();
  return NAV_MARGIN.bottom + insets.bottom;
}

/** Total space the nav occupies at the bottom of a tab screen (pad scroll content by this). */
export function useBottomNavSpace(): number {
  return useBottomNavOffset() + NAV_PILL_HEIGHT + NAV_MARGIN.top;
}
