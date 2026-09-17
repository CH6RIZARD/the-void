// Stream source catalogues + the per-country chains built from them.
import type { StreamSource } from '../types.ts';
import { C } from './countries.generated.ts';
import { CAM_SOURCES, COUNTRY_CH, GLOBAL_POOL, LIVE_CHANNELS, NEWS_SOURCES, RAW_FOOTAGE, VOID_LIVE } from './streams.generated.ts';
import { IPTV_POOL } from './iptv.generated.ts';
import { LIFE_POOL } from './life.generated.ts';

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
  return [...(CAM_SOURCES[name] || []), ...(RAW_FOOTAGE[name] || []), ...(NEWS_SOURCES[name] || []), ...buildYtTail(name), ...GLOBAL_POOL];
}
// World wall tile chain: LIVE cams -> RECENT raw ONLY. No news, ever.
export function wallChain(name: string): StreamSource[] {
  return [...(CAM_SOURCES[name] || []), ...(RAW_FOOTAGE[name] || []), ...GLOBAL_POOL];
}
// Countries that actually have live/raw (non-news) content, tension-ordered.
export function tensionCountries(): string[] {
  return [...C].map(c => c.n)
    .filter(n => (CAM_SOURCES[n] && CAM_SOURCES[n].length) || (RAW_FOOTAGE[n] && RAW_FOOTAGE[n].length))
    .sort((a, b) => rankOf(a) - rankOf(b));
}
