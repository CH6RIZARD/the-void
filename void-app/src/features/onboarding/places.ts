// The live windows Jump In shows and Ignite offers. Each is one of the app's own
// city cams (CAM_SOURCES); an id the app drops from its pool drops out here too, so
// the flow never advertises a window the app itself no longer opens.
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

/** Every playable city window the app carries — the "{n} WINDOWS OPEN" count. */
export const WINDOW_COUNT = liveIds.size;
