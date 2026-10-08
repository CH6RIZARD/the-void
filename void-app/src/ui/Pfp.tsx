// THE PFP SET - the default avatars, ported from the handoff mock (messages-6mb.html
// `FIG` + `fig()`). A gold line figure on a deep-purple disc, used wherever someone
// has no photo: the pinned strip, conversation rows, the thread, the profile.
//
// The figure is chosen by number, and the SAME number always gives the SAME figure,
// so a person keeps one face everywhere they appear.
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { readJSON, VoidAPI, writeJSON } from '../core';
import Svg, { Defs, Path, RadialGradient, Stop, Circle } from 'react-native-svg';

const GOLD = '#c9a84c';

export interface PfpFigure { n: number; name: string; d: string; fill?: string }

/** The 26 figures of the set, in the mock's order. */
export const PFP_FIGURES: PfpFigure[] = [
  { n: 1, name: 'Classic bust', d: 'M50 26a13 13 0 1 1 0 26a13 13 0 1 1 0-26z M22 88c2-18 13-28 28-28s26 10 28 28' },
  { n: 2, name: 'Bust · filled head', d: 'M22 88c2-18 13-28 28-28s26 10 28 28', fill: 'M50 26a13 13 0 1 1 0 26a13 13 0 1 1 0-26z' },
  { n: 3, name: 'Hex head', d: 'M50 24l12 7v14l-12 7-12-7V31z M22 88c2-18 13-28 28-28s26 10 28 28' },
  { n: 4, name: 'Hooded', d: 'M50 22c-16 0-26 12-26 30v10h52V52c0-18-10-30-26-30z M40 62c2-10 6-14 10-14s8 4 10 14 M26 88c4-10 12-16 24-16s20 6 24 16' },
  { n: 5, name: 'Silhouette · rounded', d: 'M50 24a12 12 0 0 1 12 12v6a12 12 0 0 1-24 0v-6a12 12 0 0 1 12-12z M20 90c0-16 12-26 30-26s30 10 30 26' },
  { n: 6, name: 'Two strokes', d: 'M38 40a12 12 0 1 0 24 0 M24 86c4-16 14-24 26-24s22 8 26 24' },
  { n: 7, name: 'Dot head · arc', d: 'M22 84c4-14 14-22 28-22s24 8 28 22', fill: 'M50 30a10 10 0 1 1 0 20a10 10 0 1 1 0-20z' },
  { n: 8, name: 'Bust with collar', d: 'M50 26a13 13 0 1 1 0 26a13 13 0 1 1 0-26z M22 88c2-18 13-28 28-28s26 10 28 28 M42 60l8 12 8-12' },
  { n: 9, name: 'Offset · looking away', d: 'M46 30a12 12 0 1 1 8 22 M20 90c2-17 12-27 28-27 8 0 15 2 21 6' },
  { n: 10, name: 'Hex bust', d: 'M50 26a13 13 0 1 1 0 26a13 13 0 1 1 0-26z M50 60l26 15v13H24V75z' },
  { n: 11, name: 'Ghost', d: 'M30 88V50a20 20 0 0 1 40 0v38l-8-6-8 6-8-6-8 6-8-6z', fill: 'M42 48a3 3 0 1 1 0 6a3 3 0 1 1 0-6z M58 48a3 3 0 1 1 0 6a3 3 0 1 1 0-6z' },
  { n: 12, name: 'Masked', d: 'M50 26a13 13 0 1 1 0 26a13 13 0 1 1 0-26z M22 88c2-18 13-28 28-28s26 10 28 28', fill: 'M38 36h24v8H38z' },
  { n: 13, name: 'Halo', d: 'M50 30a12 12 0 1 1 0 24a12 12 0 1 1 0-24z M24 88c3-16 13-25 26-25s23 9 26 25', fill: 'M50 14a20 4 0 1 0 0 8a20 4 0 1 0 0-8z' },
  { n: 14, name: 'Square head', d: 'M38 28h24v24H38z M22 88c2-18 13-28 28-28s26 10 28 28' },
  { n: 15, name: 'Crescent', d: 'M56 24a16 16 0 1 0 8 30 12 12 0 1 1-8-30z M22 88c2-18 13-28 28-28s26 10 28 28' },
  { n: 16, name: 'Antenna', d: 'M50 30a12 12 0 1 1 0 24a12 12 0 1 1 0-24z M50 30V18 M22 88c2-18 13-28 28-28s26 10 28 28', fill: 'M50 12a4 4 0 1 1 0 8a4 4 0 1 1 0-8z' },
  { n: 17, name: 'Eye', d: 'M20 50c10-16 50-16 60 0-10 16-50 16-60 0z', fill: 'M50 42a8 8 0 1 1 0 16a8 8 0 1 1 0-16z' },
  { n: 18, name: 'Pin drop', d: 'M50 20c-12 0-20 9-20 20 0 14 20 40 20 40s20-26 20-40c0-11-8-20-20-20z', fill: 'M50 33a7 7 0 1 1 0 14a7 7 0 1 1 0-14z' },
  { n: 19, name: 'Double bust', d: 'M38 34a9 9 0 1 1 0 18a9 9 0 1 1 0-18z M62 34a9 9 0 1 1 0 18a9 9 0 1 1 0-18z M16 84c2-14 10-22 22-22 4 0 8 1 12 4 4-3 8-4 12-4 12 0 20 8 22 22' },
  { n: 20, name: 'Void ring', d: 'M50 22a28 28 0 1 1 0 56a28 28 0 1 1 0-56z', fill: 'M50 40a10 10 0 1 1 0 20a10 10 0 1 1 0-20z' },
  { n: 24, name: 'Smiling', d: 'M50 26a13 13 0 1 1 0 26a13 13 0 1 1 0-26z M22 88c2-18 13-28 28-28s26 10 28 28 M44 42c2 4 10 4 12 0', fill: 'M45 34a1.8 1.8 0 1 1 0 3.6a1.8 1.8 0 1 1 0-3.6z M55 34a1.8 1.8 0 1 1 0 3.6a1.8 1.8 0 1 1 0-3.6z' },
  { n: 25, name: 'Sleeping', d: 'M50 26a13 13 0 1 1 0 26a13 13 0 1 1 0-26z M22 88c2-18 13-28 28-28s26 10 28 28 M43 38c2 2 5 2 7 0 M53 38c2 2 5 2 7 0 M68 20h8l-8 8h8' },
  { n: 26, name: 'Looking up', d: 'M50 26a13 13 0 1 1 0 26a13 13 0 1 1 0-26z M22 88c2-18 13-28 28-28s26 10 28 28', fill: 'M45 30a2 2 0 1 1 0 4a2 2 0 1 1 0-4z M55 30a2 2 0 1 1 0 4a2 2 0 1 1 0-4z' },
  { n: 27, name: 'Winking', d: 'M50 26a13 13 0 1 1 0 26a13 13 0 1 1 0-26z M22 88c2-18 13-28 28-28s26 10 28 28 M53 36h6 M46 42c2 3 6 3 8 0', fill: 'M45 34a1.8 1.8 0 1 1 0 3.6a1.8 1.8 0 1 1 0-3.6z' },
  { n: 28, name: 'Headphones', d: 'M50 26a13 13 0 1 1 0 26a13 13 0 1 1 0-26z M22 88c2-18 13-28 28-28s26 10 28 28 M35 40a15 15 0 0 1 30 0', fill: 'M32 38h5v9h-5z M63 38h5v9h-5z' },
  { n: 30, name: 'Speaking', d: 'M50 26a13 13 0 1 1 0 26a13 13 0 1 1 0-26z M22 88c2-18 13-28 28-28s26 10 28 28 M66 22h16a5 5 0 0 1 5 5v9a5 5 0 0 1-5 5h-9l-6 6v-6h-1a5 5 0 0 1-5-5v-9a5 5 0 0 1 5-5z', fill: 'M69 30a2 2 0 1 1 0 4a2 2 0 1 1 0-4z M74 30a2 2 0 1 1 0 4a2 2 0 1 1 0-4z M79 30a2 2 0 1 1 0 4a2 2 0 1 1 0-4z' },
];

const BY_N = new Map<number, PfpFigure>(PFP_FIGURES.map((f) => [f.n, f]));

/**
 * Which figure a person gets when they have not chosen one.
 *
 * Derived from their id, so it is stable for that person on every device and in
 * every list - the alternative, a random or index-based pick, gives someone a
 * different face in the pinned strip than in the thread they are pinned to.
 */
export function pfpFor(seed: string | null | undefined): PfpFigure {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PFP_FIGURES[h % PFP_FIGURES.length] || PFP_FIGURES[0];
}

/** The figure alone, no disc - for placing on something that already has one. */
export function PfpFigureSvg({ fig, size, strokeWidth = 2.2 }: { fig: PfpFigure; size: number; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d={fig.d} fill="none" stroke={GOLD} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      {fig.fill ? <Path d={fig.fill} fill={GOLD} /> : null}
    </Svg>
  );
}

/**
 * The default avatar: figure on the deep-purple disc.
 *
 * `figure` picks explicitly; otherwise `seed` (an id) decides. `ring` draws the
 * gold outline the mock puts on an unread pin.
 */
export function Pfp({ seed, figure, size = 44, ring = false }: { seed?: string | null; figure?: number; size?: number; ring?: boolean }) {
  const fig = (figure != null && BY_N.get(figure)) || pfpFor(seed);
  const strokeWidth = size >= 90 ? 1.8 : 2.2;
  const [failed, setFailed] = useState(false);
  if (failed) return <PfpSvg fig={fig} size={size} ring={ring} strokeWidth={strokeWidth} />;
  // ONE native view, not six. Disc + ring + figure used to be two react-native-svg
  // trees per avatar (Svg/Defs/RadialGradient/Circle, then Svg/Path/Path), which is
  // the pattern Glyph.tsx removed from icons after the 2026-09-21 ANR: every card
  // in a fling batch mounted them all in one commit. Same markup, one expo-image,
  // decoded off the main thread and cached; the Svg tree is the fallback.
  return (
    <Image
      source={{ uri: pfpUri(fig, ring, strokeWidth) }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      contentFit="contain"
      cachePolicy="memory"
      transition={0}
      accessible={false}
      onError={() => setFailed(true)}
    />
  );
}

const uriCache = new Map<string, string>();
// Figures are 100x100 and sit on the disc at 72% (PfpSvg's `inner`), so the group is
// scaled .72 and offset 14 - stroke width scales with it, as it did at `inner` px.
function pfpUri(fig: PfpFigure, ring: boolean, strokeWidth: number): string {
  const key = fig.n + (ring ? 'r' : '') + strokeWidth;
  let uri = uriCache.get(key);
  if (!uri) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">` +
      `<defs><radialGradient id="d" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#2a1060"/><stop offset="0.7" stop-color="#0d0520"/></radialGradient></defs>` +
      `<circle cx="50" cy="50" r="50" fill="url(#d)"/>` +
      (ring ? `<circle cx="50" cy="50" r="48.5" fill="none" stroke="${GOLD}" stroke-width="3"/>` : '') +
      `<g transform="translate(14 14) scale(0.72)">` +
      `<path d="${fig.d}" fill="none" stroke="${GOLD}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>` +
      (fig.fill ? `<path d="${fig.fill}" fill="${GOLD}"/>` : '') +
      `</g></svg>`;
    uri = `data:image/svg+xml;base64,${btoa(svg)}`;
    uriCache.set(key, uri);
  }
  return uri;
}

/** The react-native-svg drawing of the same avatar: the fallback if the image fails to decode. */
function PfpSvg({ fig, size, ring, strokeWidth }: { fig: PfpFigure; size: number; ring: boolean; strokeWidth: number }) {
  // The mock's figures sit in a 100x100 box that is mostly figure; on the disc they
  // read better at about 70% of it.
  const inner = Math.round(size * 0.72);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
        <Defs>
          <RadialGradient id="pfpDisc" cx="35%" cy="30%" r="75%">
            <Stop offset="0" stopColor="#2a1060" />
            <Stop offset="0.7" stopColor="#0d0520" />
          </RadialGradient>
        </Defs>
        <Circle cx={50} cy={50} r={50} fill="url(#pfpDisc)" />
        {ring ? <Circle cx={50} cy={50} r={48.5} fill="none" stroke={GOLD} strokeWidth={3} /> : null}
      </Svg>
      <PfpFigureSvg fig={fig} size={inner} strokeWidth={strokeWidth} />
    </View>
  );
}


// ─── WHICH FIGURE SOMEONE CHOSE ─────────────────────────────────────────
// The set is something a person PICKS from when they are not using a photo, so
// the choice has to outlive the render that made it.
//
// It is stored on this device, because `profiles` has no column for it. That
// means a picked figure follows the account only as far as this install: other
// people still see the id-derived default for them, which is why the default is
// derived rather than random - it is stable and it is never nobody's face.
// Moving this to the server is one column and one line in saveProfile.
const PFP_KEY = 'void.pfp.figure';

export function readPfpChoice(): number | null {
  try {
    const v = readJSON<number | null>(PFP_KEY, null);
    return typeof v === 'number' && BY_N.has(v) ? v : null;
  } catch {
    return null;
  }
}

export function writePfpChoice(n: number | null): void {
  try {
    writeJSON(PFP_KEY, n);
  } catch {
    /* storage unavailable - the default still renders */
  }
}

/** A person's own avatar: their pick if they made one, the derived default if not. */
export function MyPfp({ seed, size = 44, ring = false }: { seed?: string | null; size?: number; ring?: boolean }) {
  const chosen = readPfpChoice();
  return <Pfp seed={seed} figure={chosen ?? undefined} size={size} ring={ring} />;
}

/**
 * The seed every surface uses for one person: their Void id, else their handle,
 * else their name. Messages already seed by id, so a Void user's figure in the
 * feed, a reel, a thread or a comment is the one in their DM row and profile.
 */
export function personSeed(uid?: string | null, handle?: string | null, label?: string | null): string {
  const h = String(handle || '').replace(/^@/, '').toLowerCase();
  return uid || (h && h !== 'void' ? h : '') || String(label || '').toLowerCase() || 'void';
}

/**
 * Anyone's avatar where there is no photo - which, for posts, is everywhere: no
 * source carries one. Replaces the letter on a coloured disc. Your own posts show
 * the figure you picked.
 */
export function PersonPfp({ uid, handle, label, size = 44, ring = false }: { uid?: string | null; handle?: string | null; label?: string | null; size?: number; ring?: boolean }) {
  let mine = false;
  try {
    mine = !!uid && uid === VoidAPI._uid();
  } catch {}
  return mine ? <MyPfp seed={uid} size={size} ring={ring} /> : <Pfp seed={personSeed(uid, handle, label)} size={size} ring={ring} />;
}

/** Every figure, for the picker. */
export function PfpChoices({ value, onPick, size = 56 }: { value: number | null; onPick: (n: number) => void; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
      {PFP_FIGURES.map((f) => (
        <Pressable
          key={f.n}
          onPress={() => onPick(f.n)}
          accessibilityRole="button"
          accessibilityLabel={f.name}
          accessibilityState={{ selected: value === f.n }}
          style={{ borderRadius: size / 2, opacity: value == null || value === f.n ? 1 : 0.55 }}
        >
          <Pfp figure={f.n} size={size} ring={value === f.n} />
        </Pressable>
      ))}
    </View>
  );
}
