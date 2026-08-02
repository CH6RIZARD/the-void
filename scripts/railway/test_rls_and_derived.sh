#!/usr/bin/env bash
# Phase 2.2 + 2.3 — RLS is not a tautology; derived columns reject client writes.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_env.sh"
require_database_url

FAIL=0

echo "======== 2.2 RLS conversation_members ========"
# Pick a user who belongs to ≥1 conversation. Simulate that JWT user via
# Supabase-style request.jwt.claim.sub when available; else SET ROLE + GUC.
read -r USER_ID MEMBER_COUNT TOTAL_COUNT < <(psql "$DATABASE_URL" -At -F ' ' <<'SQL'
WITH u AS (
  SELECT user_id FROM conversation_members GROUP BY user_id HAVING count(*) >= 1 LIMIT 1
)
SELECT
  u.user_id::text,
  (SELECT count(*) FROM conversation_members cm WHERE cm.user_id = u.user_id),
  (SELECT count(*) FROM conversation_members)
FROM u;
SQL
)

if [[ -z "${USER_ID:-}" ]]; then
  echo "FAIL: no conversation_members seed — cannot test RLS" >&2
  exit 1
fi

echo "user=$USER_ID own_rows=$MEMBER_COUNT table_total=$TOTAL_COUNT"

VISIBLE="$(psql "$DATABASE_URL" -At <<SQL
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '$USER_ID', true);
SELECT count(*) FROM conversation_members;
ROLLBACK;
SQL
)" || {
  # Plain Railway without Supabase roles: fall back to FORCE RLS + SET ROLE app user
  echo "NOTE: authenticated role / jwt GUC path failed; trying void_app role" >&2
  VISIBLE="$(psql "$DATABASE_URL" -At <<SQL
BEGIN;
SET LOCAL ROLE void_app;
SELECT set_config('app.user_id', '$USER_ID', true);
SELECT count(*) FROM conversation_members;
ROLLBACK;
SQL
)" || true
}

echo "visible_as_user=$VISIBLE"

if [[ -z "${VISIBLE:-}" ]]; then
  echo "FAIL: could not run RLS check (missing authenticated/void_app role). Fix migration roles." >&2
  FAIL=1
elif [[ "$VISIBLE" -eq "$TOTAL_COUNT" && "$TOTAL_COUNT" -gt "$MEMBER_COUNT" ]]; then
  echo "FAIL: RLS tautology — user saw entire conversation_members table ($VISIBLE)" >&2
  FAIL=1
elif [[ "$VISIBLE" -ne "$MEMBER_COUNT" ]]; then
  echo "FAIL: expected $MEMBER_COUNT rows, got $VISIBLE" >&2
  FAIL=1
else
  echo "PASS: RLS returns only the user's conversation_members rows"
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

if [[ $RC_RANK -eq 0 ]]; then
  echo "FAIL: author was allowed to update posts.rank_score" >&2
  FAIL=1
else
  echo "PASS: rank_score update rejected"
fi

if [[ $RC_REGION -eq 0 ]]; then
  echo "FAIL: author was allowed to update posts.region_code" >&2
  FAIL=1
else
  echo "PASS: region_code update rejected"
fi

exit "$FAIL"
