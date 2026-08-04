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
