#!/usr/bin/env bash
# Phase 2.5 — posts_in_bbox across the antimeridian must not be trivially 0
# when posts exist near the date line.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_env.sh"
require_database_url

# Seed two posts near the date line if none exist (server role / DB owner).
psql_db <<'SQL'
DO $$
DECLARE
  uid uuid;
  n int;
BEGIN
  SELECT id INTO uid FROM profiles LIMIT 1;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Need a profiles row to seed antimeridian posts';
  END IF;

  SELECT count(*) INTO n FROM posts
  WHERE ST_X(location::geometry) > 170 OR ST_X(location::geometry) < -170;

  IF n = 0 THEN
    INSERT INTO posts (author_id, body, location)
    VALUES
      (uid, 'antimeridian east', ST_SetSRID(ST_MakePoint(179.5, 0), 4326)::geography),
      (uid, 'antimeridian west', ST_SetSRID(ST_MakePoint(-179.5, 0), 4326)::geography);
  END IF;
END $$;
SQL

NEAR="$(psql "$DATABASE_URL" -Atc "
SELECT count(*) FROM posts
WHERE ST_X(location::geometry) > 170 OR ST_X(location::geometry) < -170;
")"
echo "posts_near_dateline=$NEAR"

COUNT="$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM posts_in_bbox(170,-10,-170,10);")"
echo "posts_in_bbox(170,-10,-170,10)=$COUNT"

if [[ "$NEAR" -gt 0 && "$COUNT" -eq 0 ]]; then
  echo "FAIL: antimeridian bbox returned 0 despite near-dateline posts" >&2
  exit 1
fi

if [[ "$COUNT" -eq 0 ]]; then
  echo "FAIL: trivially 0 — check posts_in_bbox wrapping logic" >&2
  exit 1
fi

echo "PASS: antimeridian bbox returns $COUNT row(s)"
