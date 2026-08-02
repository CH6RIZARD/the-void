#!/usr/bin/env bash
# Cursor #3 — apply Void migrations to Railway Postgres (strict order).
# Replaces: supabase start + supabase db reset
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_env.sh"
require_database_url

M1="$ROOT/supabase/migrations/001_void_schema.sql"
M2="$ROOT/supabase/migrations/002_contention_split.sql"

for f in "$M1" "$M2"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing migration: $f" >&2
    echo "This file must exist on the Windows Void tree; it is not on GitHub main." >&2
    exit 1
  fi
done

echo "==> Enabling required extensions (idempotent)"
psql_db <<'SQL'
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
SQL

echo "==> Applying 001_void_schema.sql"
psql_db -f "$M1"

echo "==> Applying 002_contention_split.sql"
psql_db -f "$M2"

echo "==> Migrations applied OK"
"$SCRIPT_DIR/verify-schema.sh"
