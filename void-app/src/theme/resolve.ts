// Which theme renders. Match system follows the device: light -> VOID CREAM ('light'), dark -> DARK.
// Without it, the theme picked in Settings.
import type { ThemeName } from './palettes';

export function resolveTheme(saved: ThemeName, match: boolean, scheme: 'light' | 'dark' | 'unspecified' | null | undefined): ThemeName {
  if (!match) return saved;
  return scheme === 'light' ? 'light' : 'dark';
}
