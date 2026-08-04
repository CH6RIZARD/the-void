#!/usr/bin/env bash
# Phase 2.4 — reaction insert must NOT touch ST_Covers / regions.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_env.sh"
require_database_url

POST_ID="$(psql "$DATABASE_URL" -Atc "SELECT id FROM posts LIMIT 1")"
USER_ID="$(psql "$DATABASE_URL" -Atc "SELECT id FROM profiles LIMIT 1")"

if [[ -z "$POST_ID" || -z "$USER_ID" ]]; then
  echo "FAIL: need at least one post and one profile for reaction explain" >&2
  exit 1
fi

COLS="$(psql "$DATABASE_URL" -Atc "
SELECT string_agg(column_name, ',')
FROM information_schema.columns
WHERE table_schema='public' AND table_name='reactions';
")"
echo "reactions columns: $COLS"

# Schema uses kind IN ('rank','slash') — never invent other values.
PLAN="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
EXPLAIN (ANALYZE, BUFFERS)
INSERT INTO reactions (post_id, user_id, kind)
VALUES ('$POST_ID'::uuid, '$USER_ID'::uuid, 'rank')
ON CONFLICT DO NOTHING;
SQL
)"

echo "$PLAN"

if echo "$PLAN" | grep -Eiq 'ST_Covers|Seq Scan on regions|Bitmap Heap Scan on regions'; then
  echo "FAIL: reaction insert plan touches ST_Covers or regions" >&2
  exit 1
fi

echo "PASS: reaction insert plan has no ST_Covers / regions scan"
