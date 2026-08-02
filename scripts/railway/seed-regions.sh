#!/usr/bin/env bash
# Phase 3 — seed regions from Natural Earth admin-0 / admin-1 into Railway.
# Runs as DATABASE_URL user (DB owner). regions is read-only under RLS by design.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_env.sh"
require_database_url

command -v ogr2ogr >/dev/null || { echo "ERROR: ogr2ogr required (GDAL)"; exit 1; }

CACHE="$SCRIPT_DIR/.cache/natural-earth"
mkdir -p "$CACHE"

A0_ZIP="$CACHE/ne_10m_admin_0_countries.zip"
A1_ZIP="$CACHE/ne_10m_admin_1_states_provinces.zip"
A0_URL="https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip"
A1_URL="https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip"

download() {
  local url="$1" dest="$2"
  if [[ -f "$dest" ]]; then
    echo "cached: $dest"
    return
  fi
  echo "Downloading $url"
  curl -L --fail --retry 3 -o "$dest" "$url"
}

download "$A0_URL" "$A0_ZIP"
download "$A1_URL" "$A1_ZIP"

unzip -qo "$A0_ZIP" -d "$CACHE/admin0"
unzip -qo "$A1_ZIP" -d "$CACHE/admin1"

A0_SHP="$(find "$CACHE/admin0" -name '*.shp' | head -1)"
A1_SHP="$(find "$CACHE/admin1" -name '*.shp' | head -1)"
[[ -n "$A0_SHP" && -n "$A1_SHP" ]] || { echo "ERROR: shapefiles missing after unzip"; exit 1; }

# Load into staging tables, then upsert into regions with MultiPolygon geography.
echo "==> Staging admin-0 (countries)"
ogr2ogr -overwrite -f PostgreSQL "PG:$DATABASE_URL" "$A0_SHP" \
  -nln ne_admin0 -nlt MULTIPOLYGON -lco GEOMETRY_NAME=geom -lco PRECISION=NO \
  -t_srs EPSG:4326

echo "==> Staging admin-1 (subdivisions)"
ogr2ogr -overwrite -f PostgreSQL "PG:$DATABASE_URL" "$A1_SHP" \
  -nln ne_admin1 -nlt MULTIPOLYGON -lco GEOMETRY_NAME=geom -lco PRECISION=NO \
  -t_srs EPSG:4326

echo "==> Upserting into regions"
psql_db <<'SQL'
-- Countries: level=country, code=iso_a2
INSERT INTO regions (code, name, level, parent_code, geom, custom)
SELECT
  upper(trim(iso_a2)) AS code,
  name,
  'country'::text AS level,
  NULL::text AS parent_code,
  ST_Multi(geom)::geography(MultiPolygon,4326) AS geom,
  false AS custom
FROM ne_admin0
WHERE iso_a2 IS NOT NULL
  AND trim(iso_a2) <> ''
  AND trim(iso_a2) <> '-99'
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    level = EXCLUDED.level,
    parent_code = EXCLUDED.parent_code,
    custom = EXCLUDED.custom;

-- Null / -99 ISO rows: stable custom codes, do not invent ISO
INSERT INTO regions (code, name, level, parent_code, geom, custom)
SELECT
  'CUSTOM-A0-' || md5(COALESCE(name,'') || COALESCE(iso_a2,'')) AS code,
  name,
  'country',
  NULL,
  ST_Multi(geom)::geography(MultiPolygon,4326),
  true
FROM ne_admin0
WHERE iso_a2 IS NULL OR trim(iso_a2) = '' OR trim(iso_a2) = '-99'
ON CONFLICT (code) DO NOTHING;

-- Subdivisions: code=iso_3166_2, parent=substring before hyphen
INSERT INTO regions (code, name, level, parent_code, geom, custom)
SELECT
  upper(trim(iso_3166_2)) AS code,
  name,
  'subdivision',
  split_part(upper(trim(iso_3166_2)), '-', 1) AS parent_code,
  ST_Multi(geom)::geography(MultiPolygon,4326),
  false
FROM ne_admin1
WHERE iso_3166_2 IS NOT NULL
  AND trim(iso_3166_2) <> ''
  AND trim(iso_3166_2) <> '-99'
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    geom = EXCLUDED.geom,
    level = EXCLUDED.level,
    parent_code = EXCLUDED.parent_code,
    custom = EXCLUDED.custom;

INSERT INTO regions (code, name, level, parent_code, geom, custom)
SELECT
  'CUSTOM-A1-' || md5(COALESCE(name,'') || COALESCE(iso_3166_2,'')) AS code,
  name,
  'subdivision',
  NULL,
  ST_Multi(geom)::geography(MultiPolygon,4326),
  true
FROM ne_admin1
WHERE iso_3166_2 IS NULL OR trim(iso_3166_2) = '' OR trim(iso_3166_2) = '-99'
ON CONFLICT (code) DO NOTHING;

SELECT level, count(*) FROM regions GROUP BY level ORDER BY level;
SQL

echo "==> ST_Covers check (Lagos ≈ 6.5244N, 3.3792E → NG-LA or NG)"
psql_db <<'SQL'
SELECT code, level, name
FROM regions
WHERE ST_Covers(
  geom,
  ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography
)
ORDER BY CASE level WHEN 'subdivision' THEN 0 ELSE 1 END, code
LIMIT 5;
SQL

echo "==> Seed regions done"
