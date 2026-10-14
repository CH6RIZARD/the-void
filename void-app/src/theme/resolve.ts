// Which theme renders. Match system follows the device: light -> LIGHT, dark -> DARK; with the
// Alternative appearances on, light -> CREAM, dark -> CREAM DARK. Without it, the theme picked in Settings.
import type { ThemeName } from './palettes';

/** The ALTERNATIVE appearances (Settings > Alternative). */
export const isCreamTheme = (t: ThemeName) => t === 'cream' || t === 'creamDark';

export function resolveTheme(saved: ThemeName, match: boolean, scheme: 'light' | 'dark' | 'unspecified' | null | undefined): ThemeName {
  if (!match) return saved;
  if (isCreamTheme(saved)) return scheme === 'light' ? 'cream' : 'creamDark';
  return scheme === 'light' ? 'light' : 'dark';
}
