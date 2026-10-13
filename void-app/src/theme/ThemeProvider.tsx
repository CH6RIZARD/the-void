// Port of the web theme switch (void2-final.html: currentTheme / setTheme /
// resolveTheme / toggleMatchSystem / syncThemeUI).
//   - saved theme: AsyncStorage `void_theme` ('dark' | 'light' = VOID CREAM | 'cream'; a saved 'void' still renders)
//   - FIRST LAUNCH (nothing stored) follows the device: light -> VOID CREAM, dark -> DARK, and it
//     stays live, onboarding included, until the person picks a theme in Settings.
//   - `void_theme_match_system` === 'true' keeps following the device the same way.
//   - picking any theme in Settings is a manual choice: it switches Match system off.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, type ColorSchemeName } from 'react-native';
import { getString, KEYS, setString } from '../lib/storage';
import { FONTS, LAYOUT, PALETTES, RADII, em, type Palette, type ThemeName } from './palettes';
import { resolveTheme } from './resolve';

export interface Theme {
  /** Theme actually rendered (after Match system). */
  name: ThemeName;
  /** Theme the user picked in Settings. */
  saved: ThemeName;
  matchSystem: boolean;
  /** Sub-label for the Match system row, verbatim from the web. */
  matchSystemSub: string;
  colors: Palette;
  fonts: typeof FONTS;
  radii: typeof RADII;
  layout: typeof LAYOUT;
  em: typeof em;
  isLight: boolean;
  /** Storage has been read (hold the splash until true). */
  ready: boolean;
  setTheme: (t: ThemeName) => void;
  toggleMatchSystem: () => void;
}

function build(saved: ThemeName, match: boolean, scheme: ColorSchemeName, ready: boolean, setTheme: Theme['setTheme'], toggleMatchSystem: Theme['toggleMatchSystem']): Theme {
  const name = resolveTheme(saved, match, scheme);
  return {
    name,
    saved,
    matchSystem: match,
    matchSystemSub: 'Follow your device between dark and light',
    colors: PALETTES[name],
    fonts: FONTS,
    radii: RADII,
    layout: LAYOUT,
    em,
    isLight: name === 'light' || name === 'cream',
    ready,
    setTheme,
    toggleMatchSystem,
  };
}

const noop = () => {};
// Default value lets components render (VOID) outside the provider, e.g. in tests.
const ThemeContext = createContext<Theme>(build('void', false, 'dark', false, noop, noop));

const isThemeName = (v: unknown): v is ThemeName => v === 'void' || v === 'dark' || v === 'light' || v === 'cream';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [saved, setSaved] = useState<ThemeName>('void');
  const [match, setMatch] = useState(false);
  const [ready, setReady] = useState(false);
  const [scheme, setScheme] = useState<ColorSchemeName>(() => Appearance.getColorScheme() ?? 'unspecified');

  useEffect(() => {
    let alive = true;
    Promise.all([getString(KEYS.theme), getString(KEYS.themeMatchSystem)]).then(([t, m]) => {
      if (!alive) return;
      if (isThemeName(t)) setSaved(t);
      // Never chosen: follow the device from the first screen.
      setMatch(m === null ? true : m === 'true');
      setReady(true);
    });
    const sub = Appearance.addChangeListener(({ colorScheme }) => setScheme(colorScheme));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const setTheme = useCallback((t: ThemeName) => {
    setSaved(t);
    setString(KEYS.theme, t);
    // A theme picked by hand wins over the device until Match system is turned back on.
    setMatch(false);
    setString(KEYS.themeMatchSystem, 'false');
  }, []);

  const toggleMatchSystem = useCallback(() => {
    setMatch((on) => {
      setString(KEYS.themeMatchSystem, String(!on));
      return !on;
    });
  }, []);

  const value = useMemo(() => build(saved, match, scheme, ready, setTheme, toggleMatchSystem), [saved, match, scheme, ready, setTheme, toggleMatchSystem]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** Shorthand for the active palette. */
export function useColors(): Palette {
  return useContext(ThemeContext).colors;
}
