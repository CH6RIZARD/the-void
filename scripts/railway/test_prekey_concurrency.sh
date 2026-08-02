#!/usr/bin/env bash
# Phase 2.1 — two concurrent claim_prekey_bundle() calls must return
# DIFFERENT, NON-NULL otpk_id values. Exit non-zero on null or duplicate.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_env.sh"
require_database_url

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Seed a throwaway user + two unused OTPKs if the helper seed RPC is absent.
# Adjust table/column names only if migrations differ — fix migrations, not this.
psql_db -v ON_ERROR_STOP=1 <<'SQL' >"$TMP/seed.txt"
DO $$
DECLARE
  uid uuid := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
BEGIN
  -- Best-effort seed; schema from 001. If this fails, print and abort.
  INSERT INTO auth_users_stub(id) VALUES (uid)
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN undefined_table THEN
  -- Prefer real auth.users if present (Supabase-shaped)
  NULL;
END $$;

-- Prefer profiles / users table that claim_prekey_bundle expects.
-- Insert two one-time prekeys for a known user id.
DO $$
DECLARE
  uid uuid;
BEGIN
  SELECT id INTO uid FROM profiles LIMIT 1;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'No profiles row to claim against — seed a user first';
  END IF;
  PERFORM set_config('void.test_uid', uid::text, false);
END $$;
SQL

UID="$(psql "$DATABASE_URL" -Atc "SELECT id FROM profiles LIMIT 1")"
if [[ -z "$UID" ]]; then
  echo "FAIL: no profiles row; cannot test claim_prekey_bundle concurrency" >&2
  exit 1
fi

echo "Using user id: $UID"

# Ensure at least 2 unused OTPKs exist for this user (table name from Void schema).
psql_db -v ON_ERROR_STOP=1 <<SQL
INSERT INTO one_time_prekeys (user_id, key_material, consumed_at)
SELECT '$UID'::uuid, gen_random_bytes(32), NULL
FROM generate_series(1, 2)
WHERE (
  SELECT count(*) FROM one_time_prekeys
  WHERE user_id = '$UID'::uuid AND consumed_at IS NULL
) < 2;
SQL

# Session A: claim inside an open transaction, hold advisory lock style via sleep in txn
# Use two psql processes + a lock table coordination.

cat >"$TMP/session_a.sql" <<SQL
BEGIN;
SELECT otpk_id FROM claim_prekey_bundle('$UID'::uuid);
SELECT pg_sleep(3);
COMMIT;
SQL

cat >"$TMP/session_b.sql" <<SQL
SELECT pg_sleep(0.5);
SELECT otpk_id FROM claim_prekey_bundle('$UID'::uuid);
SQL

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -F ',' -f "$TMP/session_a.sql" >"$TMP/a.out" 2>"$TMP/a.err" &
PID_A=$!
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -F ',' -f "$TMP/session_b.sql" >"$TMP/b.out" 2>"$TMP/b.err" &
PID_B=$!

wait "$PID_A" || { echo "FAIL: session A errored"; cat "$TMP/a.err"; exit 1; }
wait "$PID_B" || { echo "FAIL: session B errored"; cat "$TMP/b.err"; exit 1; }

# First non-empty line that looks like a uuid/int id
A_ID="$(grep -E '^[0-9a-fA-F-]+$|^[0-9]+$' "$TMP/a.out" | head -1 || true)"
B_ID="$(grep -E '^[0-9a-fA-F-]+$|^[0-9]+$' "$TMP/b.out" | head -1 || true)"

echo "session A otpk_id: ${A_ID:-NULL}"
echo "session B otpk_id: ${B_ID:-NULL}"
cat "$TMP/a.out" "$TMP/b.out"

if [[ -z "$A_ID" || -z "$B_ID" || "$A_ID" == "null" || "$B_ID" == "null" ]]; then
  echo "FAIL: null otpk_id — X3DH would degrade to signed prekey (no forward secrecy)" >&2
  exit 1
fi

if [[ "$A_ID" == "$B_ID" ]]; then
  echo "FAIL: duplicate otpk_id under concurrency" >&2
  exit 1
fi

echo "PASS: prekey concurrency — distinct non-null otpk_ids"
