// Generates 003_regions_seed.sql from the SAME data the client resolves against,
// so resolveRegion() codes and the regions table cannot drift apart.
const fs = require('fs');
const src = fs.readFileSync('D:/all projects/The Void/void2-final.html', 'utf8');

// Pull the C table and the alias map straight out of the app.
const cSrc = src.slice(src.indexOf('const C=['), src.indexOf('// ─── REGION RESOLUTION'));
const rSrc = src.slice(src.indexOf('const REGION_ALIASES='), src.indexOf('const _regionNorm='));
let C, REGION_ALIASES;
eval(cSrc.replace(/^const C=/, 'C='));
eval(rSrc.replace(/^const REGION_ALIASES=/, 'REGION_ALIASES='));

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const rows = [];
const seen = new Set();

// Countries: ISO 3166-1 alpha-2 + centroid from the globe table.
for (const c of C) {
  if (!c.iso || seen.has(c.iso)) continue;
  seen.add(c.iso);
  rows.push(`  (${q(c.iso)}, ${q(c.n)}, 'country', null, ${c.lon}, ${c.lat}, false)`);
}

// Contested / sub-national entries carried by the alias table.
for (const k in REGION_ALIASES) {
  const a = REGION_ALIASES[k];
  if (typeof a === 'string' || !a.custom) continue;
  if (seen.has(a.code)) continue;
  seen.add(a.code);
  const parent = a.parent || null;
  const base = parent ? C.find((c) => c.iso === parent) : null;
  const lat = a.lat != null ? a.lat : base ? base.lat : 0;
  const lon = a.lon != null ? a.lon : base ? base.lon : 0;
  const name = k.replace(/\b\w/g, (m) => m.toUpperCase());
  const level = parent ? 'subdivision' : 'country';
  rows.push(`  (${q(a.code)}, ${q(name)}, ${q(level)}, ${parent ? q(parent) : 'null'}, ${lon}, ${lat}, true)`);
}

// Parents must exist before children (parent_code FK). Countries first.
rows.sort((a, b) => (a.includes("'country'") ? 0 : 1) - (b.includes("'country'") ? 0 : 1));

const sql = `-- ============================================================
-- 003_regions_seed.sql
--
-- GENERATED from the client's own region data (the C table + REGION_ALIASES in
-- void2-final.html) by scratchpad/genseed.js. Regenerate rather than hand-edit,
-- or the codes the client stamps on posts will drift from the rows the trigger
-- resolves against.
--
-- WHY THIS EXISTS
-- 001 leaves \`regions\` empty and expects a Natural Earth import. Until that
-- happens set_post_region() resolves nothing (it filters on \`geom is not null\`),
-- so every post gets region_code = null and every region feature is dead.
--
-- This seeds ${rows.length} regions with CENTROIDS but no polygons, and adds a
-- nearest-centroid fallback to set_post_region so region resolution works NOW.
-- Import Natural Earth later and the polygon path takes precedence automatically:
-- the fallback only fires when no geometry covers the point.
--
-- Contested/sub-national entries carry custom = true, exactly as 001 documents.
-- ============================================================

insert into regions (code, name, level, parent_code, centroid, custom) values
${rows.map((r) => {
  const m = r.match(/^  \((.+), (-?[\d.]+), (-?[\d.]+), (true|false)\)$/);
  const [, head, lon, lat, custom] = m;
  return `  (${head}, st_setsrid(st_makepoint(${lon}, ${lat}), 4326)::geography, ${custom})`;
}).join(',\n')}
on conflict (code) do update
  set name     = excluded.name,
      level    = excluded.level,
      centroid = excluded.centroid,
      custom   = excluded.custom;

-- ============================================================
-- Nearest-centroid fallback.
--
-- Unchanged behaviour when polygons exist: ST_Covers still wins. This only adds a
-- result where there was previously none, and is bounded so a point in the middle
-- of an ocean does not get attributed to a country 3000km away.
-- ============================================================
create or replace function set_post_region()
returns trigger language plpgsql as $$
declare
  match_code text;
begin
  if tg_op = 'UPDATE' and new.location is not distinct from old.location then
    new.region_code := old.region_code;
    return new;
  end if;

  if new.location is null then
    new.region_code := null;
    return new;
  end if;

  -- 1. Authoritative: point-in-polygon, when geometry has been imported.
  select r.code into match_code
  from regions r
  where r.geom is not null
    and st_covers(r.geom, new.location)
  order by r.level desc          -- subdivision beats the country containing it
  limit 1;

  -- 2. Fallback: nearest centroid within 900km. Country-grained and approximate,
  --    which is honest for a source that only ever gave us a country NAME.
  if match_code is null then
    select r.code into match_code
    from regions r
    where r.centroid is not null
      and st_dwithin(r.centroid, new.location, 900000)
    order by r.centroid <-> new.location
    limit 1;
  end if;

  new.region_code := match_code;
  return new;
end;
$$;

create index if not exists regions_centroid_gix on regions using gist (centroid);
`;

fs.writeFileSync('D:/all projects/The Void/supabase/migrations/003_regions_seed.sql', sql);
console.log('wrote 003_regions_seed.sql with', rows.length, 'regions');
console.log('custom entries:', rows.filter((r) => r.endsWith('true)')).length);
