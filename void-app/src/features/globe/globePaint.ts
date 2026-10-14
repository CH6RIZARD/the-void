// The globe colours per theme, shared by the globe tab (globeWorklet) and the onboarding globe.
// Kept apart from globeWorklet so onboarding does not pull in the earth maps.
// VOID (dark + light) draws the night globe as it always was. CREAM / CREAM DARK draw the same night
// globe - its map, lights, shading and rim - regraded through the cream ramp below.
export const rgb01 = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** The cream ramp, finalised in the Cream Globe artifact. gain: night light -> ramp; lift: land over ocean. */
export const CREAM_GLOBE = {
  space: '#0f0d0b', ocean: '#1a1612', land: '#6b5a45', high: '#efe6d3', glow: '#f3d79a',
  atmo: '#e3d4b6', atmoA: 0.16, gain: 2.2, lift: 0.08,
};

const isCream = (name: string) => name === 'cream' || name === 'creamDark';

/** Globe tab: [] = the night globe; else [space, ocean, land, high, glow, atmo rgb, atmo a, gain, lift] (21). */
export function globePaint(name: string): number[] {
  if (!isCream(name)) return [];
  const g = CREAM_GLOBE;
  return [...rgb01(g.space), ...rgb01(g.ocean), ...rgb01(g.land), ...rgb01(g.high), ...rgb01(g.glow), ...rgb01(g.atmo), g.atmoA, g.gain, g.lift];
}

/** Onboarding's dotted globe: [] = night; else [space, body, land dots, lights, atmo rgb, atmo a] (16). */
export function onboardPaint(name: string): number[] {
  if (!isCream(name)) return [];
  const g = CREAM_GLOBE;
  return [...rgb01(g.space), ...rgb01(g.ocean), ...rgb01(g.high), ...rgb01(g.glow), ...rgb01(g.atmo), g.atmoA];
}

/** The page colour behind the globe. */
export const globeSpace = (name: string) => (isCream(name) ? CREAM_GLOBE.space : '#04020c');
