// The globe colours per theme, shared by the globe tab (globeWorklet) and the onboarding globe.
// Kept apart from globeWorklet so onboarding does not pull in the earth maps.
// VOID (dark + light) draws the night globe as it always was. CREAM / CREAM DARK draw the same night
// globe - its map, lights, shading and rim - regraded through the cream ramp below.
export const rgb01 = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** The cream ramp, finalised in the Cream Globe artifact. gain: night light -> ramp; lift: land over ocean. */
export const CREAM_GLOBE = {
  space: '#0f0d0b', ocean: '#1a1612', land: '#6b5a45', high: '#efe6d3', glow: '#f3d79a',
  atmo: '#e3d4b6', atmoA: 0.08, gain: 1.6, lift: 0.08,
};

const isCream = (name: string) => name === 'cream' || name === 'creamDark';

const LIGHT_PAGE = new Set(['light', 'cream']);

/** Globe tab: [] = the night globe on night space; [page rgb] (3) = the night globe on a light page, no
 *  stars (LIGHT); else [space, ocean, land, high, glow, atmo rgb, atmo a, gain, lift] (21), the cream
 *  regrade, whose space is the page colour in CREAM and dark (with stars) in CREAM DARK. */
export function globePaint(name: string, page = '#e7e0cf'): number[] {
  if (!isCream(name)) return LIGHT_PAGE.has(name) ? rgb01(page) : [];
  const g = CREAM_GLOBE;
  return [...rgb01(LIGHT_PAGE.has(name) ? page : g.space), ...rgb01(g.ocean), ...rgb01(g.land), ...rgb01(g.high), ...rgb01(g.glow), ...rgb01(g.atmo), g.atmoA, g.gain, g.lift];
}

/** Onboarding's dotted globe: [] = night; else [space, body, land dots, lights, atmo rgb, atmo a] (16). */
export function onboardPaint(name: string): number[] {
  if (!isCream(name)) return [];
  const g = CREAM_GLOBE;
  return [...rgb01(g.space), ...rgb01(g.ocean), ...rgb01(g.high), ...rgb01(g.glow), ...rgb01(g.atmo), g.atmoA];
}

/** The colour behind the globe: the page in the light themes, space in the dark ones. */
export const globeSpace = (name: string, page: string) => (LIGHT_PAGE.has(name) ? page : isCream(name) ? CREAM_GLOBE.space : '#04020c');
