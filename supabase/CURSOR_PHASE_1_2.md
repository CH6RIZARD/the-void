# Cursor task — apply the schema and bring auth online (Phases 1–2)

Everything that can be prepared without database credentials is already done and
committed. This is the part that needs a credential or a dashboard click.

Project: **the void** — ref `zsrpsdufwgfyfoulmazt`, AWS us-east-2, org
`daniel4chigs@gmail.com`. Repo is private.

---

## What is already done — do not redo

- `supabase/APPLY.sql` — 001 + 002 + 003 concatenated in the correct order, ready to
  paste and run as one migration.
- `supabase/migrations/003_regions_seed.sql` — **generated** from the client's own
  region table (`scratchpad/genseed.js`). Seeds 95 regions (13 contested/
  sub-national, `custom = true`) with centroids, and rewrites `set_post_region()`
  with a nearest-centroid fallback so region resolution works before Natural Earth
  is imported. Polygons still win when they exist.
- `supabase/verify.mjs` — post-apply verification using the ANON key only, i.e. the
  exact surface a real client has. Currently reports "no tables exist", correctly.
- Client side is finished: `VoidAuth` (anonymous sign-in, email, OAuth authorize,
  refresh, sign-out, `upsertProfile` through PostgREST), `VoidAPI.token` carrying
  the bearer on every write, project URL and anon key wired with overrides.

## Ground rule

`void2-final.html` is the SOURCE. `copy33thevoid.html` and
`void-app/assets/void.html` are GENERATED — edit the source, run `node build.js`,
and `node build.js --check` must exit 0 before committing. See
`.cursor/rules/the-void.mdc`.

---

## Step 1 — enable extensions

https://supabase.com/dashboard/project/zsrpsdufwgfyfoulmazt/database/extensions

Enable `postgis`, `pgcrypto`, `citext`. PostGIS is required: `regions.geom` is
`geography(MultiPolygon,4326)` and `posts.location` is `geography(Point,4326)`.

## Step 2 — apply the schema

https://supabase.com/dashboard/project/zsrpsdufwgfyfoulmazt/sql/new

Paste all of `supabase/APPLY.sql` and run it as ONE statement batch — later
policies and triggers depend on tables created earlier in the same file.

**Do NOT run `000_supabase_compat.sql`.** It shims `auth.users` / `auth.uid()` /
the anon+authenticated roles onto a plain Postgres server (the Railway pivot).
Supabase provides all of it natively; running it here is noise at best.

Expect to iterate. `001`'s own header says it was never executed by its author —
"NOT EXECUTED ... no Postgres was available. Run it against a scratch project first."
If a statement fails, fix it **in the migration file**, not only in the editor, and
regenerate `APPLY.sql`.

Alternative if you have the DB password (Settings → Database → Connection string):
```bash
supabase link --project-ref zsrpsdufwgfyfoulmazt
supabase db push
```

## Step 3 — enable anonymous sign-ins

https://supabase.com/dashboard/project/zsrpsdufwgfyfoulmazt/auth/providers

Turn on **Anonymous sign-ins**. Verified live: `external.anonymous_users` is
`false` today, so `signInAnonymously()` 422s until this is flipped. Only `email`
is enabled; every OAuth provider is off.

Then harden the surface you just opened — anonymous sign-up is unauthenticated
account creation:
- Rate limits: https://supabase.com/dashboard/project/zsrpsdufwgfyfoulmazt/auth/rate-limits
- CAPTCHA / attack protection: https://supabase.com/dashboard/project/zsrpsdufwgfyfoulmazt/auth/protection

Optional, same providers screen — Google/Apple OAuth. This is the *upgrade* path:
linking an identity to an anonymous user keeps the same user id, so their history
survives. Apple needs a paid developer account and a Services ID.

## Step 4 — verify

```bash
node supabase/verify.mjs
```

Checks tables exist, the regions seed landed (95 rows, PS present), anon cannot
INSERT a profile or DELETE posts, anonymous sign-in issues a session, that session
resolves to a user, and the profile upsert the app performs succeeds under RLS.
Must print ALL CHECKS PASSED.

Then run the SQL-side checks that PostgREST cannot reproduce — the VERIFY block at
the bottom of `001_void_schema.sql`. Two of the six matter most:

1. **Prekey concurrency.** Two psql sessions, both
   `begin; select otpk_id from claim_prekey_bundle('<user-uuid>');`
   They must return DIFFERENT, NON-NULL ids. If they match or return null, **stop** —
   forward secrecy is broken before DMs exist.
2. **Membership is not a tautology.** As a user in ≥1 conversation but not in
   conversation X: `select count(*) from conversation_members;` must return only
   their own rows, never the whole table.

Also: derived columns (`rank_score`, `region_code`) must reject client writes;
`explain (analyze)` on a reaction insert must show no `ST_Covers`/regions scan;
`posts_in_bbox(170,-10,-170,10)` must not be trivially 0; `start_dm(B)` twice must
return the same uuid.

## Step 5 — confirm the client end to end

With steps 1–4 green, no client change is needed — the URL and key are already
wired and `VoidAuth` initialises on boot. Confirm:

- Open the app, choose CONTINUE ANONYMOUSLY → a row appears in `auth.users` and in
  `profiles`.
- Kill and reopen → still signed in (session persisted and refreshed on boot).
- Sign out in Settings → session cleared, identity screen returns.
- A second account cannot read the first's private rows via the anon key.

## Definition of done

- `node supabase/verify.mjs` prints ALL CHECKS PASSED
- `node build.js --check` exits 0
- The six VERIFY checks in `001` pass, prekey concurrency especially

## Then, and only then

Phase 3 in `CURSOR_BACKEND_BRIEF.md` — implement the `VoidAPI` contract
(`bolt / reply / repost / share / follow`) against these tables and set
`VoidAPI.base`. The client already routes every action through it with optimistic
UI and rollback, so no UI work is required.
