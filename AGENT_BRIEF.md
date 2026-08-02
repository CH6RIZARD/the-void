# THE VOID — backend agent brief

Status: draft. Frontend is `void2-final.html` (single file, shipped into the Expo
app via `void-app/scripts/sync-ui.js`). There is no backend yet. This brief covers
the one being built.

Greenfield: a repo-wide search found **no existing Supabase footprint** — no
client, config, migrations, or references anywhere in `The Void`. Nothing to
reconcile with or migrate from; the schema below is the first one.

Read `CONTRACTS.md` first — its provenance rules bind everything below.

---

## Geo-anchor rule

> Geo-anchor is the place a post is **about**, never the author's location — no
> location permission, no GPS on posts. Globe resolves per region: live `places`
> feeds where `status='ok'`, falling back to `topics` seeded per region, with user
> posts layered on both. `places` health is written by a scheduled function, not
> checked client-side. Topic ingestion is a separate cron function writing into
> `topics`.

Consequences: no location permission prompt, no real-time-location exposure to
defend, no location data in the breach blast radius, and no per-user geo retention
policy to write. The globe is a map of places and topics, not of people.

---

## Schema

```sql
places   id, name, region_code, location geography(Point,4326),
         feed_url, feed_kind ('hls'|'mjpeg'|'embed'),
         last_ok_at, status          -- health; dead cams degrade, never hang

topics   id, label, category, region_code,
         source ('gdelt'|'reddit'|'x'), heat, refreshed_at

posts    ..., place_id nullable, topic_id nullable
```

**`posts.location` was dropped from the draft on purpose.** A nullable location
column on `posts` re-opens exactly the risk the geo-anchor rule closes: it is the
natural place for someone to later write a device coordinate, and nothing in the
schema would stop them. A post's geography is `place_id`/`topic_id` → `region_code`.
If a post needs a geo-anchor with no matching row, add the `places` row. Keep the
column absent so the rule is enforced by the schema and not by memory.

---

## Globe resolution

Tap a region →

1. `places` where `region_code = ? AND status = 'ok'` — the highlight case
2. else `topics` where `region_code = ?` ordered by `heat` — **the normal case**
3. user posts joined via `place_id`/`topic_id`, layered on either

Step 2 is not a failure state. Most regions will never have a pullable public cam,
so `topics` is what the globe mostly *is*. Build and instrument it as the primary
path; treat `places` as the garnish that appears where geography cooperates.

---

## Jobs

**Feed health** — scheduled function, rotates through `places`, writes `last_ok_at`
and `status`. Public cams die constantly; without this the failure mode is a user
staring at a spinner, which reads as a broken app rather than a dead camera.

Liveness check must branch on `feed_kind` — a 200 on an `embed` page says nothing
about whether the camera behind it is alive. `hls`: fetch the manifest and require
a recent segment. `mjpeg`: require first bytes within a timeout. `embed`: 200 is
the only signal available, so mark these `degraded` rather than `ok` and rank them
below verified-live feeds.

**Topic ingestion** — separate cron function writing into `topics`. Must carry
`CONTRACTS.md` provenance (`sourceHost`, `fetchedAt`, `responseHash`,
`rawResponseURL`) like every other ingested item.

Both recommended sources are **already on the `CONTRACTS.md` allowlist**
(`api.gdeltproject.org`, `www.reddit.com`), so seeding `topics` from them needs no
contract change. Adding any source outside that list means amending `CONTRACTS.md`
first — the allowlist is the gate, not a suggestion.

---

## Topic sources — verified July 2026

**Do not build against X as the seed source.** Checked because the pricing
assumption was flagged, and it has moved:

- Basic ($200/mo) and Pro ($5,000/mo) are **closed to new signups** — legacy
  subscribers only, and X began auto-migrating remaining Basic subscribers to
  pay-per-use on 2026-06-01.
- New developers get **pay-per-use or Enterprise**, nothing else.
  Pay-per-use is **$0.005 per post read**, capped at 2M reads/month
  (≈$10,000/mo at the cap). Enterprise starts ≈$42,000/mo.

Per-read metering inverts this product's cost model. `topics` is the *fallback*,
which means it is the *common* case across most of the map — the highest-volume
read path in the system. Putting it on a per-post meter means paying the most for
the thing that happens most. Region count × posts per region × refresh frequency
is the cost function, and it grows with exactly the coverage the globe wants.

**Recommended order:**

1. **GDELT** — free, no key, and natively region-keyed via `sourcecountry:`, which
   is the exact shape `topics.region_code` needs. Already integrated and verified
   working in `void2-final.html` (`pullCountryNews`): `sourcecountry:india`
   returned 60 articles, 52 carrying images, from Indian outlets. Rate limit is
   ~1 request/5s and it answers over-limit with **plain text, not JSON** — the
   existing client gate and non-JSON guard should be ported to the cron function.
2. **Reddit** — workable API, per-subreddit rather than per-region, so it needs a
   region→subreddit map. Good for regions with an active local sub.
3. **X** — optional enrichment for a handful of high-value regions only, never the
   seed. Revisit only if a fixed-cost tier returns.

---

## Open decisions

- Auth: email/password, OAuth, or passkeys. Everything else depends on this — the
  notification feed depends on the posting API, which depends on auth.
- Whether the E2EE DM transport is the native Expo module wrapping Matrix (chosen
  earlier; keys in Keychain/Keystore) or `matrix-js-sdk` in the WebView (faster,
  keys in WebView storage next to unpinned CDN scripts). These are different
  builds. Unresolved.
- Region taxonomy for `region_code` — GDELT country names, ISO-3166, or a custom
  set. GDELT's is the cheapest to adopt given it's the primary source, but it is
  country-grained, so sub-national regions need a decision.
