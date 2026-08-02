#!/usr/bin/env bash
# Smoke-check Railway DATABASE_URL before migrations.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_env.sh"
require_database_url

echo "==> psql version"
psql --version

echo "==> SELECT version()"
psql_db -c "SELECT version();"

echo "==> PostGIS?"
psql_db -c "SELECT default_version, installed_version FROM pg_available_extensions WHERE name='postgis';"

echo "PASS: DATABASE_URL accepts connections"
