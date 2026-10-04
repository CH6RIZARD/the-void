// Stream source catalogues + the per-country chains built from them.
import type { StreamSource } from '../types.ts';
import { C } from './countries.generated.ts';
import { CAM_SOURCES, COUNTRY_CH, GLOBAL_POOL, LIVE_CHANNELS, NEWS_SOURCES, RAW_FOOTAGE, VOID_LIVE } from './streams.generated.ts';
import { IPTV_POOL } from './iptv.generated.ts';
import { LIFE_POOL } from './life.generated.ts';

// Evaluating this module builds the stream tables - iptv.generated.ts alone is
// 302K of literals and 2589 objects - and it happens on whichever JS tick first
// touches it, which is a tick that was doing something else. Named so a stall
// that lands here says so instead of saying 'idle'.
import { mark as _mark } from '../slow.ts';
_mark('data:sources');

export { CAM_SOURCES, COUNTRY_CH, GLOBAL_POOL, LIVE_CHANNELS, NEWS_SOURCES, RAW_FOOTAGE, VOID_LIVE, IPTV_POOL, LIFE_POOL };

/** Verified IPTV (HLS) pool for a country. Always a fresh copy; [] when none. */
export function iptvFor(country: string): StreamSource[] {
  const a = Object.prototype.hasOwnProperty.call(IPTV_POOL, country) ? IPTV_POOL[country] : undefined;
  return Array.isArray(a) ? a.slice() : [];
}
/** LIFE pool (walks / day-in-the-life / live cams). Always a fresh copy. */
export function lifeFor(country: string): StreamSource[] {
  const a = Object.prototype.hasOwnProperty.call(LIFE_POOL, country) ? LIFE_POOL[country] : undefined;
  return Array.isArray(a) ? a.slice() : [];
}

// Static, curated social-tension order (2026-07, editable). Drives world-wall
// ordering and grid size.
export const TENSION_RANK = ['Ukraine', 'Israel', 'Russia', 'Iran', 'Syria', 'Yemen', 'Nepal',
  'Lebanon', 'Iraq', 'Sudan', 'North Korea', 'Myanmar', 'Pakistan', 'Nigeria', 'Somalia',
  'Ethiopia', 'Venezuela', 'Haiti', 'Taiwan', 'China', 'United States', 'India', 'Turkey',
  'Saudi Arabia', 'Egypt', 'Libya', 'Mali', 'Afghanistan'];
export function rankOf(name: string): number { const i = TENSION_RANK.indexOf(name); return i < 0 ? 999 : i; }

export function getCountryChs(name: string) { const idxs = COUNTRY_CH[name] || [0, 1, 2, 3, 4, 5]; return idxs.map(i => LIVE_CHANNELS[i % LIVE_CHANNELS.length]); }

/** YouTube embed URL for a channel (live_stream) or a resolved live video id. */
export function liveUrl(chOrId: string | { id: string; vid?: string }, mute = 1, origin = ''): string {
  const o = encodeURIComponent(origin || '');
  const ch = (typeof chOrId === 'object' && chOrId) ? chOrId : null;
  const channelId = ch ? ch.id : chOrId as string;
  const vid = ch && ch.vid ? ch.vid : null;
  const common = `autoplay=1&mute=${mute}&controls=0&rel=0&playsinline=1&iv_load_policy=3&fs=0&disablekb=1&enablejsapi=1&origin=${o}`;
  if (vid) return `https://www.youtube.com/embed/${vid}?${common}`;
  return `https://www.youtube.com/embed/live_stream?channel=${channelId}&${common}`;
}

// LIVE_CHANNELS -> youtube descriptors, appended as the last-resort tail.
export function buildYtTail(name: string): StreamSource[] {
  const order = COUNTRY_CH[name] || [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  return order.map(i => { const ch = LIVE_CHANNELS[i % LIVE_CHANNELS.length]; return { type: 'youtube', id: ch.id, label: ch.n }; });
}
// Country-section chain: LIVE cams -> RECENT raw -> nation news -> generic news tail -> global pool.
export function getCountrySources(name: string): StreamSource[] {
  // No GLOBAL_POOL tail: it is two test streams (Big Buck Bunny and an Akamai
  // test master) labelled 'GLOBAL FEED', and a country with no live source is
  // better described as having none than as showing a cartoon under its name.
  // The country section may carry news, so IPTV belongs here - 2186 verified HLS
  // channels across 154 countries, which is the deep pool the app already had and
  // was only half using.
  return [...liveFor(name), ...(NEWS_SOURCES[name] || []), ...iptvFor(name), ...buildYtTail(name)];
}
/**
 * Every non-news live source this app has, for one country.
 *
 * The wall used to be cams + raw footage and nothing else - a few hundred
 * sources over 78 countries - with GLOBAL_POOL's two TEST STREAMS on the end as
 * the catch-all. Take the test streams away (and they had to go: one of them is
 * Big Buck Bunny) and a country with no cam had an EMPTY chain, so its tile
 * refused instantly and the wall came up two-thirds empty.
 *
 * Meanwhile LIFE_POOL - 487 walks, day-in-the-life and live cams across 82
 * countries - was sitting right here, used by the nation screen and never by the
 * wall. It is exactly what the wall is for.
 *
 * IPTV_POOL (2186 sources) is deliberately NOT here: it is broadcast channels,
 * and the wall's rule is no news, ever. The nation screen is where those belong.
 */
function liveFor(name: string): StreamSource[] {
  return [...(CAM_SOURCES[name] || []), ...(RAW_FOOTAGE[name] || []), ...lifeFor(name)];
}

/**
 * Real substitutes from ELSEWHERE, when a country runs out of its own.
 *
 * A wall tile that cannot reach its country should show somewhere else that is
 * actually live rather than a test clip or a dead square. Shuffled per call so
 * two failing tiles do not queue behind the same substitute.
 */
function elsewhere(name: string, want = 14): StreamSource[] {
  const names = Object.keys(CAM_SOURCES).concat(Object.keys(LIFE_POOL)).filter((n) => n !== name);
  const out: StreamSource[] = [];
  const seen = new Set<string>();
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  for (const n of names) {
    for (const src of liveFor(n)) {
      const k = String((src as { url?: string; id?: string }).url || (src as { id?: string }).id || '');
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(src);
      if (out.length >= want) return out;
    }
  }
  return out;
}

/**
 * A spread of HLS streams from everywhere, for a surface that is not about one
 * country.
 *
 * The search tiles were YouTube and only YouTube - the thirteen LIVE_CHANNELS,
 * each tile trying the others as substitutes. When a YouTube embed will not play
 * (and on these devices they often will not), the whole chain is embeds, so the
 * tile walks all thirteen and lands on nothing. Meanwhile the wall, which is HLS,
 * plays fine on the same screen.
 *
 * So search gets the same pools the wall and the nation screens use: real HLS,
 * shuffled, de-duplicated, as substitutes AFTER the channel's own embed.
 *
 * IPTV ONLY, AND DELIBERATELY SO NOW. This used to list LIFE_POOL as well and
 * then throw every one of its 487 entries away, because a LIFE entry is a
 * YouTube id with no `url` and the de-duplication keyed on `url`. The effect was
 * right - a spread of HLS - but by accident, which is the kind of thing that
 * gets 'fixed' later by someone who notices the filter and removes it. LIFE is
 * YouTube; a chain that exists to escape YouTube embeds has no use for it.
 */
export function hlsSpread(want = 20): StreamSource[] {
  const names = Object.keys(IPTV_POOL);
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  const out: StreamSource[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    for (const src of iptvFor(n)) {
      const k = String((src as { url?: string }).url || '');
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(src);
      if (out.length >= want) return out;
    }
  }
  return out;
}



// World wall tile chain: this country's live cams, raw footage and LIFE streams,
// then real live streams from elsewhere. No news, ever - and no test streams.
export function wallChain(name: string): StreamSource[] {
  return [...liveFor(name), ...elsewhere(name)];
}
// Countries that actually have live/raw (non-news) content, tension-ordered.
export function tensionCountries(): string[] {
  return [...C].map(c => c.n)
    .filter(n => (CAM_SOURCES[n] && CAM_SOURCES[n].length) || (RAW_FOOTAGE[n] && RAW_FOOTAGE[n].length))
    .sort((a, b) => rankOf(a) - rankOf(b));
}
