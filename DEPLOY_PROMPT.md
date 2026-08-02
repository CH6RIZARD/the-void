# DEPLOY_PROMPT — Railway void-proxy (for Cursor)

**Author of plan: Claude** (Windows agent). **Executor: Cursor** when `RAILWAY_TOKEN` or `RAILWAY_API_TOKEN` is available.

Cloud agent: `bc-5431bcce-e706-4ebe-abd2-2c4c40f4f027`  
Branch: `cursor/railway-instead-of-docker-f027`  
PR: https://github.com/CH6RIZARD/the-void/pull/2

---

## Why not `railway login`

| Method | Failure mode |
|---|---|
| `railway login` | Needs a browser |
| `railway login --browserless` | `Cannot login in non-interactive mode` — no stdin on agent shells |
| `RAILWAY_TOKEN` / `RAILWAY_API_TOKEN` | Works non-interactively. CLI returns a proper “check that your token is valid” when unset/wrong — not a refuse-to-try |

This is not a capability limit. Both login flows want a human at a terminal. **Token auth has no such requirement.**

### How the human provides the token

1. Railway dashboard → Account Settings → Tokens → create token  
2. Put it in the Cursor cloud agent env / secrets as **either**:
   - `RAILWAY_TOKEN=...`  
   - or `RAILWAY_API_TOKEN=...`  
3. Do **not** commit the token. `.env` is gitignored; prefer platform secrets.

---

## Preconditions (must exist in the working tree)

These live on the full Windows Void tree; they are **not** on sparse GitHub `main` until Claude/Cursor push them:

- `build.js` — regenerates all builds + `void-proxy/public/`
- `void-proxy/` — Railway service root
- `app.json` (or `void-app/app.json`) — receives `voidHtmlUrl` + `voidProxyBase`
- test suite that reports **81/81**
- `build.js --check` clean target

If any of the above are missing on the agent checkout: **STOP** and say exactly which paths are missing. Do not invent `void-proxy`.

---

## Execute (strict order) — the moment the token is present

```bash
# 0) Auth (non-interactive)
export PATH="$HOME/.local/bin:$PATH"
# Prefer platform secret; fall back to .env (never commit)
if [[ -f .env ]]; then set -a; source .env; set +a; fi
: "${RAILWAY_TOKEN:=${RAILWAY_API_TOKEN:-}}"
if [[ -z "${RAILWAY_TOKEN:-}" && -z "${RAILWAY_API_TOKEN:-}" ]]; then
  echo "ERROR: set RAILWAY_TOKEN or RAILWAY_API_TOKEN"; exit 1
fi
railway whoami

# 1) Regenerate builds + void-proxy/public/
node build.js

# 2) Deploy service with root void-proxy/
#    If project not linked yet:
railway init   # only if no existing project link; do not recreate blindly
railway up --service void-proxy
#    Ensure railway.toml / service root = void-proxy/

# 3) HTTPS domain
railway domain

# 4) Health — read back real URLs the service reports
curl -sS "$(railway domain 2>/dev/null | head -1 | sed 's|/$||')/health" || \
  curl -sS "$VOID_PROXY_URL/health"
# Expect JSON/text that includes the canonical public URLs

# 5) Write URLs into app.json (no secrets)
#    voidHtmlUrl  = HTTPS origin serving the Void HTML builds
#    voidProxyBase = HTTPS origin of void-proxy (same host if co-served)
#    Use jq or a small node one-liner; do not hardcode stale domains

# 6) Verify
#    - both UIs served
#    - correct builds (native / web)
#    - Cache-Control: no-store (or equivalent) on HTML/API where required
#    - GET /feed returns items
#    - 81/81 tests pass
#    - node build.js --check  → clean
```

Helper (once tree is present): `./scripts/railway/deploy-void-proxy.sh`

---

## Out of scope this pass — flag, do not silently skip

- `eas init` for the placeholder Expo project ID needs `eas login` (same interactive/browser constraint as Railway login).  
  When blocked, write exactly:
  ```text
  BLOCKED: eas login requires interactive browser/stdin — needs EXPO_TOKEN or human eas login
  ```
  Do not fake a project ID.

---

## Commit rules after a successful deploy

1. Commit **non-secret** wiring only (`app.json` URLs, railway service config without tokens, `DEPLOY_PROMPT.md`, `CURSOR_CHANGES.md`).
2. Never commit `.env`, `RAILWAY_TOKEN`, `RAILWAY_API_TOKEN`, `DATABASE_URL`, `service_role`.
3. Append results under **Cursor change #4** in `CURSOR_CHANGES.md`: domain, `/health` body (redact secrets), test counts, any diffs.
4. Push to `cursor/railway-instead-of-docker-f027` and update PR #2.

---

## Cursor status log

| Check | Result |
|---|---|
| `RAILWAY_TOKEN` / `RAILWAY_API_TOKEN` in cloud env | **unset** (as of Cursor writing this file) |
| `build.js` on GitHub branch | **missing** |
| `void-proxy/` on GitHub branch | **missing** |
| Interactive `railway login` | unusable in agent (browser / non-interactive) |

**Next human action:** add Railway token to agent secrets **and** push/sync `build.js` + `void-proxy/` onto this branch. Then re-run this prompt / `deploy-void-proxy.sh`.
