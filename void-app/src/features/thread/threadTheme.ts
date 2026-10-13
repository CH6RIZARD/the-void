// THREAD v3 card tokens (#thread-overlay,#reply-overlay --tc-*), derived per theme the
// way the web's color-mix() did: --tc-card = card @95%, --tc-opbg = card @96%,
// --tc-reply = card2 @95%, --tc-edge1 = card @68%, --tc-edge2 = card @45%, --tc-sheet = sheet @97%.
import { useMemo } from 'react';
import { useTheme } from '../../theme/ThemeProvider';

function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export interface ThreadTokens {
  card: string;
  opbg: string;
  reply: string;
  edge1: string;
  edge2: string;
  /** peek tab under a card with children (22b peek-fan): card @62% */
  peek: string;
  /** peek line text (#8d7cc0) */
  peekText: string;
  sheet: string;
  text: string;
  hi: string;
  shadow: string;
  handle: string;
  /** OP CTA ring (LIGHT deepens it) */
  opRing: string;
  opShadow: string;
}

export function useThreadTokens(): ThreadTokens {
  const { colors, isLight } = useTheme();
  return useMemo(
    () => ({
      card: withAlpha(colors.card, 0.95),
      opbg: withAlpha(colors.card, 0.96),
      reply: withAlpha(colors.card2, 0.95),
      edge1: withAlpha(colors.card, 0.68),
      edge2: withAlpha(colors.card, 0.45),
      peek: withAlpha(colors.card, 0.62),
      peekText: isLight ? colors.dim : '#8d7cc0',
      sheet: withAlpha(colors.sheet, 0.97),
      text: isLight ? '#4a4234' : '#c9bfe8',
      hi: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.06)',
      shadow: isLight ? 'rgba(26,20,36,0.16)' : 'rgba(0,0,0,0.5)',
      handle: isLight ? colors.hairline : 'rgba(255,255,255,0.14)',
      opRing: isLight ? 'rgba(154,123,45,0.35)' : 'rgba(201,168,76,0.25)',
      opShadow: isLight ? 'rgba(26,20,36,0.16)' : 'rgba(0,0,0,0.6)',
    }),
    [colors, isLight],
  );
}
