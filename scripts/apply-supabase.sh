#!/usr/bin/env bash
# Apply Void schema to Supabase Postgres (direct / session pooler only).
# Usage:
#   DATABASE_URL='postgresql://postgres:PASSWORD@db.zsrpsdufwgfyfoulmazt.supabase.co:5432/postgres' \
#     ./scripts/apply-supabase.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${DATABASE_URL:?Set DATABASE_URL to the Supabase DIRECT (5432) or SESSION pooler URL}"
command -v psql >/dev/null || { echo "psql required"; exit 1; }
echo "==> extensions"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
create extension if not exists postgis;
create extension if not exists pgcrypto;
create extension if not exists citext;
SQL
echo "==> APPLY.sql (001+002+003)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/APPLY.sql"
echo "==> done — run: node supabase/verify.mjs"
