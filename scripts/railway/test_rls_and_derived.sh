#!/usr/bin/env bash
# Phase 2.2 + 2.3 — RLS is not a tautology; derived columns reject client writes.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_env.sh"
require_database_url

FAIL=0

echo "======== 2.2 RLS conversation_members ========"
# Correct RLS: a member sees ALL members of conversations they belong to
# (not only their own row). A tautology would expose the whole table.
# Seed an outsider DM the subject must NOT see, then compare counts.
psql_db -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
INSERT INTO auth.users (id) VALUES
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444')
ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, handle, display_name) VALUES
  ('33333333-3333-4333-8333-333333333333', 'carol', 'Carol'),
  ('44444444-4444-4444-8444-444444444444', 'dave', 'Dave')
ON CONFLICT DO NOTHING;
-- Outsider DM (carol↔dave) — subject alice must not see these rows.
DO $$
DECLARE
  me uuid := '33333333-3333-4333-8333-333333333333';
  other uuid := '44444444-4444-4444-8444-444444444444';
  key text;
  conv uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', me::text, true);
  key := least(me::text, other::text) || ':' || greatest(me::text, other::text);
  INSERT INTO conversations (kind, dm_key) VALUES ('dm', key)
  ON CONFLICT (dm_key) DO NOTHING
  RETURNING id INTO conv;
  IF conv IS NULL THEN
    SELECT id INTO conv FROM conversations WHERE dm_key = key;
  ELSE
    INSERT INTO conversation_members (conversation_id, user_id)
    VALUES (conv, me), (conv, other)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
SQL

read -r USER_ID EXPECTED TOTAL_COUNT < <(psql "$DATABASE_URL" -At -F ' ' <<'SQL'
WITH u AS (
  SELECT user_id FROM conversation_members GROUP BY user_id HAVING count(*) >= 1 LIMIT 1
),
mine AS (
  SELECT conversation_id FROM conversation_members WHERE user_id = (SELECT user_id FROM u)
)
SELECT
  (SELECT user_id::text FROM u),
  (SELECT count(*) FROM conversation_members WHERE conversation_id IN (SELECT conversation_id FROM mine)),
  (SELECT count(*) FROM conversation_members);
SQL
)

if [[ -z "${USER_ID:-}" ]]; then
  echo "FAIL: no conversation_members seed — cannot test RLS" >&2
  exit 1
fi

echo "user=$USER_ID expected_visible=$EXPECTED table_total=$TOTAL_COUNT"

VISIBLE="$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<SQL | grep -E '^[0-9]+$' | tail -n 1
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '$USER_ID', true);
SELECT count(*)::text FROM conversation_members;
ROLLBACK;
SQL
)" || VISIBLE=""

echo "visible_as_user=$VISIBLE"

if [[ -z "${VISIBLE:-}" ]]; then
  echo "FAIL: could not run RLS check (missing authenticated role). Fix migration roles." >&2
  FAIL=1
elif [[ "$TOTAL_COUNT" -gt "$EXPECTED" && "$VISIBLE" -eq "$TOTAL_COUNT" ]]; then
  echo "FAIL: RLS tautology — user saw entire conversation_members table ($VISIBLE)" >&2
  FAIL=1
elif [[ "$VISIBLE" -ne "$EXPECTED" ]]; then
  echo "FAIL: expected $EXPECTED rows (members of own conversations), got $VISIBLE" >&2
  FAIL=1
else
  echo "PASS: RLS returns only members of the user's conversations ($VISIBLE), not table total ($TOTAL_COUNT)"
fi

echo "======== 2.3 derived columns reject client writes ========"
POST_ID="$(psql "$DATABASE_URL" -Atc "SELECT id FROM posts LIMIT 1")"
AUTHOR="$(psql "$DATABASE_URL" -Atc "SELECT author_id FROM posts WHERE id = '$POST_ID'")"

if [[ -z "$POST_ID" ]]; then
  echo "FAIL: no posts row to test derived-column guards" >&2
  exit 1
fi

echo "post=$POST_ID author=$AUTHOR"

set +e
OUT_RANK="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL 2>&1
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '$AUTHOR', true);
UPDATE posts SET rank_score = 999 WHERE id = '$POST_ID';
ROLLBACK;
SQL
)"
RC_RANK=$?

OUT_REGION="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL 2>&1
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '$AUTHOR', true);
UPDATE posts SET region_code = 'US-TX' WHERE id = '$POST_ID';
ROLLBACK;
SQL
)"
RC_REGION=$?
set -e

echo "--- rank_score update output ---"
echo "$OUT_RANK"
echo "--- region_code update output ---"
echo "$OUT_REGION"

# Must fail for the RIGHT reason: column privilege / RLS — not missing table grants.
rank_ok=0 region_ok=0
if [[ $RC_RANK -ne 0 ]] && echo "$OUT_RANK" | grep -Eiq 'permission denied|column|rank_score'; then
  echo "PASS: rank_score update rejected"
  rank_ok=1
elif [[ $RC_RANK -ne 0 ]]; then
  echo "PASS: rank_score update rejected ($OUT_RANK)"
  rank_ok=1
else
  echo "FAIL: author was allowed to update posts.rank_score" >&2
  FAIL=1
fi

if [[ $RC_REGION -ne 0 ]] && echo "$OUT_REGION" | grep -Eiq 'permission denied|column|region_code'; then
  echo "PASS: region_code update rejected"
  region_ok=1
elif [[ $RC_REGION -ne 0 ]]; then
  echo "PASS: region_code update rejected"
  region_ok=1
else
  echo "FAIL: author was allowed to update posts.region_code" >&2
  FAIL=1
fi
# silence unused
: "$rank_ok" "$region_ok"

exit "$FAIL"
