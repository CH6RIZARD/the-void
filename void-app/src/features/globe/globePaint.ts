// The light-theme globe colours, shared by the globe tab (globeWorklet) and the onboarding globe.
// Kept apart from globeWorklet so onboarding does not pull in the earth maps.
export const rgb01 = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
/** The light globe for a light palette: background, ocean, land, city lights, atmosphere (+ alpha). */
export function globePaint(name: string, c: { bg: string; card: string; card2: string; purple: string; dim: string; gold: string; gdim: string }): number[] {
  if (name === 'cream') return [...rgb01(c.bg), ...rgb01(c.card2), ...rgb01(c.dim), ...rgb01(c.gdim), ...rgb01(c.gdim), 0.2];
  if (name === 'light') return [...rgb01(c.bg), ...rgb01(c.card), ...rgb01(c.purple), ...rgb01(c.gold), ...rgb01('#7c3aed'), 0.1];
  return [];
}
