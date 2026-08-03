#!/usr/bin/env bash
# Cursor #3 — apply Void migrations to Railway Postgres (strict order).
# Replaces: supabase start + supabase db reset
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_env.sh"
require_database_url

# CLAUDE FIX: 000 must run first on Railway. 001 was written against Supabase and
# references auth.users (profiles FK), auth.uid() x24 and the anon/authenticated/
# service_role roles x31 - none exist on a bare Postgres, so the FIRST statement of
# 001 fails and nothing after it runs. 000 is idempotent: harmless on real Supabase.
# 000 is Railway-only (roles + auth.uid shim). Parked out of supabase/migrations
# so `supabase db push` never applies it to a real Supabase project.
M0="$ROOT/supabase/railway-only/000_supabase_compat.sql"
M1="$ROOT/supabase/migrations/001_void_schema.sql"
M2="$ROOT/supabase/migrations/002_contention_split.sql"
M3="$ROOT/supabase/migrations/003_regions_seed.sql"

for f in "$M0" "$M1" "$M2"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing migration: $f" >&2
    exit 1
  fi
done

echo "==> Enabling required extensions (idempotent)"
psql_db <<'SQL'
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
SQL

echo "==> Applying 000_supabase_compat.sql (roles + auth shim)"
psql_db -f "$M0"

echo "==> Applying 001_void_schema.sql"
psql_db -f "$M1"

echo "==> Applying 002_contention_split.sql"
psql_db -f "$M2"

if [[ -f "$M3" ]]; then
  echo "==> Applying 003_regions_seed.sql"
  psql_db -f "$M3"
fi

echo "==> Migrations applied OK"
"$SCRIPT_DIR/verify-schema.sh"
