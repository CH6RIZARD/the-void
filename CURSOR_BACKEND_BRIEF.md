# THE VOID — Backend build-out brief (for Cursor)

Build the backend end to end on **Supabase**, on top of what already exists. This
document is the source of truth for what is done, what is half-done, and what is
missing. Do not re-do finished work; do not assume anything marked ⚠️ is safe.

---

## 0. Ground rules — read before editing anything

### The three HTML files are ONE file
```
void2-final.html            SOURCE — canonical app. ALL shared work lands here.
void-app/assets/void.html   NATIVE build — GENERATED (2-wide grid, WebView shell)
copy33thevoid.html          WEB build — GENERATED (3-wide grid, browser/PWA)
void-proxy/public/*.html    deploy output — GENERATED
```
`build.js` generates the targets from the source and applies a per-build patch set.

- **Edit `void2-final.html` only**, then run `node build.js`.
- Hand-editing a generated target is pointless — the next build overwrites it.
- A build-specific difference goes in `PATCHES` inside `build.js` and nowhere else.
- `node build.js --check` must exit 0 before you commit. It verifies drift, JS
  syntax in all three builds, and a set of invariants.

### Frontends
- **Web app** = `copy33thevoid.html`. **Mobile** = Expo shell in `void-app/`, which
  bundles `assets/void.html` in a WebView. The only real React Native screen is
  `src/ConsentScreen.tsx`; everything else is the web app.
- Do **not** rewrite the UI as native RN screens. That is not in scope.

### Two loading animations exist, and only two
- **Images** → twin-orbit spiral (`IMG_LOADER`)
- **Video / live streams** → sparkle-float (`sparkleMarkup()` / `sparkleTile()`)

No third loading treatment may be introduced — no skeletons, shimmer, spinners,
striped blocks or "PHOTO"/"VIDEO" captions. In **light mode on feed surfaces only**
the loader ground is milky white (`#f7f3ea`); media surfaces (globe stream grid,
reel, photo viewer) stay dark in every theme. If media fails, the block collapses —
never leave a loader running over something that will never arrive.

### Other invariants
- Keep every existing element id and inline handler working. `build.js` asserts some
  of these; the rest are load-bearing.
- All colour goes through CSS variables so VOID / DARK / LIGHT keep working.
- The feed is **append-only** — rendered posts never move. Only an explicit refresh
  (`refreshVoidFeed()`) rebuilds the list.
- Tags stay in the data model (they drive ranking) but **never render on a post**.

---

## 1. Stack decision — SUPABASE, not Fastify/Prisma

The schema in `supabase/migrations/` is already written for Supabase. Use it.

| Concern | Use | Not |
|---|---|---|
| Database | Supabase Postgres | self-hosted PG |
| ORM | `supabase-js` + SQL migrations | Prisma |
| Auth | Supabase Auth (OAuth + email; passkeys if supported) | Better Auth / Auth.js |
| Storage | Supabase Storage | R2 / S3 |
| Realtime | Supabase Realtime | raw WebSockets + Redis Pub/Sub |
| Row security | RLS policies | app-layer checks only |
| Aggregation API | existing `void-proxy` (Express) | rewriting in Fastify |

Reasons: the tables, the E2EE prekey design and the RLS assumptions are already
Supabase-shaped, and Supabase collapses four boxes of the stack into one. Redis +
BullMQ come back **only** when the notification fan-out actually needs a worker.

---

## 2. What is DONE — do not rebuild

### Client API contract (complete)
`VoidAPI` in the source file defines the entire engagement surface and every action
already routes through it with optimistic UI and rollback (`SIGNAL LOST · RETRY`
toast on failure):
```js
bolt(id,on) reply(id,body,parentId) replies(id,cursor) repost(id,on) share(id)
follow(handle,on) reels(seed) nationFeed(iso,cursor) nationTop3(iso)
```
`VoidAPI.base === null` means local-only mode: calls resolve `{ok:true,local:true}`
and local scorers stay authoritative. **Setting `base` is the only client change
needed to go live.** Implement these paths exactly; do not rename them.

### Database schema (designed, not deployed)
`supabase/migrations/001_void_schema.sql` + `002_contention_split.sql`:
`regions, profiles, posts, post_media, reactions, follows, notifications, places,
topic_sources, topics, devices, signed_prekeys, one_time_prekeys, conversations,
conversation_members, messages, message_envelopes`.
See `SCHEMA_REVIEW.md`. Review before applying — it has not been run against a live
project and RLS policies need auditing.

### Aggregation proxy (working, read-only)
`void-proxy` (Express + ESM, `railway.json` present) serves `/feed`, `/social`,
`/streams`, `/illustration`, `/health` with tension/hot/recent ranking, provenance
and taxonomy. It has **no database and no writes** — leave it that way. It is the
content-ingest side, not the social backend.

### Client features already built
Feed with ranking + topic/subject diversification; globe (WebGL) with dual-mode
REELS⇄GLOBE and drag-to-switch; live stream wall with viewport-gated players;
threads with nested replies, TOP/NEW sort and real Bluesky reply fetch; composer
with **real gallery picker and MediaRecorder audio**; profile; local DMs; three
themes; onboarding consent screen; boot failsafe.

---

## 3. What is PARTIAL — finish these

| Area | Exists | Missing |
|---|---|---|
| **Sign-in** | Full UI (`#signin`, handle + display name, validation, anonymous path), gated on `void_signed_in` | Real sessions. It is `localStorage` only — no password, no server, no verification |
| **Composer media** | Captures real photos/video/audio; object URLs; `_files` / `_audioBlob` on the post payload | Nowhere to upload. Media dies with the tab |
| **Thread replies** | Fetches real Bluesky replies via `getPostThread`, merges with local, one synced count | Cannot post back. Local replies never leave the device |
| **DMs** | Full UI, conversation list, chat window | `xorCipher` mock. Schema has prekeys/envelopes designed; transport undecided |
| **Push** | Expo app + native modules (`expo-void-sensing`, iOS Swift + Android Kotlin) | No token registration, no APNs/FCM, `devices` table unused |
| **Notifications** | `notifications` table designed | No producer, no consumer, no UI |
| **Search** | Client-side filter + live Reddit fetch | No server search, no FTS |

---

## 4. What is MISSING — build in this order

Auth gates everything: notifications depend on posting, posting depends on identity.

### Phase 1 — Auth
- Supabase Auth: OAuth + email. Passkeys if the Expo path supports them cleanly;
  do not block on it.
- Replace the local gate in `submitSignIn()` / `signInAnon()` / `signOut()` with
  real sessions. **Keep the screen's design and both entry paths** — anonymous must
  survive as a first-class route (it is a product decision, not a placeholder).
- Persist the session so the app does not re-gate on every launch.
- `profiles` row created on first sign-in; handle uniqueness enforced in the DB.
- **Done when:** sign in on web and mobile, kill the app, reopen, still signed in;
  handle collisions rejected server-side.

### Phase 2 — Apply the schema
- Review `SCHEMA_REVIEW.md`, apply `001` + `002` to a real project.
- Write RLS on every table. Default deny. A user may read public posts, write only
  their own rows, and read only conversations they are a member of.
- **Done when:** RLS proven with a second account — user B cannot read or write
  user A's private rows via the anon key.

### Phase 3 — Write API (the `VoidAPI` contract)
- Implement `bolt / reply / repost / share / follow` against Supabase.
- Counts must come from the database, never hardcoded. `syncReplyCount()` on the
  client expects one authoritative number per post — keep feed and thread agreeing.
- `replies(id,cursor)` must return the nested shape the thread renderer expects
  (`parentId`, one nesting level rendered).
- Set `VoidAPI.base`; verify optimistic UI and rollback against real failures.
- **Done when:** a bolt from one device appears on another after refresh, and a
  forced 500 rolls the UI back and shows the toast.

### Phase 4 — Storage + posting
- Supabase Storage buckets for image / video / audio; signed uploads.
- `submitComposerPost()` uploads `_files` / `_audioBlob`, then writes `posts` +
  `post_media` with the returned URLs.
- Image derivatives: Supabase image transforms first; add Sharp in a worker only if
  transforms prove insufficient.
- **Done when:** a photo and a mic recording posted from mobile appear in the web
  build's feed, load behind the correct loader, and survive a reinstall.

### Phase 5 — Realtime + notifications
- Supabase Realtime for live counts and DM delivery.
- `notifications` rows on bolt / reply / repost / follow; add a notifications UI.
- Introduce Redis + BullMQ **only** if fan-out needs to be async — not before.
- **Done when:** two devices see a reply appear without a manual refresh.

### Phase 6 — Push
- Expo Push tokens → `devices`; APNs + FCM credentials; deep links into thread/DM.
- Respect the existing consent posture in `ConsentScreen.tsx`.

### Phase 7 — Search
- Postgres FTS over `posts` (tsvector + GIN, trigger-maintained).
- Replace the client-side filter. **Do not restyle the search screen** — it is
  explicitly rescinded from the design patch. Wire data only.
- Meilisearch only if FTS proves inadequate at scale.

### Phase 8 — Hosting
- Supabase for DB/auth/storage/realtime; `void-proxy` on Railway (config present).
- Environments: the client reads `VOID_PROXY_BASE` from `?proxy=`, `localStorage`,
  or Expo `extra.voidProxyBase`. Never hardcode a URL into the source file.

---

## 5. Decisions — RESOLVED (do not reopen)

These were open. They are now decided and implemented; the reasoning is recorded so
nobody re-litigates them.

### 5.1 E2EE DM transport — keep the schema's own protocol, NOT Matrix
`001_void_schema.sql` already implements a Signal-shaped design: per-device
`identity_key`, `signed_prekeys`, `one_time_prekeys` with `claimed_at` + a partial
index on unclaimed keys (X3DH exhaustion handled), per-recipient-device
`message_envelopes` (fan-out on write), `envelope_version` for wire-format changes,
and `conversations.dm_key unique` for structural dedupe of concurrent `start_dm()`.
Adopting Matrix deletes five considered tables to buy federation and moderation
infrastructure that has not been asked for. **Implement the ratchet client-side
against these tables.**

The real risk was never the protocol, it was **key storage**: the web build has no
Keychain, so keys sit in WebView storage alongside CDN scripts. **Implemented:**
both CDN scripts are now version-exact and SRI-hash-pinned (`three.js r128`,
`hls.js 1.6.16`), so the code sharing that origin cannot silently change. Mobile
should still put private keys in Keychain/Keystore via the native module.

### 5.2 Region taxonomy — settled in the schema; the INGEST MAPPING was the gap
The migration already decided this: `regions` uses ISO 3166-2 codes with
country/subdivision levels, `parent_code`, PostGIS geometry seeded from Natural
Earth, and `custom` for contested territories. `posts.region_code` is DERIVED by a
trigger via `ST_Covers` and force-discards any client value. GDELT lost.

What was actually missing was turning source strings into a code and a point.
**Implemented:** `resolveRegion()` in the source file maps free-text country names
onto ISO codes + centroids, using the existing `C` table plus an alias set covering
abbreviations (`USA`, `U.K.`) and contested places flagged `custom:true` (Palestine,
Gaza, West Bank, Kosovo, Western Sahara, Taiwan, Crimea, Somaliland, ...). Every
ingest path (`bskyToPost`, `redditToPost`, `proxyPostToApp`) calls `stampRegion()`,
which sets `_region` / `_lat` / `_lon`. Nation matching now uses `_region` instead
of raw string equality, which was silently failing across sources
("Palestinian Territories" vs "Palestine").

**Still to do server-side:** send `_lat`/`_lon` as `location` on insert and let the
trigger derive `region_code`; seed `regions` including the `custom:true` rows.

### 5.3 Anonymous accounts — real auth users, upgradeable
Anonymous is a first-class route on the sign-in screen, so it must be a real
account: Supabase anonymous sign-in issues an auth user (and therefore a `profiles`
row), so every FK works, and an OAuth identity can be **linked to the same user**
later without orphaning their history. The alternative made anonymous users
read-only, which the screen does not promise.

**Implemented:** `VoidAuth` in the source file — anonymous sign-in, email sign-in/
sign-up, OAuth authorize URL, refresh, sign-out, and `upsertProfile()` through
PostgREST so RLS applies. Sessions persist in `localStorage` and are refreshed on
boot. `VoidAPI.token` carries the bearer token so every write authenticates as the
signed-in user. Configure via `void_supabase_url` / `void_supabase_key` in
localStorage or `window.__VOID_SUPABASE_URL__` / `__VOID_SUPABASE_KEY__`; with
neither set the app stays in local-only mode exactly as before.

**Verify against a live project:** the anonymous sign-in call posts to
`/auth/v1/signup` with `{data:{anonymous:true}}`. Confirm that shape (and that
anonymous sign-in is enabled in project settings) on first connection — it fails
safe to local mode, so a wrong shape degrades rather than breaks.

## 6. Definition of done for the whole brief

- `node build.js --check` exits 0.
- Web and mobile builds share one backend; an action on one is visible on the other.
- No feature regresses to local-only when `VoidAPI.base` is set.
- RLS verified with a second account.
- The two loading animations are still the only two in the app.
