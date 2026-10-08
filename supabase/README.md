# Supabase (project **the void**, `zsrpsdufwgfyfoulmazt`)

Dashboard: https://supabase.com/dashboard/project/zsrpsdufwgfyfoulmazt

## Database password — you cannot “find” the old one

Supabase only shows the Postgres password **once**, at project creation.
It is not in GitHub, not in the anon key, and not recoverable from the dashboard.

**Reset it (takes ~10 seconds):**
1. Open [Database Settings](https://supabase.com/dashboard/project/zsrpsdufwgfyfoulmazt/database/settings)
2. **Database password** → **Reset database password**
3. Copy the new password somewhere safe
4. Paste it back to Cursor as:
   ```
   DATABASE_URL=postgresql://postgres:NEW_PASSWORD@db.zsrpsdufwgfyfoulmazt.supabase.co:5432/postgres
   ```
   (URL-encode special characters in the password: `@` → `%40`, `#` → `%23`, etc.)

## Apply schema — two ways

### A) No password: SQL Editor (easiest)

1. Open [SQL Editor](https://supabase.com/dashboard/project/zsrpsdufwgfyfoulmazt/sql/new)
2. Run extensions first:
   ```sql
   create extension if not exists postgis;
   create extension if not exists pgcrypto;
   create extension if not exists citext;
   ```
3. Paste the full contents of `supabase/APPLY.sql` and **Run**
4. Do **NOT** run `supabase/railway-only/000_supabase_compat.sql` on Supabase

### B) With password: psql from this repo

```bash
# Direct :5432 or SESSION pooler — not transaction pooler
export DATABASE_URL='postgresql://postgres:PASSWORD@db.zsrpsdufwgfyfoulmazt.supabase.co:5432/postgres'
./scripts/apply-supabase.sh
```

`APPLY.sql` = `001` + `002` + `003` (regions seed, includes **PS**).

## Auth dashboard (required for verify)

[Authentication → Providers](https://supabase.com/dashboard/project/zsrpsdufwgfyfoulmazt/auth/providers)
→ **Anonymous sign-ins** → **ON**

Live project currently returns `422 anonymous_provider_disabled`.

## Verify

```bash
node supabase/verify.mjs   # must print ALL CHECKS PASSED
node build.js --check
```

## Calls (LiveKit) — migration 009 + `livekit-token`

Media runs over LiveKit; Supabase holds only the ring (`calls` table, Realtime)
and mints the join token (`functions/livekit-token`). The LiveKit API key and
secret live in function secrets, never in the app.

### 1. Secrets (once)

Get `API Key`, `API Secret` and the `wss://` URL from LiveKit Cloud (or your
own `livekit-server`), then:

```bash
supabase secrets set LIVEKIT_API_KEY=APIxxxxxxxx LIVEKIT_API_SECRET=xxxxxxxx LIVEKIT_URL=wss://your-project.livekit.cloud
supabase secrets list   # all three must show
```

The function answers `500 server_not_configured` until all three exist.

### 2. Schema

```bash
supabase db push        # applies migrations/009_calls.sql (calls + RLS + Realtime)
```

or paste `migrations/009_calls.sql` into the SQL Editor. It is idempotent.
Afterwards Dashboard → Database → Publications → `supabase_realtime` must list
`calls`; the app's ring subscription depends on it.

### 3. Function

```bash
supabase functions deploy livekit-token      # WITH JWT verification (default) — callers must be signed in
```

Smoke test with a real session token:

```bash
curl -s -X POST "https://zsrpsdufwgfyfoulmazt.supabase.co/functions/v1/livekit-token" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
  -d '{"conversation_id":"<uuid of a DM you are in>"}'
# 200 {token,url,room:"dm_<uuid>",identity:<your uid>,expires_in:3600}; 403 for a thread you are not in
```

### Offline test (no network)

```bash
cd supabase/functions/livekit-token && npm install && npm test
```

Runs `mint.ts` (the exact module `index.ts` uses) against the real
`livekit-server-sdk` and verifies the JWT's room / identity / grants / ttl.

### Follow-ups (not in this pass)

Multi-device ring; CallKit/PushKit wakeup (`voip` background mode); Android
foreground service for background continuation; a pg_cron sweep that marks
`ringing` rows older than 45 s as `missed` when the caller's app died mid-ring
(today the caller's client does it).
