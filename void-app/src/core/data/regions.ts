// ─── REGION RESOLUTION (ingest side) ─────────────────────────
// posts.region_code in Supabase is DERIVED by a trigger from a PostGIS `location`
// and discards anything a client supplies. But sources give country STRINGS, never
// coordinates (GDELT names, Reddit flair, Bluesky nothing). This turns
// "Palestinian Territories" / "DR Congo" / "Gaza" into a code and a point.
// Codes are ISO 3166-1 alpha-2 (matching `regions`); non-ISO / contested entries
// carry custom:true, the schema's escape hatch.
import type { Country, Post, Region, RegionAlias } from '../types.ts';
import { C } from './countries.generated.ts';
import { REGION_ALIASES } from './regionAliases.generated.ts';

export { C, REGION_ALIASES };

export const _regionNorm = (s: unknown): string => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')      // strip diacritics
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

type RegionHit = { code: string; lat: number; lon: number; name: string };
// Alias keys go through the same normaliser as lookups — otherwise 'u.k.' / 'u.s.'
// were unreachable (the lookup string had already lost its dots).
export const _REGION_ALIAS_N: Record<string, RegionAlias> = (() => { const m: Record<string, RegionAlias> = {}; for (const k in REGION_ALIASES) m[_regionNorm(k)] = REGION_ALIASES[k]; return m; })();
export const _regionByName: Record<string, RegionHit> = (() => { const m: Record<string, RegionHit> = {}; for (const c of C) m[_regionNorm(c.n)] = { code: c.iso, lat: c.lat, lon: c.lon, name: c.n }; return m; })();
export const _regionByCode: Record<string, RegionHit> = (() => { const m: Record<string, RegionHit> = {}; for (const c of C) m[c.iso] = { code: c.iso, lat: c.lat, lon: c.lon, name: c.n }; return m; })();

/** Returns {code,name,lat,lon,custom,parent} or null. Never throws on junk input. */
export function resolveRegion(raw: unknown): Region | null {
  const n = _regionNorm(raw);
  if (!n || n.length < 2) return null;
  const hit = Object.prototype.hasOwnProperty.call(_regionByName, n) ? _regionByName[n] : undefined;
  if (hit) return { ...hit, custom: false };
  const alias = Object.prototype.hasOwnProperty.call(_REGION_ALIAS_N, n) ? _REGION_ALIAS_N[n] : undefined;
  if (alias) {
    if (typeof alias === 'string') {
      const base = _regionByCode[alias];
      return base ? { ...base, custom: false } : { code: alias, name: String(raw), lat: 0, lon: 0, custom: false };
    }
    const base = alias.parent ? _regionByCode[alias.parent] : _regionByCode[alias.code];
    return {
      code: alias.code, name: String(raw), parent: alias.parent || null,
      lat: alias.lat != null ? alias.lat : (base ? base.lat : 0),
      lon: alias.lon != null ? alias.lon : (base ? base.lon : 0), custom: !!alias.custom,
    };
  }
  // Last resort: "Kyiv, Ukraine" / "Ukraine war". Longest known name contained in
  // it, so "South Korea" never loses to "Korea".
  let best: string | null = null;
  for (const k in _regionByName) {
    if (k.length > 3 && n.includes(k) && (!best || k.length > best.length)) best = k;
  }
  return best ? { ..._regionByName[best], custom: false } : null;
}

/** Stamp a post with its resolved region (_region is what the client matches on). */
export function stampRegion<T extends Partial<Post> | null | undefined>(p: T): T {
  if (!p) return p;
  const r = resolveRegion(p.country) || resolveRegion(p.iso) || null;
  if (r) {
    p._region = r.code; p._regionName = r.name; p._regionCustom = !!r.custom;
    if (r.parent) p._regionParent = r.parent;
    if (r.lat || r.lon) { p._lat = r.lat; p._lon = r.lon; }
    if (!p.iso) p.iso = (r.parent || r.code).slice(0, 2);
  }
  return p;
}

export function regionOf(c: Pick<Country, 'lat' | 'lon'>): string {
  const lon = c.lon || 0, lat = c.lat || 0;
  if (lon < -30) return 'AMERICAS';
  if (lon >= 40) return lat < -10 ? 'ASIA-PACIFIC' : 'ASIA-PACIFIC';
  if (lat > 35) return 'EUROPE';
  return 'AFRICA · MIDEAST';
}

export function countryByName(name: string): Country | undefined { return C.find(x => x.n === name); }
