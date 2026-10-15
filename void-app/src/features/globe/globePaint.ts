// The globe colours per theme, shared by the globe tab (globeWorklet) and the onboarding globe.
// Kept apart from globeWorklet so onboarding does not pull in the earth maps.
// VOID (dark + light) draws the night globe as it always was. CREAM / CREAM DARK draw the same night
// globe - its map, lights, shading and rim - regraded through the cream ramp below.
export const rgb01 = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** The cream globe, finalised by the user in the Cream Globe artifact (2026-10-15). */
export const CREAM_GLOBE = {
  space: '#17130f', deep: '#110f0e', shallow: '#3a3026', sheenCol: '#f4ead6', landLo: '#2e261d', land: '#5c4933',
  high: '#f4ead6', glow: '#fff1c7', coast: '#c9b48e', atmo: '#efe6d3',
  atmoA: 0.09, gain: 1, lift: 0, contrast: 0.7, limb: 1, oceanLift: 1.15, sheen: 0.1, coastA: 0.08, thr: 0.02,
  cityMix: 1, cityGlow: 0.7, nightSide: 0.24, rimIn: 0.35, shelf: 0.95, rimSoft: 2, stars: 0.85,
};
/** Order of the numbers after the ten colours in a cream paint (globeWorklet reads them by index). */
export const CREAM_NUMS = ['atmoA', 'gain', 'lift', 'contrast', 'limb', 'oceanLift', 'sheen', 'coastA', 'thr', 'cityMix', 'cityGlow', 'nightSide', 'rimIn', 'shelf', 'rimSoft', 'stars'] as const;
const CREAM_COLS = ['deep', 'shallow', 'sheenCol', 'landLo', 'land', 'high', 'glow', 'coast', 'atmo'] as const;

const isCream = (name: string) => name === 'cream' || name === 'creamDark';

const LIGHT_PAGE = new Set(['light', 'cream']);

/** Globe tab: [] = the night globe on night space; [page rgb] (3) = the night globe on a light page, no
 *  stars (LIGHT); else the cream regrade (46): [space, then CREAM_COLS rgb, then CREAM_NUMS], whose space
 *  is the page colour in CREAM and dark (with stars) in CREAM DARK. */
export function globePaint(name: string, page = '#e7e0cf'): number[] {
  if (!isCream(name)) return LIGHT_PAGE.has(name) ? rgb01(page) : [];
  const g = CREAM_GLOBE;
  return [...rgb01(LIGHT_PAGE.has(name) ? page : g.space), ...CREAM_COLS.flatMap((k) => rgb01(g[k])), ...CREAM_NUMS.map((k) => g[k])];
}

/** Onboarding's dotted globe: [] = night; else [space, body, land dots, lights, atmo rgb, atmo a] (16). */
export function onboardPaint(name: string): number[] {
  if (!isCream(name)) return [];
  const g = CREAM_GLOBE;
  return [...rgb01(g.space), ...rgb01(g.deep), ...rgb01(g.high), ...rgb01(g.glow), ...rgb01(g.atmo), g.atmoA];
}

/** The colour behind the globe: the page in the light themes, space in the dark ones. */
export const globeSpace = (name: string, page: string) => (LIGHT_PAGE.has(name) ? page : isCream(name) ? CREAM_GLOBE.space : '#04020c');
