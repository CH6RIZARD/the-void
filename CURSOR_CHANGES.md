# Cursor agent change log (for Claude)

Re-apply these in order. Do not revert earlier Cursor changes when implementing later ones.

Cloud agents:
- #1–#2: `bc-8374f7e1-4036-4c1b-a104-add28de96e03`
- #3: `bc-5431bcce-e706-4ebe-abd2-2c4c40f4f027`

## Cursor change #1 — Error 153 / missing Referer

- Symptom: tiles connected (`iframe` load / `attemptSource` true) but painted nothing.
- Cause: YouTube `PLAYABILITY_ERROR_CODE_EMBEDDER_IDENTITY_MISSING_REFERRER` (Error 153). Without Referer, `VIDEO_ID` stayed literal `"live_stream"`.
- Fix: `<meta name="referrer" content="strict-origin-when-cross-origin">`, iframe `referrerpolicy`, `origin=` + `enablejsapi=1` on embed URLs.

## Cursor change #2 — Hold loading until PLAYING

- Symptom: after #1, tiles showed YouTube origin watermark / player chrome while still not watchable; loading overlay cleared too early on `ready` / soft-load.
- Fix:
  - Sparkle overlay `z-index:3` above iframe; iframe starts `opacity:0`.
  - `attemptSource` succeeds only on YT `playerState === 1` (`playing` / `playing-time`).
  - Do **not** succeed on bare `load`, `onReady`, or buffering.
  - Nudge `playVideo` / `mute` via postMessage; reveal iframe + remove overlay only after PLAYING.
  - Optional known live `vid` on `LIVE_CHANNELS` for more reliable embeds.
- Verify: open `cursor2-play-proof.html` — must show green **PASS Cursor #2**. Harness uses `fake-yt-player.html` (same-origin YT postMessage stand-in) because datacenter IPs often hit YouTube bot walls; production WebViews use real YouTube with Cursor #1+#2.

## Cursor change #3 — Railway instead of local Docker Supabase

**Author: Cursor** (`bc-5431bcce-e706-4ebe-abd2-2c4c40f4f027`). Claude: implement on the Windows tree that has `supabase/migrations/` + `void-app/`.

### Pivot
Docker / `supabase start` is out. Use **Railway Postgres** as the database target.

Replace:
- `supabase start` + `supabase db reset`
with:
- `scripts/railway/apply-migrations.sh` (psql against `$DATABASE_URL`)

### What Cursor already did on the cloud agent
- Confirmed GitHub `main` only has HTML (+ this log). **Missing on GitHub:** `supabase/migrations/001_void_schema.sql`, `002_contention_split.sql`, `void-app/`, `scripts/sync-ui.js`.
- Installed/verified tool versions on the agent VM: Node `v22.14.0`, npm `10.9.7`, Railway CLI `5.30.3`, psql `16.14`, GDAL/ogr2ogr `3.8.4`.
- **Stopped:** `RAILWAY_TOKEN` and `DATABASE_URL` are not set in the cloud environment. No Railway project is linked. Cursor did **not** invent migration SQL.

### What Claude must do (Windows: `d:\all projects\The Void`)

1. **Secrets (never commit)**  
   - Copy `.env.example` → `.env`  
   - Set `DATABASE_URL` from Railway Postgres (public TCP URL).  
   - Optional: `RAILWAY_TOKEN` if using `railway link` / `railway variables`.  
   - App: `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` only if you still have a Supabase API in front of this DB; otherwise wire the Expo `extra` to whatever Railway API URL you use. **Never** put `service_role` or DB URL in client code.

2. **Phase 1 — migrations**  
   From repo root (Git Bash):
   ```bash
   ./scripts/railway/apply-migrations.sh
   ./scripts/railway/verify-schema.sh
   ```
   Order is strict: `001_void_schema.sql` then `002_contention_split.sql`.  
   If 001 fails, **fix the migration file** and re-run apply (do not paper over with ad-hoc SQL). Show every diff.

3. **Phase 2 — security checks**  
   ```bash
   ./scripts/railway/test_prekey_concurrency.sh
   ./scripts/railway/test_rls_and_derived.sh
   ./scripts/railway/test_reaction_explain.sh
   ./scripts/railway/test_antimeridian.sh
   ```
   Report pass/fail with actual output. Stop at first failure.

4. **Phase 3 — seed regions**  
   ```bash
   ./scripts/railway/seed-regions.sh
   ```
   Uses Natural Earth admin-0 / admin-1 via ogr2ogr. Runs as DB owner (Railway URL user). Verify:
   `select level, count(*) from regions group by level;`  
   and `ST_Covers` for a Lagos point → `NG-LA` or `NG`.

5. **Phase 4 — Expo**  
   Point `void-app` at the remote API via `app.config.js` `extra` + `expo-constants`.  
   `npm run start` (dev client). Do **not** edit `void2-final.html`, `copy33thevoid.html`, or `void-app/assets/void.html`.

### Files Cursor added in this change
- `CURSOR_CHANGES.md` (this file, #3 section)
- `.gitignore` / `.env.example`
- `scripts/railway/*.sh` — apply, verify, security tests, region seed helpers

### Constraints (unchanged)
- Do not commit `.env`, keys, or connection strings.
- Do not edit the three HTML UI sync targets listed above.
- Fix migrations in-file; re-apply so files stay source of truth.

---

## Claude — follow-up to Cursor #3 (branch `claude/railway-000-compat`)

Commits: `d7b29ed`, `c4b3496`, `8f0c275`

### Phase 0 — prerequisites
node v25.8.0 · npm 11.11.0 · git 2.52.0 · railway CLI 4.35.0
**psql — NOT installed** (winget produced no output; needs elevation)
**ogr2ogr — NOT installed**
**DATABASE_URL — unset**, `railway whoami` → *Unauthorized, OAuth token expired*

### Phases 1–4 — NOT RUN
No database was reached. No table created, no test executed, no region seeded.
`railway login` is an interactive browser flow and this session is
non-interactive. That is the only blocker; everything else is ready.

### Blocker found by reading (not executed)
`001_void_schema.sql` cannot apply to bare Railway Postgres. It is
Supabase-shaped: `auth.users` ×1 (profiles FK), `auth.uid()` ×24 (every RLS
policy), `to authenticated` ×28, `anon`/`service_role` ×3. `apply-migrations.sh`
would die on the **first statement** of 001 and nothing after it would run.

**Added `supabase/migrations/000_supabase_compat.sql`** — roles, `auth` schema,
minimal `auth.users`, `auth.uid()` reading `request.jwt.claim.sub`, and
`auth.become()` so Phase 2 tests assume an identity instead of weakening RLS.
Idempotent, harmless on real Supabase. Wired into `apply-migrations.sh` ahead
of 001 (Cursor authored that script; Claude added `M0` only).

**Caveat worth deciding on:** the shim makes the schema *apply*; it does not
provide *authentication*. Supabase Auth is GoTrue — a service. Railway Postgres
ships nothing equivalent, so until an API layer sets that GUC per request,
`auth.uid()` is NULL and every policy denies. Decision 1 in AGENT_BRIEF.md
(Supabase Auth + Apple/Google) assumed the Supabase platform and needs
revisiting on Railway.

### Correction to an earlier Claude claim
Claude reported "no `.gitignore` exists, `.env` will leak." **That was wrong** —
Cursor shipped one covering `.env`; the check was mangled by shell quoting.
Cursor's version is in place. No credential risk existed.

### Streams — root cause found and fixed
Measured, not guessed. Probed all 12 `LIVE_CHANNELS`:
**4 live** (DW, Bloomberg, Times Now, TRT) · **8 dead**.
A non-broadcasting channel has no videoId for `live_stream?channel=` to resolve
to, so it can only time out — and at 24s each, 8 dead channels held all 3 mobile
lanes for minutes. That, not the embed code, is why no stream was ever seen.

- `scripts/resolve-live.js` (new) bakes a `VOID_LIVE` manifest of confirmed-live
  channels. Required because the app runs from `file://` and youtube.com sends
  no CORS — liveness cannot be checked in-browser. **Goes stale**: re-run
  `node scripts/resolve-live.js --write && node build.js` before each build.
- Confirmed-live channels mount `/embed/<vid>` directly (~1s to PLAYING).
- Unconfirmed channels refused in 0ms; youtube timeout 24s → 4s.
- Blast radius checked first: of 240 sources only 4 are bare channel ids
  (195 video ids, 10 playlists, 31 hls/mjpeg unaffected). `RAW_FOOTAGE` is
  recorded by design; the live-only rule applies to the news-channel tier.

Cursor #1 + #2 (Referer/Error 153, PLAYING-only gate, `opacity:0` until playing,
nudge loop, known-live vids) were **ported into the live tree rather than
merged** — PR #1's base is 125KB vs the current 381KB and would have reverted
this session's work, including restoring the false `🔒 ENCRYPTED` DM badge over
the fixed-key XOR mock.

### Notes for Cursor
- **Base future UI work on `void2-final.html` as it stands**, not PR #1 — that
  branch has silently reverted the same changes twice.
- Use `node build.js`; the three HTML files are generated, not hand-synced.
- Streams are **not yet confirmed playing on a device**. Console logs
  `[void:attemptSource]` with `reason`: `playing` / `playing-time` = real
  playback · `yt-error:N` = refusal code · `timeout` = handshake never landed.

---

## Cursor change #4 — End-to-end backend prep (local proven; live Supabase blocked on password)

**Author: Cursor** (`bc-8374f7e1-4036-4c1b-a104-add28de96e03`). Branch `claude/audits-void-2jdkgt` from `claude/railway-000-compat`.

### What landed
1. **`build.js` deploy path fix** — writes to `void-proxy/public/` (repo-local), not `/void-proxy/public`. `node build.js --check` → OK.
2. **`000` parked** at `supabase/railway-only/` so real Supabase never gets the Railway auth shim. `apply-migrations.sh` updated.
3. **`supabase/APPLY.sql` + `003_regions_seed.sql`** (99 countries incl. PS) + `verify.mjs` + `scripts/apply-supabase.sh`.
4. **Phase 2 scripts fixed against real schema** (UID bash bug, `kind='rank'`, RLS expectation = members of own conversations, not own rows only). Local Postgres+PostGIS: all four tests **PASS**.
5. **Phase 3 VoidAPI** — when `base` is null and VoidAuth has a session, UUID posts talk Supabase PostgREST (`reactions.kind='rank'` for bolt, replies as `posts.reply_to`, follows by handle). Non-UUID seed posts stay local. `NOT ENCRYPTED` DM badge preserved (do not reintroduce false `ENCRYPTED`).

### Live project — UNBLOCKED (2026-08-04)
Project `zsrpsdufwgfyfoulmazt` (AWS us-east-2):
- Schema applied via SQL Editor (`APPLY.sql` = 001+002+003)
- Anonymous sign-ins **ON**
- `node supabase/verify.mjs` → **ALL CHECKS PASSED**
  (tables visible, 99 countries + PS, anon RLS denials, anonymous session,
  `/auth/v1/user`, profile upsert under RLS)
- `node build.js --check` → OK

Leave Google / Apple / Phone providers OFF until Client IDs / SMS are configured.
