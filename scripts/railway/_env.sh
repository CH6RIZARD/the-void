#!/usr/bin/env bash
# Shared env loader for Railway scripts. Sourced by other scripts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "$ROOT/.env"
  set +a
fi

require_database_url() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "ERROR: DATABASE_URL is not set." >&2
    echo "Copy .env.example → .env and paste the Railway Postgres URL." >&2
    exit 1
  fi
}

psql_db() {
  require_database_url
  # ON_ERROR_STOP so migration failures are not silent
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 "$@"
}
