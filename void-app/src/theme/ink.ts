// Accent inks that screens used to hard-code for the night look. VOID/DARK keep those exact hexes;
// LIGHT maps each to the LIGHT palette, so a screen swaps literals for these and stays readable in both.
import { useTheme } from './ThemeProvider';
import { rgbOf, type Palette, type ThemeName } from './palettes';

export interface Ink {
  gold: string; goldHi: string; muted: string; dim: string; hi: string; lilac: string;
  card: string; card2: string; cardTop: string; scrim: string;
  /** Faintest text (date stamps, footers). */ faint: string;
  /** Top-edge shade under a header. */ shade: [string, string];
  /** The violet button gradient, its "r,g,b" for tints, and the glass a tinted panel fades into. */
  violet: [string, string]; vrgb: string; glass: string;
}

const NIGHT: Ink = { gold: '#c9a84c', goldHi: '#e2c56a', muted: '#8d7cc0', dim: '#6a58a0', hi: '#f4f0ff', lilac: '#c9bfe8', card: '#0b0620', card2: '#1b1336', cardTop: '#120b2c', scrim: 'rgba(5,3,15,0)', faint: '#231d42', shade: ['rgba(13,8,32,0.6)', 'rgba(13,8,32,0)'], violet: ['#7c3aed', '#5b21d4'], vrgb: '124,58,237', glass: 'rgba(13,8,32,0.9)' };

export function inkFor(name: ThemeName, isLight: boolean, c: Palette): Ink {
  if (!isLight && name !== 'creamDark') return NIGHT;
  // VOID CREAM keeps the violet; CREAM has none, its accent is the brown.
  const cream = name === 'cream' || name === 'creamDark';
  return {
    violet: cream ? [c.purple, c.dim] : NIGHT.violet,
    vrgb: cream ? rgbOf(c.purple) : NIGHT.vrgb,
    glass: `rgba(${rgbOf(c.card)},0.9)`, gold: c.gold, goldHi: c.gold, muted: c.dim, dim: c.navDim, hi: c.white, lilac: c.white, card: c.card, card2: c.card2, cardTop: c.bg2, scrim: `rgba(${rgbOf(c.bg)},0)`, faint: c.muted, shade: [`rgba(${rgbOf(c.bg)},0.7)`, `rgba(${rgbOf(c.bg)},0)`] };
}

/** The night inks everywhere except the cream themes, which get their palette. Swapping a
 *  hard-coded '#8d7cc0' / '#6a58a0' / '#c9bfe8' for creamInk.muted / .dim / .lilac leaves
 *  VOID, DARK and LIGHT exactly as they were and takes the purple out of CREAM and CREAM DARK. */
export function useCreamInk(): Ink {
  const t = useTheme();
  return t.name === 'cream' || t.name === 'creamDark' ? inkFor(t.name, t.isLight, t.colors) : NIGHT;
}

export function useInk(): Ink {
  const t = useTheme();
  return inkFor(t.name, t.isLight, t.colors);
}
