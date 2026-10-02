// The live windows Jump In shows and Ignite offers. Each is one of the app's own
// city cams (CAM_SOURCES); an id the app drops from its pool drops out here too, so
// the flow never advertises a window the app itself no longer opens.
import { Image as ExpoImage } from 'expo-image';
import { CAM_SOURCES, C } from '../../core';

// [city, ISO, YouTube id] — the mock's list, in the mock's order.
const P: ReadonlyArray<readonly [string, string, string]> = [
  ['Tokyo', 'JP', 'dfVK7ld38Ys'],
  ['Istanbul', 'TR', 'qXRYokWh3rU'],
  ['New York', 'US', 'z-jYdOIKcTQ'],
  ['Seoul', 'KR', 'RVvYQghFCXk'],
  ['Sydney', 'AU', 'Fy8_xLMkAXc'],
  ['Jerusalem', 'IL', '77akujLn4k8'],
  ['Taipei', 'TW', 'z_fY1pj1VBw'],
  ['Baku', 'AZ', 'Bb-vF0Gq7RY'],
  ['Yerevan', 'AM', 'ifUdPP2zmPE'],
  // The Kyiv skyline stream (BIecBekaeuE) has ended; this is the app's other live Ukraine cam.
  ['Kyiv', 'UA', 'IcZ-7sFi1HM'],
  ['St Petersburg', 'RU', 'CjtIYbmVfck'],
  ['Addis Ababa', 'ET', 'phgndoqNNOY'],
  ['Paris', 'FR', 'u-wHHiQeM34'],
  ['Berlin', 'DE', 'v5OUHl8c9Es'],
];

export interface LivePlace {
  city: string;
  iso: string;
  /** Country name as the ranker keys regions (BIO.regions[p.country]), not the ISO. */
  country: string;
  thumb: string;
}

const YT_ID = /^[\w-]{11}$/;
const liveIds = new Set<string>();
for (const list of Object.values(CAM_SOURCES)) for (const s of list || []) if (s.type === 'youtube' && s.id && YT_ID.test(s.id)) liveIds.add(s.id);

export const PLACES: LivePlace[] = P.filter(([, , id]) => liveIds.has(id)).map(([city, iso, id]) => ({
  city,
  iso,
  country: C.find((c) => c.iso === iso)?.n || city,
  // mqdefault is 320×180: the tiles draw at 164×96, and a low-end phone decodes 42 of them.
  thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
}));

// ─── THE MARQUEES SHOW 21 TILES; THE CURATED LIST HAS 14 ─────────────────
// Screen 1 draws three rows of seven from PLACES, so seven of them had to be
// repeats - and because the rows scroll at their own speeds, a city and its twin
// drift into line with each other, which is when it reads as a bug rather than a
// wall. The app carries far more city windows than the fourteen named above, so
// the marquees are filled out from the rest of CAM_SOURCES instead: one extra
// window per country, so no country is doubled either, keyed by the country name
// since that is the name the app has for those cams.
//
// PLACES itself is untouched - Ignite still offers the curated fourteen.
const named = new Set(PLACES.map((p) => p.iso));
const extra: LivePlace[] = [];
for (const [country, list] of Object.entries(CAM_SOURCES)) {
  const co = C.find((c) => c.n === country);
  if (!co || named.has(co.iso)) continue;
  const src = (list || []).find((s) => s.type === 'youtube' && s.id && YT_ID.test(s.id));
  if (!src || !src.id) continue;
  named.add(co.iso);
  extra.push({ city: country, iso: co.iso, country, thumb: `https://i.ytimg.com/vi/${src.id}/mqdefault.jpg` });
}

/** Screen 1's three rows of seven, every tile a different place. The pool comes
 *  to 22 today; should the source data ever shrink below 21 the rows are padded
 *  rather than left short, since a missing row is worse than a repeated tile. */
export const MARQUEE_PLACES: LivePlace[] = (() => {
  const pool = [...PLACES, ...extra];
  if (!pool.length) return [];
  const out = pool.slice(0, 21);
  for (let i = 0; out.length < 21; i++) out.push(pool[i % pool.length]);
  return out;
})();

// THE TILES ARRIVE WITH THE SCREEN, NOT AFTER IT.
// The marquees draw 42 tiles and each one fetched its own thumbnail on mount, so a
// cold first launch - which is the only launch that shows this screen - opened on a
// wall of empty purple cards and filled in over the next second or two. That is the
// first thing a new install sees. The images are warmed here instead, when the module
// is first imported (before the screen mounts), into the same memory-disk cache the
// tiles read from; a failure is irrelevant, the tile just loads it the old way.
try {
  void ExpoImage.prefetch(
    MARQUEE_PLACES.map((p) => p.thumb),
    'memory-disk',
  );
} catch {
  /* prefetch is a nicety, never a requirement */
}

/** Every playable city window the app carries — the "{n} WINDOWS OPEN" count. */
export const WINDOW_COUNT = liveIds.size;
