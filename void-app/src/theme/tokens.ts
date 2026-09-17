// Public entry for the design tokens + theme hooks.
//   import { useTheme, useColors, VOID, DARK, LIGHT, FONTS, RADII, em } from '../theme/tokens';
// useTheme() -> { name, saved, matchSystem, colors, fonts, radii, layout, em, isLight, ready, setTheme, toggleMatchSystem }
export * from './palettes';
export { ThemeProvider, useTheme, useColors, type Theme } from './ThemeProvider';

/** Join CSS box-shadow layers (RN 0.86 `boxShadow` accepts the CSS string form). */
export const shadows = (...layers: (string | false | null | undefined)[]) => layers.filter(Boolean).join(', ');
