# Note for other agents working in this repo

_Written 2026-09-17 by the stream-sources agent. Read this before you touch
`void2-final.html` or anything under `scripts/`._

## What I am doing

Scaling the live-stream pool: more sources per nation, more nations, **same feel**.
The 7-news / 3-life mix in `WALL_MIX` is deliberately untouched.

**MERGED into `main` as `7d2f799` (2026-09-17) and deployed live.** If your local `main`
is still at `8659536`, run `git pull` before committing. Your uncommitted
`void2-final.html` hunks are far from mine and should merge cleanly.

## I have not touched your work

When I started, the working tree had uncommitted changes I did not make:

```
copy33thevoid.html
void-app/assets/void.html
void-app/src/core/feed/bluesky.ts
void-app/src/features/feed/format.ts
void-proxy/public/index.html
void-proxy/public/void.html
scripts/verify-perf.mjs                (untracked)
void2-final.html                       (reels / vwAttach / liveWake / PeerTube / bluesky hunks)
```

I left every one of them alone. To avoid touching them I did my work in a **separate
git worktree** (`D:\stream dept\wt`), so my commits contain only my own files. Your
changes are still sitting uncommitted in the main tree — **please commit them**, they
are currently unprotected.

`main` also advanced from `9b057b7` to `8659536` while I was working, so more than
one of us is active here.

## ⚠️ The one thing that will bite you

**`void2-final.html` is being edited on both sides.**

My edits to it are deliberately tiny and confined to two places:

| what | where |
|---|---|
| the `C` country array — one line, 82 → 199 nations | ~line 2522 |
| the `IPTV_SOURCES:GENERATED` block — regenerated, do not hand-edit | ~line 2158 |

Everything else in that file is yours. If you commit your `void2-final.html` work
before `stream-patches` merges, the merge should resolve cleanly — the hunks are far
apart. **If you regenerate the whole file from a template or reformat it, my changes
will be silently lost.**

## What changed, and why it matters to you

- **The globe now holds 199 nations, not 82.** This is load-bearing for more than the
  globe: `scripts/build-iptv-sources.js` maps ISO-2 → country name by *reading the `C`
  array*, so any nation missing from `C` has its streams discarded before they are
  ever probed. If you add or remove entries in `C`, you are adding or removing
  stream coverage.
- **The stream pool went 508 → 2,186 streams across 154 nations.** It is baked into
  the HTML by `scripts/inject-iptv.js` as a string (~268KB raw, 49KB brotli).
- `scripts/streams/` is new and is mine: `build-nations.js`, `report.js`,
  `build-review-site.js`.
- I fixed a filter bug in `build-iptv-sources.js` that the nation expansion would
  otherwise have triggered — with "Congo", "Guinea" and "Sudan" now on the globe, the
  "is this channel about a different nation?" check was about to delete the entire
  catalogues of DR Congo, Equatorial Guinea and South Sudan.

## If you need to regenerate the builds

`copy33thevoid.html` and `void-app/assets/void.html` are generated from
`void2-final.html` by `node build.js`. I have **not** run it, so on `stream-patches`
those two are stale relative to the new nation list. Run `node build.js` after the
merge, not before — otherwise you will bake in a half-merged app.

## Review before merge

The branch publishes its own Cloudflare Pages site (project `stream-patches`, via
`.github/workflows/deploy-stream-patches.yml`) with the patched build playable, so the
globe can be checked before any of this reaches `main`. It deploys **only** that
project — `void-app-d35c`, the live app, is never touched by this branch.
