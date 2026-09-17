// Every CSS custom property from void2-final.html, per theme.
//   VOID  = :root{...}
//   DARK  = :root[data-theme="dark"]{...}   (inherits --red/--green from :root)
//   LIGHT = :root[data-theme="light"]{...}  (inherits --green from :root)
// Names are camelCased CSS variable names (--nav-dim -> navDim). Shadows are kept
// as CSS box-shadow strings: React Native 0.86 (New Architecture) renders the
// `boxShadow` style prop natively, including `inset`, on both platforms.

export type ThemeName = 'void' | 'dark' | 'light';

/** A CSS radial-gradient(W% H% at X% Y%, c0 s0, c1 s1) as data (drawn by <Backdrop>). */
export interface RadialSpec {
  rx: number; // ellipse width, % of box width
  ry: number; // ellipse height, % of box height
  cx: number; // centre x, %
  cy: number; // centre y, %
  stops: { color: string; offset: number }[]; // offset 0..1
}

export interface Palette {
  bg: string;
  bg2: string;
  card: string;
  card2: string;
  border: string;
  glow: string;
  purple: string;
  pdim: string;
  gold: string;
  gdim: string;
  gglow: string;
  white: string;
  dim: string;
  muted: string;
  red: string;
  green: string;
  navDim: string;
  hairline: string;
  /** --bg-radial (null = `none`). */
  bgRadial: RadialSpec | null;
  navBg: string;
  /** --nav-shadow */
  navShadow: string;
  sheet: string;
  /** --elev */
  elev: string;
  /** Highlight used by `inset 0 1px 0 ...` on cards / nav in this theme. */
  insetHi: string;
  /** Inner-ring spark colour of the image orbit loader (.img-load-in i). */
  orbitInner: string;
  /** Loader panel on FEED surfaces (.post-media .img-load etc.). Media surfaces keep rgba(3,1,10,.97). */
  feedLoaderBg: string;
}

export const VOID: Palette = {
  bg: '#04020c',
  bg2: '#07041a',
  card: '#0d0820',
  card2: '#130b2e',
  border: '#1a1232',
  glow: '#5b21d4',
  purple: '#7c3aed',
  pdim: '#2a1060',
  gold: '#c9a84c',
  gdim: '#5c4420',
  gglow: 'rgba(201,168,76,0.12)',
  white: '#f4f0ff',
  dim: '#6a58a0',
  muted: '#231d42',
  red: '#ef4444',
  green: '#10b981',
  navDim: '#5c4d8a',
  hairline: 'rgba(255,255,255,0.07)',
  bgRadial: { rx: 120, ry: 60, cx: 50, cy: 0, stops: [{ color: '#0e0726', offset: 0 }, { color: '#04020c', offset: 0.55 }] },
  navBg: 'rgba(13,8,32,0.92)',
  navShadow: '0px -4px 24px rgba(0,0,0,0.4)',
  sheet: '#07041a',
  elev: '0px 10px 30px rgba(0,0,0,0.45)',
  insetHi: 'rgba(255,255,255,0.07)',
  orbitInner: '#a78bfa',
  feedLoaderBg: 'rgba(3,1,10,0.97)',
};

export const DARK: Palette = {
  bg: '#0a0a0c',
  bg2: '#101013',
  card: '#141417',
  card2: '#1a1a1e',
  border: '#232327',
  glow: '#3a3a40',
  purple: '#3a3a40',
  pdim: '#26262b',
  gold: '#c9a84c',
  gdim: '#5c4420',
  gglow: 'rgba(201,168,76,0.1)',
  white: '#f2f2f0',
  dim: '#77747e',
  muted: '#3a383f',
  red: '#ef4444',
  green: '#10b981',
  navDim: '#77747e',
  hairline: 'rgba(255,255,255,0.07)',
  bgRadial: null,
  navBg: 'rgba(20,20,23,0.92)',
  navShadow: '0px -4px 24px rgba(0,0,0,0.5)',
  sheet: '#141417',
  elev: '0px 10px 30px rgba(0,0,0,0.5)',
  insetHi: 'rgba(255,255,255,0.07)',
  orbitInner: '#77747e',
  feedLoaderBg: 'rgba(3,1,10,0.97)',
};

export const LIGHT: Palette = {
  bg: '#e7e0cf',
  bg2: '#efe9dc',
  card: '#f6f1e6',
  card2: '#ece5d6',
  border: '#d5cdb8',
  glow: '#c3b89e',
  purple: '#8a7f6b',
  pdim: '#ded7c5',
  gold: '#9a7b2d',
  gdim: '#c2b58f',
  gglow: 'rgba(154,123,45,0.12)',
  white: '#1a1424',
  dim: '#7c7668',
  muted: '#a9a190',
  red: '#d43c3c',
  green: '#10b981',
  navDim: '#7c7668',
  hairline: 'rgba(26,20,36,0.14)',
  bgRadial: { rx: 120, ry: 60, cx: 50, cy: 0, stops: [{ color: '#f2ecdd', offset: 0 }, { color: '#e7e0cf', offset: 0.6 }] },
  navBg: 'rgba(250,247,240,0.92)',
  navShadow: '0px -4px 20px rgba(26,20,36,0.16)',
  sheet: '#f6f1e6',
  elev: '0px 6px 18px rgba(26,20,36,0.12)',
  // :root[data-theme="light"] .bnav / .nation-card use inset 0 1px 0 rgba(255,255,255,.85)
  insetHi: 'rgba(255,255,255,0.85)',
  orbitInner: '#7c7668',
  feedLoaderBg: '#f7f3ea',
};

export const PALETTES: Record<ThemeName, Palette> = { void: VOID, dark: DARK, light: LIGHT };

/** Media surfaces (globe, reels, photo viewer) stay dark in every theme. */
export const MEDIA_SURFACE = { bg: '#05020e', text: '#f4f0ff', loaderBg: 'rgba(3,1,10,0.97)' } as const;

/** Font family keys registered with expo-font in app/_layout.tsx. Never set fontWeight with these. */
export const FONTS = {
  sans: 'Syne', // 400
  sansSemiBold: 'Syne-SemiBold', // 600
  sansBold: 'Syne-Bold', // 700
  sansExtraBold: 'Syne-ExtraBold', // 800
  mono: 'SyneMono',
  serif: 'DMSerifDisplay',
  serifItalic: 'DMSerifDisplay-Italic',
} as const;
export type FontKey = keyof typeof FONTS;

export const FONT_ASSETS = {
  Syne: require('../../assets/fonts/Syne-Regular.ttf'),
  'Syne-SemiBold': require('../../assets/fonts/Syne-SemiBold.ttf'),
  'Syne-Bold': require('../../assets/fonts/Syne-Bold.ttf'),
  'Syne-ExtraBold': require('../../assets/fonts/Syne-ExtraBold.ttf'),
  SyneMono: require('../../assets/fonts/SyneMono-Regular.ttf'),
  DMSerifDisplay: require('../../assets/fonts/DMSerifDisplay-Regular.ttf'),
  'DMSerifDisplay-Italic': require('../../assets/fonts/DMSerifDisplay-Italic.ttf'),
};

/** Radii used across the web CSS. */
export const RADII = {
  post: 20, // .post
  tile: 12, // .nation-card, inputs (.si-field input)
  themeCard: 14, // .theme-card
  nav: 24, // .bnav
  sheet: 24, // .composer-sheet top corners
  replySheet: 26, // .ro-sheet
  pill: 24, // .si-enter / .si-ghost
  chip: 20, // .si-alt-btn, #void-toast
  handle: 2,
} as const;

/** Layout constants shared with screens. */
export const LAYOUT = {
  gutter: 16, // .post margin 0 16px, .bnav margin 12px 16px 16px
  navMarginBottom: 16,
  /** Nav pill height: padding 13 + icon 19 + gap 7 + bar 1 + padding 10. */
  navPillHeight: 50,
  /** Distance of #void-toast from the bottom edge. */
  toastBottom: 96,
} as const;

/** CSS letter-spacing in em -> React Native px. */
export const em = (fontSize: number, e: number) => fontSize * e;
