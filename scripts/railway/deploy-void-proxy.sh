#!/usr/bin/env bash
# Cursor #4 — non-interactive Railway deploy for void-proxy/
# Auth: RAILWAY_TOKEN or RAILWAY_API_TOKEN (no railway login).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/_env.sh"

export PATH="${HOME}/.local/bin:${PATH}"

if [[ -z "${RAILWAY_TOKEN:-}" && -z "${RAILWAY_API_TOKEN:-}" ]]; then
  echo "ERROR: RAILWAY_TOKEN / RAILWAY_API_TOKEN unset." >&2
  echo "Agent shells cannot railway login (browser / non-interactive)." >&2
  echo "Add a Railway account token to the environment, then re-run." >&2
  exit 1
fi

# Normalize: CLI accepts either; ensure RAILWAY_TOKEN is populated when only API token set
if [[ -z "${RAILWAY_TOKEN:-}" && -n "${RAILWAY_API_TOKEN:-}" ]]; then
  export RAILWAY_TOKEN="$RAILWAY_API_TOKEN"
fi

command -v railway >/dev/null || {
  echo "ERROR: railway CLI not on PATH"; exit 1
}

echo "==> railway whoami"
railway whoami

for p in "$ROOT/build.js" "$ROOT/void-proxy"; do
  if [[ ! -e "$p" ]]; then
    echo "ERROR: missing required path: $p" >&2
    echo "Push/sync the full Void tree (build.js + void-proxy/) onto this branch." >&2
    exit 1
  fi
done

echo "==> node build.js"
(cd "$ROOT" && node build.js)

echo "==> railway up (service root void-proxy/)"
# Prefer existing link; init only when unlinked
if ! railway status >/dev/null 2>&1; then
  echo "No linked project — run: railway init (once) then re-run this script"
  echo "Or: railway link --project <id>"
  exit 1
fi

(cd "$ROOT/void-proxy" && railway up)

echo "==> railway domain"
railway domain || true

echo "==> /health"
# Discover domain from railway status/domain output when possible
DOMAIN="$(railway domain 2>/dev/null | grep -Eo 'https://[^ ]+' | head -1 || true)"
if [[ -z "$DOMAIN" ]]; then
  DOMAIN="${VOID_PROXY_URL:-}"
fi
if [[ -z "$DOMAIN" ]]; then
  echo "ERROR: could not resolve public domain; set VOID_PROXY_URL and re-check /health" >&2
  exit 1
fi

mkdir -p "$ROOT/scripts/railway/.cache"
HEALTH_URL="${DOMAIN%/}/health"
echo "GET $HEALTH_URL"
curl -sS -D "$ROOT/scripts/railway/.cache/health.headers" -o "$ROOT/scripts/railway/.cache/health.body" "$HEALTH_URL"
echo "--- body ---"
cat "$ROOT/scripts/railway/.cache/health.body"
echo
echo "--- headers (cache) ---"
grep -iE 'cache-control|content-type|HTTP/' "$ROOT/scripts/railway/.cache/health.headers" || true

echo "==> Deploy step finished. Next: wire voidHtmlUrl + voidProxyBase into app.json, run tests 81/81, build.js --check"
