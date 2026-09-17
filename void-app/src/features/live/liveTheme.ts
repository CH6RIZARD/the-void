// Theme bridge. Agent A owns src/theme/tokens.ts (ThemeProvider + useTheme); its
// exact shape is not final, so read defensively and fall back to the web's VOID
// palette (:root in void2-final.html). Globe/stream surfaces stay dark in every
// theme (patch3 §9) — only chrome (borders, labels, hint text) follows the theme.
import { useTheme } from '../../theme/tokens';

export const VOID_PALETTE = {
  bg: '#04020c',
  card: '#0d0820',
  border: '#1a1232',
  glow: '#5b21d4',
  gold: '#c9a84c',
  white: '#f4f0ff',
  dim: '#6a58a0',
  muted: '#231d42',
  red: '#ef4444',
  navDim: '#5c4d8a',
};

export type LivePalette = typeof VOID_PALETTE & { mono: string; sans: string };

export const FONT_MONO_FALLBACK = 'SyneMono_400Regular';
export const FONT_SANS_FALLBACK = 'Syne_400Regular';

export function useLiveTheme(): LivePalette {
  let t: any = null;
  try {
    t = (useTheme as any)();
  } catch {
    t = null;
  }
  const c = (t && (t.colors || t.c || t)) || {};
  const f = (t && (t.fonts || t.font)) || {};
  const pick = (k: string, alt: string | undefined, d: string) => (typeof c[k] === 'string' ? c[k] : alt && typeof c[alt] === 'string' ? c[alt] : d);
  return {
    bg: pick('bg', undefined, VOID_PALETTE.bg),
    card: pick('card', undefined, VOID_PALETTE.card),
    border: pick('border', undefined, VOID_PALETTE.border),
    glow: pick('glow', undefined, VOID_PALETTE.glow),
    gold: pick('gold', undefined, VOID_PALETTE.gold),
    white: pick('white', 'text', VOID_PALETTE.white),
    dim: pick('dim', undefined, VOID_PALETTE.dim),
    muted: pick('muted', undefined, VOID_PALETTE.muted),
    red: pick('red', undefined, VOID_PALETTE.red),
    navDim: pick('navDim', 'nav-dim', VOID_PALETTE.navDim),
    mono: typeof f.mono === 'string' ? f.mono : FONT_MONO_FALLBACK,
    sans: typeof f.sans === 'string' ? f.sans : typeof f.body === 'string' ? f.body : FONT_SANS_FALLBACK,
  };
}

/** CSS letter-spacing in em → RN px. */
export const em = (fontSize: number, e: number) => fontSize * e;
