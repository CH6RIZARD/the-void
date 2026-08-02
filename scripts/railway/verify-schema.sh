#!/usr/bin/env bash
# List tables / key functions / RLS flags after migrate.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_env.sh"
require_database_url

echo "==> Tables (public)"
psql_db -c "
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
"

echo "==> RLS enabled?"
psql_db -c "
SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
"

echo "==> Key functions"
psql_db -c "
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'claim_prekey_bundle',
    'posts_in_bbox'
  )
ORDER BY p.proname;
"
