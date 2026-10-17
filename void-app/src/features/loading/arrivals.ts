// How a thing arrives on the loading screen. Shared by the band, the character and the word;
// the same maths as the Void Loading Lab, so a setting tuned there reads the same here.
export type ArrivalStyle = 'cut' | 'fade' | 'pop' | 'iris' | 'rise' | 'drop' | 'left' | 'right' | 'blur' | 'spin' | 'glitch' | 'wipe' | 'unfold' | 'punch';
export interface Arrival { style: ArrivalStyle; delay: number; dur: number; amt: number }
export interface ArrivalFrame { sx: number; sy: number; dx: number; dy: number; rot: number; alpha: number; blur: number; wipe: number; jit: number; u: number }

export const easeOutBack = (x: number) => { 'worklet'; return 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2); };
export const ease01 = (x: number) => { 'worklet'; return x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x); };

/** dx/dy are in element sizes, rot in degrees, alpha 0..1, wipe 1 = fully shown. */
export function arrive(c: Arrival, t: number, rnd: () => number = Math.random): ArrivalFrame {
  'worklet';
  const u = Math.min(1, Math.max(0, (t - c.delay) / Math.max(0.05, c.dur))), k = ease01(u), a = c.amt;
  const p: ArrivalFrame = { sx: 1, sy: 1, dx: 0, dy: 0, rot: 0, alpha: 1, blur: 0, wipe: 1, jit: 0, u };
  switch (c.style) {
    case 'cut': p.alpha = u > 0 ? 1 : 0; break;
    case 'fade': p.alpha = k; break;
    case 'pop': p.sx = p.sy = u <= 0 ? 0.001 : Math.max(0.001, 1 + (easeOutBack(u) - 1) * a); p.alpha = u > 0 ? 1 : 0; break;
    case 'iris': p.sx = p.sy = Math.max(0.001, k); break;
    case 'rise': p.dy = (1 - k) * a; p.alpha = ease01(u * 1.5); break;
    case 'drop': p.dy = -(1 - k) * a; p.alpha = ease01(u * 1.5); break;
    case 'left': p.dx = -(1 - k) * a; p.alpha = ease01(u * 1.5); break;
    case 'right': p.dx = (1 - k) * a; p.alpha = ease01(u * 1.5); break;
    case 'blur': p.blur = (1 - k) * 14 * a; p.sx = p.sy = 1 + (1 - k) * 0.6 * a; p.alpha = ease01(u * 1.4); break;
    case 'spin': p.rot = (1 - k) * 180 * a; p.sx = p.sy = Math.max(0.001, k); break;
    case 'glitch': p.jit = u > 0 && u < 1 ? (1 - u) * a : 0; p.alpha = u <= 0 ? 0 : rnd() < (1 - u) * 0.45 ? 0.25 : 1; break;
    case 'wipe': p.wipe = k; p.alpha = u > 0 ? 1 : 0; break;
    case 'unfold': p.sx = Math.max(0.01, ease01(u * 2)); p.sy = Math.max(0.02, ease01(u * 2 - 1)); p.alpha = u > 0 ? 1 : 0; break;
    case 'punch': p.sx = p.sy = u <= 0 ? 0.001 : 0.25 + 0.75 * easeOutBack(u); p.alpha = ease01(u * 1.6); break;
  }
  return p;
}

/** The user's loading-screen settings (Void Loading Lab, 2026-10-17). Change them in the lab, then here. */
export const LOADING = {
  band: { style: 'fade', delay: 0, dur: 0.45, amt: 1 } as Arrival,
  char: { style: 'pop', delay: 0.1, dur: 0.55, amt: 1 } as Arrival,
  word: { style: 'fade', delay: 0.65, dur: 0.6, amt: 1 } as Arrival,
  // the character in the void: nudges in band heights, size, fall speed, the loop phase he arrives in, his angle
  lx: 0, ly: -0.09, lz: 0, ls: 1, speed: 0.23, phase: 0.37, pitch: 2, yaw: -9, roll: 4,
  // sparkles, the void band, the word
  sw: 0.5, sspread: 1.34, srise: 0.9, bm: 0.03, tr: 0.06, wsize: 1, wshow: true,
  motion: { mix: [0.4, 0, 0.25, 0, 0.7, 0.6, 0, 0, 0, 0, 0, 0], intensity: 1, variance: 0.25, arms: 1, legs: 1.15, sway: 1, cap: 1, bob: 1 },
  /** How long the screen stays up at minimum, so the arrivals finish even on a fast boot. */
  minMs: 2200,
};
// The four appearance settings (void-app/src/theme/palettes.ts), as the lab draws them.
export const LOADING_THEMES = {
  dark: { page: '#04020c', band: '#0b0620', word: '#c9a84c', spark: ['#c9a84c', '#8c73ff'], add: true, light: false },
  light: { page: '#e7e0cf', band: '#f6f1e6', word: '#5b21d4', spark: ['#5b21d4', '#9a7b2d'], add: false, light: true },
  cream: { page: '#efe6d3', band: '#e3d4b6', word: '#5a3a24', spark: ['#6b3f1c', '#2a1a10'], add: false, light: true },
  creamDark: { page: '#12100d', band: '#241f18', word: '#c9a84c', spark: ['#c9a84c', '#8a6448'], add: true, light: false },
} as const;
