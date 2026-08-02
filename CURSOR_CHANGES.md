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
