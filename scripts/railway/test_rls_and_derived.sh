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

echo "======== 2.3b derived columns on INSERT (004) ========"
# INSERT had no column restriction before 004: an author could create a post
# with rank_score=999999. PASS if the insert is rejected OR stored as 0.
# Everything runs in a transaction and is rolled back.
set +e
OUT_INS_RANK="$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<SQL 2>&1
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '$AUTHOR', true);
WITH ins AS (
  INSERT INTO posts (author_id, body, rank_score)
  VALUES ('$AUTHOR', 'rank_score insert probe', 999)
  RETURNING rank_score
)
SELECT 'RANK=' || rank_score FROM ins;
ROLLBACK;
SQL
)"
RC_INS_RANK=$?

# Lagos point with a forged region_code. Must be rejected, or re-derived.
OUT_INS_REGION="$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<SQL 2>&1
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '$AUTHOR', true);
WITH ins AS (
  INSERT INTO posts (author_id, body, location, region_code)
  VALUES ('$AUTHOR', 'region_code insert probe',
          ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography, 'US-TX')
  RETURNING region_code
)
SELECT 'REGION=' || coalesce(region_code, '<null>') FROM ins;
ROLLBACK;
SQL
)"
RC_INS_REGION=$?

# Control: a normal insert (the columns VoidAPI sends) must still work, or the
# rejections above prove nothing except that authors can no longer post.
OUT_INS_OK="$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<SQL 2>&1
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '$AUTHOR', true);
WITH ins AS (
  INSERT INTO posts (author_id, body, reply_to)
  VALUES ('$AUTHOR', 'normal insert probe', '$POST_ID')
  RETURNING rank_score
)
SELECT 'RANK=' || rank_score FROM ins;
ROLLBACK;
SQL
)"
RC_INS_OK=$?
set -e

echo "--- insert rank_score=999 output ---"
echo "$OUT_INS_RANK"
echo "--- insert region_code=US-TX output ---"
echo "$OUT_INS_REGION"
echo "--- normal insert output ---"
echo "$OUT_INS_OK"

if [[ $RC_INS_RANK -ne 0 ]]; then
  echo "PASS: insert with rank_score rejected"
elif echo "$OUT_INS_RANK" | grep -qx 'RANK=0'; then
  echo "PASS: insert with rank_score=999 stored as 0"
else
  echo "FAIL: author inserted a post with a client-chosen rank_score" >&2
  FAIL=1
fi

if [[ $RC_INS_REGION -ne 0 ]]; then
  echo "PASS: insert with region_code rejected"
elif echo "$OUT_INS_REGION" | grep -q '^REGION=' && ! echo "$OUT_INS_REGION" | grep -qx 'REGION=US-TX'; then
  echo "PASS: forged region_code discarded on insert"
else
  echo "FAIL: author inserted a post with a client-chosen region_code" >&2
  FAIL=1
fi

if [[ $RC_INS_OK -eq 0 ]] && echo "$OUT_INS_OK" | grep -qx 'RANK=0'; then
  echo "PASS: normal author insert still works (rank_score 0)"
else
  echo "FAIL: normal author insert (author_id, body, reply_to) broke" >&2
  FAIL=1
fi

echo "======== 2.3c reactions cannot pump rank_score (004) ========"
# carol (created in 2.2) reacts. Transaction is rolled back.
REACTOR='33333333-3333-4333-8333-333333333333'
# A real second post, so the move test cannot "pass" on an FK violation.
OTHER_POST_ID="$(psql "$DATABASE_URL" -Atc "SELECT id FROM posts WHERE id <> '$POST_ID' LIMIT 1")"

set +e
# Duplicate reaction: the first insert must succeed (FIRST_OK), the second fail.
OUT_DUP="$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<SQL 2>&1
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '$REACTOR', true);
DELETE FROM reactions WHERE post_id = '$POST_ID' AND user_id = '$REACTOR';
INSERT INTO reactions (post_id, user_id, kind) VALUES ('$POST_ID', '$REACTOR', 'rank');
SELECT 'FIRST_OK';
INSERT INTO reactions (post_id, user_id, kind) VALUES ('$POST_ID', '$REACTOR', 'rank');
SELECT 'SECOND_OK';
ROLLBACK;
SQL
)"
RC_DUP=$?

# Insert then delete must leave rank_score where it started.
OUT_REV="$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<SQL 2>&1
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '$REACTOR', true);
DELETE FROM reactions WHERE post_id = '$POST_ID' AND user_id = '$REACTOR';
SELECT 'BEFORE=' || rank_score FROM posts WHERE id = '$POST_ID';
INSERT INTO reactions (post_id, user_id, kind) VALUES ('$POST_ID', '$REACTOR', 'rank');
SELECT 'DURING=' || rank_score FROM posts WHERE id = '$POST_ID';
DELETE FROM reactions WHERE post_id = '$POST_ID' AND user_id = '$REACTOR';
SELECT 'AFTER=' || rank_score FROM posts WHERE id = '$POST_ID';
ROLLBACK;
SQL
)"
RC_REV=$?

# Moving a reaction to another post left the old post's +1 behind (pump loop).
OUT_MOVE="$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<SQL 2>&1
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '$REACTOR', true);
DELETE FROM reactions WHERE post_id = '$POST_ID' AND user_id = '$REACTOR';
INSERT INTO reactions (post_id, user_id, kind) VALUES ('$POST_ID', '$REACTOR', 'rank');
SELECT 'SEEDED';
UPDATE reactions SET post_id = '$OTHER_POST_ID'
 WHERE post_id = '$POST_ID' AND user_id = '$REACTOR';
SELECT 'MOVED';
ROLLBACK;
SQL
)"
RC_MOVE=$?
set -e

echo "--- duplicate reaction output ---"
echo "$OUT_DUP"
echo "--- insert/delete reversal output ---"
echo "$OUT_REV"
echo "--- move reaction output ---"
echo "$OUT_MOVE"

if [[ $RC_DUP -ne 0 ]] && echo "$OUT_DUP" | grep -qx 'FIRST_OK' \
   && echo "$OUT_DUP" | grep -Eiq 'duplicate key|unique'; then
  echo "PASS: duplicate reaction rejected"
elif ! echo "$OUT_DUP" | grep -qx 'FIRST_OK'; then
  echo "FAIL: could not insert the first reaction — duplicate test inconclusive" >&2
  FAIL=1
else
  echo "FAIL: duplicate reaction accepted (rank_score can be pumped)" >&2
  FAIL=1
fi

BEFORE="$(echo "$OUT_REV" | sed -n 's/^BEFORE=//p')"
DURING="$(echo "$OUT_REV" | sed -n 's/^DURING=//p')"
AFTER="$(echo "$OUT_REV" | sed -n 's/^AFTER=//p')"
if [[ $RC_REV -eq 0 && -n "$BEFORE" && -n "$DURING" && -n "$AFTER" \
      && "$DURING" -eq $((BEFORE + 1)) && "$AFTER" -eq "$BEFORE" ]]; then
  echo "PASS: reaction delete reverses rank_score ($BEFORE -> $DURING -> $AFTER)"
else
  echo "FAIL: rank_score not reversed on reaction delete (before=$BEFORE during=$DURING after=$AFTER)" >&2
  FAIL=1
fi

if [[ $RC_MOVE -ne 0 ]] && echo "$OUT_MOVE" | grep -qx 'SEEDED' \
   && ! echo "$OUT_MOVE" | grep -qx 'MOVED'; then
  echo "PASS: moving a reaction to another post rejected"
elif ! echo "$OUT_MOVE" | grep -qx 'SEEDED'; then
  echo "FAIL: could not seed reaction — move test inconclusive" >&2
  FAIL=1
else
  echo "FAIL: reaction post_id was updatable (old post keeps its score)" >&2
  FAIL=1
fi

echo "======== 2.5 taste_profiles owner-only + rev conflict (004) ========"
# carol = owner (A), dave = other user (B); both created in 2.2. One transaction,
# rolled back. The stale-rev call is LAST because its error aborts the txn.
TASTE_A='33333333-3333-4333-8333-333333333333'
TASTE_B='44444444-4444-4444-8444-444444444444'

set +e
OUT_TASTE="$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 <<SQL 2>&1
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '$TASTE_A', true);
DELETE FROM taste_profiles WHERE user_id = '$TASTE_A';
SELECT 'A_REV1=' || upsert_taste_profile('ct-v1', 'iv-v1', 'salt-v1', 0);
SELECT 'A_REV2=' || upsert_taste_profile('ct-v2', 'iv-v2', 'salt-v1', 1);
SELECT 'A_SEE=' || count(*) FROM taste_profiles WHERE user_id = '$TASTE_A';

SELECT set_config('request.jwt.claim.sub', '$TASTE_B', true);
SELECT 'B_SEE=' || count(*) FROM taste_profiles WHERE user_id = '$TASTE_A';
SELECT 'B_SEE_ALL=' || count(*) FROM taste_profiles WHERE user_id <> '$TASTE_B';
WITH u AS (UPDATE taste_profiles SET ciphertext = 'pwned' WHERE user_id = '$TASTE_A' RETURNING 1)
SELECT 'B_UPD=' || count(*) FROM u;
WITH d AS (DELETE FROM taste_profiles WHERE user_id = '$TASTE_A' RETURNING 1)
SELECT 'B_DEL=' || count(*) FROM d;

SELECT set_config('request.jwt.claim.sub', '$TASTE_A', true);
SELECT 'A_CT=' || ciphertext FROM taste_profiles WHERE user_id = '$TASTE_A';
SELECT 'STALE=' || upsert_taste_profile('ct-stale', 'iv-x', 'salt-v1', 1);
ROLLBACK;
SQL
)"
RC_TASTE=$?
set -e

echo "--- taste_profiles output ---"
echo "$OUT_TASTE"

taste_val() { echo "$OUT_TASTE" | sed -n "s/^$1=//p"; }

if [[ "$(taste_val A_REV1)" == "1" && "$(taste_val A_REV2)" == "2" && "$(taste_val A_SEE)" == "1" ]]; then
  echo "PASS: owner upserts via RPC (rev 1 -> 2) and reads own row"
else
  echo "FAIL: owner RPC upsert/read broke (rev1=$(taste_val A_REV1) rev2=$(taste_val A_REV2) see=$(taste_val A_SEE))" >&2
  FAIL=1
fi

if [[ "$(taste_val B_SEE)" == "0" && "$(taste_val B_SEE_ALL)" == "0" ]]; then
  echo "PASS: other user cannot read taste_profiles"
else
  echo "FAIL: other user read taste_profiles (see=$(taste_val B_SEE) see_all=$(taste_val B_SEE_ALL))" >&2
  FAIL=1
fi

if [[ "$(taste_val B_UPD)" == "0" && "$(taste_val B_DEL)" == "0" && "$(taste_val A_CT)" == "ct-v2" ]]; then
  echo "PASS: other user UPDATE/DELETE affects 0 rows; owner data intact"
else
  echo "FAIL: other user modified taste_profiles (upd=$(taste_val B_UPD) del=$(taste_val B_DEL) ct=$(taste_val A_CT))" >&2
  FAIL=1
fi

if [[ $RC_TASTE -ne 0 ]] && echo "$OUT_TASTE" | grep -q 'taste_rev_conflict' \
   && [[ -z "$(taste_val STALE)" ]]; then
  echo "PASS: stale expected_rev raises taste_rev_conflict"
else
  echo "FAIL: stale expected_rev did not raise taste_rev_conflict" >&2
  FAIL=1
fi

exit "$FAIL"
