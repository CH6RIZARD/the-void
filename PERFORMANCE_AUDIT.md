# The Void — Pre-launch Performance Audit (Android app, `void-app/`)

> Audit date 2026-09-22, branch `perf/mobile-fixes`. Execution follows the sequence in §6, one shippable step at a time, each measured on the test phone before and after. Measured results go in §8.

## Context
The user reports the Android APK as "unusable, slow". Their worst areas are the **globe / live wall**, **startup and tab switching**, and **freezes**.

**Measured on the test phone** (Helio P35, Android 11, `scripts/perf-android.mjs`, 2026-09-20/21):
- 100% janky frames on every screen, with frames taking 250 ms–5 s (1–4 fps).
- 650–826 MB of memory (PSS). The GC threads use 25–28% CPU all the time.
- The UI thread runs at 85–91% on the feed. WebView processes run at 107% on the globe tab.
- 5 ANRs from 2026-09-20 to 09-21 (`dumpsys dropbox`). Causes: Reanimated loader prop updates on detached views (×2), `SvgView.onDraw`, a mass creation of SVG `PathView`s in one commit, and a blocking `ExoPlayer.release`.
- The latest APK is **100.8 MB**, measured with `unzip -l` on `D:/void-build/onboarding3`.

**Mandate:** 60 fps, input response under 100 ms, and a cold start under 2 s, **without removing a single feature**.

Four read-only code sweeps produced this document (native perf, globe/wall/startup, data/network/scale, reliability/security, code health/bundle), plus an APK breakdown. Every finding cites the code. Paths are relative to `void-app/` unless marked `proxy:` (`void-proxy/server.js`) or `sql:` (`supabase/migrations/`).

---

## 1. Executive verdict

**This would not ship at Apple.** The product idea and the server-side data model are sound: RLS is on every table, there are no leaked secrets, and there are real golden-parity tests. The client, though, runs **everything it has ever opened, all the time**:

- Once the globe tab has been visited, up to 24 YouTube WebViews keep running for the rest of the session, each posting a message to JS every second.
- Hundreds of Reanimated loader dots tick every frame. That is the ANR stack on the phone.
- A 60 Hz `requestAnimationFrame` loop spins on every tab.
- The tabs are never frozen.

**Across the app, work is not tied to what is visible, network calls have no deadlines, and the release build is not optimised:**
- Almost no request has a timeout. One stalled request on 2G locks the feed, reels or composer for the whole session.
- Every phone fans out directly to ~15 volunteer-run APIs, which will rate-limit carrier-NAT users long before 1M DAU.
- The release build has no R8, ships both ABIs and carries ~9 MB of unused barcode ML.

**None of this needs feature cuts. It is fixable with discipline in 4–6 focused weeks.** The first two weeks (§6 steps 1–4) should turn a 1–4 fps app into a smooth one on the test phone.

## 2. Critical paths (judge everything against these)

1. **Cold launch → first feed card.**
   - Splash: `app/_layout.tsx:52` waits for `bootCore` (full AsyncStorage read, `src/lib/core.ts:29-40`), then up to **3 s on Supabase `getSession`** (`core.ts:132`), then 7 fonts.
   - The root layout eagerly imports the ~373 KB `core/index.ts` barrel with all generated data, and the whole `features/live` barrel (WebView, expo-video, fflate), just to get `AudioOwnerProvider` (`_layout.tsx:19`).
   - Feed: proxy `/feed` → Bluesky feeds in sequence → Reddit subreddits in sequence (`core/feed/voidFeed.ts:23-37`). None of these calls has a timeout.
2. **Feed scroll (the core loop).**
   - Shadows and loaders on every card, and a Reanimated fade on every card.
   - Two global re-render fan-outs: `usePostReaction` → `useReelStoreVersion` (`reactions.ts:26`), and `usePillTick`, which updates every 100 ms (`AudioPill.tsx:37`).
3. **Globe tab.**
   - It opens on REELS. "PULLING SIGNAL…" is the reels empty state (`features/reels/ReelsView.tsx:315`); it can hang forever.
   - GLOBE: three.js drawn on the JS thread with ~205 draw calls per frame, plus the live wall of WebViews.
4. **Nation screen.** About 40 or more third-party requests from the phone per open (`core/feed/nation.ts:488-539`), plus a 404 to a proxy route that doesn't exist (`core/streams/nation.ts:62`).
5. **Tab switch.** Nothing is frozen or paused. Every tab you've opened keeps its timers, WebViews and frame callbacks alive.

## 3. Scorecard

| # | Area | Score | Core evidence |
|---|---|---|---|
| 1 | Perceived performance | **2/10** | 1–4 fps measured; the splash waits on the network for up to 3 s (`core.ts:132`); reels spin forever (`ReelsView.tsx:141-166,315`); no skeletons on the wall; a render failure is black with no fallback (`GlobeCanvas.tsx:57`). |
| 2 | Real performance | **3/10** | The wall keeps WebViews alive when hidden (`LiveWall.tsx:409`, `StreamTile.tsx:324-334`); loaders run a 1 Hz message loop and a frame callback per dot (`ytHtml.ts:47-51`, `useLoaderClock.ts:10-13`); the rAF loop runs forever (`GlobeCanvas.tsx:59-60`); 199 sprites are 199 draw calls (`globeScene.ts:159-166`); there is a main-thread `captureRef` every 6.1 s per tile (`StreamTile.tsx:249-275`); no `freezeOnBlur`. |
| 3 | Scale readiness | **2/10** | Direct client fan-out to ~15 third-party APIs; proxy stampede, no timeouts, no Cache-Control or gzip (`proxy:649-658,757-762,892-898`); the main feed query has no index (`voidApi.ts:94` vs `sql:001:84-88`); the DM poll reads 500 rows per tick (`dmStore.ts:108-111`), ~4.5k rps at peak at 1M DAU; in-memory pools grow without limit (`core/feed/store.ts:6-7`). |
| 4 | Reliability | **4/10** | No fetch timeouts, so the global locks `feedLoading`, `_reelLoading` and `dropping` never release (`voidFeed.ts:24`, `reels.ts:130`, `composer/drop.ts:14`); one app-wide error boundary; no crash reporting; no NetInfo; no refresh on foreground; a refresh error wipes the session (`coreBridge.ts:78-81`). |
| 5 | Code health | **5/10** | Strict TS and a consistent store pattern are good. But 20 tests are never run (no `test` script, no CI step); no linter; 122 empty `catch`es; a `core/index.ts` barrel that defeats lazy loading; two session stores; four ~1 MB copies of the web app; unused `expo-camera` and `expo-sharing`. |
| 6 | Security & data | **6/10** | RLS, grants and storage policies are strong. But the OAuth callback accepts any token and has no PKCE (`app/auth-callback.tsx:22-28`); tokens sit in plain AsyncStorage with backups on; Apple tokens aren't revoked on delete (`DeleteAccountSheet.tsx:83`); the privacy manifest is incomplete; the proxy is open to quota and memory abuse. |

---

## 4. Findings and fixes

Each item gives the problem, the files, the fix, an effort estimate (S ≤ ½ day, M 1–2 days, L 3–5 days) and the expected impact. **Nothing removes a feature.** Where something is slow, it gets rebuilt faster; nothing is deleted.

### P0 — Ship blockers (user-felt slowness or breakage on critical paths)

**P0-1. The loader freezes (ANR).**
- **Problem:** Every `SparkleLoader` is 14 `Animated.View`s on an always-on `useFrameCallback`. Hidden or detached views throw `RetryableMountingLayerException`, and each one is logged on the main thread. That is both ANRs.
- **Files:** `src/ui/loaders/useLoaderClock.ts`, `ui/SparkleLoader.tsx:45-77`, `ui/loaders/ImageOrbitLoader.tsx:36-43`, `features/live/TileChrome.tsx:179-198`, `StreamTile.tsx:469-474`.
- **Fix:**
  - (a) Cherry-pick **`cce6c2d`** from `onboarding` onto this branch. It is already written and proven; it pauses the clock on blur, hide and background.
  - (b) Rebuild SparkleLoader so the dots don't each need a frame callback: one shared clock per screen, with dot styles computed from it, or one `Animated.loop` on the native driver per loader. The look stays identical.
  - (c) Tiles in the NO SIGNAL / offline state show a static loader frame. The design is kept; it just doesn't tick forever.
  - (d) The YouTube "hold" veil reuses the tile's existing loader instead of mounting a second one.
  - (e) Stop the clock before a fading loader unmounts.
  - (f) **SVG view storms (ANR 2026-09-21 23:29, measured).** The main thread was stuck in `com.horcrux.svg.PathView.<init>` inside a Fabric `IntBufferBatchMountItem`: one commit created thousands of native SVG views (46 s of main-thread CPU). Every `react-native-svg` `<Path>` is a native Android `ViewGroup`. Static icons repeated per card, tile or row (feed actions, moderation icons `reels/ModIcons.tsx` / `feed/vmodIcons.tsx`, tile chrome, BottomNav) become **one pre-rendered image each** (`expo-image` of a bundled PNG/WebP at 1×/2×/3×, or an icon font). The glyphs look the same, and an icon becomes 1 view instead of 3–10. Dynamic SVG (loaders, charts) stays SVG.
  - (g) **Blocking player release (ANR 2026-09-21 23:37, measured).** The main thread was waiting in `ExoPlayerImplInternal.release` ← `expo.modules.video.player.VideoPlayer.close`. Releasing a player blocks until its playback thread stops, and releasing several in one commit adds those waits up. **All player unmounts go through one release queue:** at most one `expo-video` player release per ~250 ms, paused and detached first, off-screen tiles first. This is a precondition for P0-2's teardown, which would otherwise make this ANR worse.
- **Effort:** (a) S, (b)–(e) M, (f) M, (g) S.
- **Impact:** removes both ANR causes, plus hundreds of UI-thread prop commits per frame. It is the main driver of the 85–91% UI thread.

**P0-2. The live wall runs when nobody is looking.**
- **Problem:** Hidden tiles are only paused (`pauseVideo`); the WebView renderer stays alive. Once built, the wall stays mounted in REELS mode, on other tabs and in the background. Eviction needs more than 8 WebViews *and* more than 2 screens of distance, so the first 12–24 tiles are never evicted.
- **Files:** `features/live/LiveWall.tsx:345-422`, `StreamTile.tsx:121-136,324-334`, `constants.ts:19,51-53`, `features/globe/GlobeScreen.tsx:134-138`.
- **Fix:**
  - When `active` is false (blurred, REELS mode, background), unmount every player. The tile data and cascade position are kept, so coming back remounts only the in-view players.
  - Visible, in-budget tiles keep playing live, as now.
  - Evict anything more than `PARK_SCREENS` away (unmount, not pause).
  - `MAX_MOUNTED_WEBVIEWS` 8 → 4 by default. Raise it to 8 only on devices that prove fast at runtime, based on measured first-frame times of the first tiles. Don't use reported RAM: the test phone claims 11.8 GB. `WALL_LANES` 8 → 3.
  - Start the first batch ~800 ms after the globe's first frame.
- **Effort:** M.
- **Impact:** WebView CPU goes from ~107% to ~0 when you leave the wall. Expect roughly 150–300 MB less memory, and no background decoders draining the battery.

**P0-3. YouTube tiles: poster-first, with a message loop only while needed.**
- **Problem:** `ytHtml.ts:47-51` posts `{e:'info'}` from every WebView every second, forever, including when paused. Hardware layers are double-wrapped (`ytHtml.ts:96`, `StreamTile.tsx:437/459`).
- **Fix:**
  - Every YouTube tile renders its poster (`i.ytimg.com/vi/<id>/hqdefault.jpg` through `expo-image`, filling `StreamSource.thumbnail`, `live/core.ts:30`) instantly. The WebView mounts on top only when the tile is in view and within budget. The feature is the same (live video in view); first paint is instant instead of a black box.
  - `info` is posted only on a state change, and not while paused.
  - Remove `renderToHardwareTextureAndroid` around the WebViews.
- **Effort:** M.
- **Impact:** the wall paints in under 100 ms instead of seconds of loaders. N JSON messages per second on the JS thread drop to about 0 in steady state, and the per-frame offscreen composite goes away.

**P0-4. MJPEG and iframe cams ignore `parked`.**
- **Problem:** MJPEG re-downloads a full JPEG every second with `cache:'reload'`, on any tab, forever.
- **Files:** `StreamTile.tsx:131,134,483-536`.
- **Fix:** pass `parked`/`active` to both players. MJPEG stops its timer; the iframe unmounts when evicted.
- **Effort:** S.
- **Impact:** removes constant network and decode load from hidden tabs.

**P0-5. The HLS frame check on the main thread.**
- **Problem:** `captureRef` of a TextureView is taken every 6.1 s per playing tile (`StreamTile.tsx:249-275`), then a base64 PNG is inflated in JS (`frameSample.ts`, fflate).
- **Fix:** one app-wide sampler queue that checks one in-view tile at a time, every 15 s. The same dead-stream detection is kept.
- **Effort:** S.
- **Impact:** removes periodic main-thread stalls and GC spikes.

**P0-6. The globe render loop and draw cost.**
- **Problem:** rAF re-arms every frame while mounted, even with `running=false` (`GlobeCanvas.tsx:59-60`). The GLView is built even in REELS mode (`GlobeScreen.tsx:135`).
- **Fix:**
  - Drive the loop from an effect on `running`, and cancel it when false. Mount the GLView the first time GLOBE is shown.
  - Render dirty frames only: full rate while touched or animating, and while drifting at 30 fps as now, but only when the globe is on screen.
  - Merge the 199 `Sprite`s into **one `THREE.Points`** with `size`/`phase` attributes, and move the pulse into a small shader (`globeScene.ts:159-166,228-235`). ~205 draw calls → ~6, and the per-frame JS loop over 199 markers goes away.
  - Hide the back hemisphere with a normal·view test in the shader, **not the depth buffer**, which is broken on this GPU (see memory and `bafcd89`, which already did this for the onboarding globe; reuse that approach).
  - Android: `msaaSamples={0}` + `antialias:false` with FXAA-free edges (the atmosphere glow hides aliasing), `mediump`, and a drawing buffer at `min(1.5, PixelRatio)`. Keep 3,400 stars but merge them into one `Points` (they already are), sphere segments 72 → 48. Nothing visible changes at 320 px.
  - Wrap `createGlobeScene` in try/catch. On failure, show the static `earth-night.jpg` with markers as a 2D fallback, never black.
- **Effort:** L.
- **Impact:** the JS thread is freed on every tab (no 60 Hz wakeups). The globe actually renders on the P35, at 60 fps while dragging.

**P0-7. Reels "PULLING SIGNAL…" can hang forever.**
- **Problem:** Seeding only happens on `onPostsChanged` while `live` is true (`ReelsView.tsx:141-166`). `pullReelPage` fails silently (`reels.ts:162`). PeerTube detail calls run one after another (`reels.ts:85-87,109-110`).
- **Fix:**
  - Seed whenever `live` becomes true.
  - Add a status machine (loading → content | empty | error): after 10 s or on a failed pull, show "NO SIGNAL · TAP TO RETRY" and back off 5/15/45 s.
  - Run PeerTube detail calls in parallel (`Promise.allSettled`, 4 at a time) and race the sources, so the first playable reel renders as soon as any source answers.
  - Read `void_globe_mode` from the sync store so `mode` is never null on first paint (`GlobeScreen.tsx:38,128`).
- **Effort:** M.
- **Impact:** no permanent spinner. First reel shows 2–6 s sooner on 4G.

**P0-8. No network deadlines, so the app locks for the whole session.**
- **Problem:** No timeout on the proxy, Bluesky, Reddit, Supabase REST, reels or composer calls (full list in §7-A). `feedLoading`, `_reelLoading` and `dropping` then never reset.
- **Fix:**
  - One `fetchWithTimeout` inside `env.fetch` (`src/lib/core.ts:117`) with a 10 s default. Reuse `nfFetchJson`'s AbortController pattern (`core/util.ts:67-75`). Uploads get 60 s, progress-aware.
  - Every lock is released in `finally` or on abort.
- **Effort:** S–M.
- **Impact:** on bad networks, the app recovers instead of dying. TAP TO RETRY works again.

**P0-9. Cold start blocks on the network, and the splash holds everything.**
- **Problem:** The splash waits up to **3 s** on `ensureCore` (`core.ts:132`), after a full AsyncStorage read (`core.ts:29-40`, ~340 KB of seen-sets alone), with a forced token refresh on every launch (`auth.ts:127`).
- **Fix:**
  - Hide the splash after the local hydrate + theme + fonts. `ensureCore` and the refresh continue in the background; screens already handle a signed-out core.
  - Hydrate only the startup keys (an allowlist, as `coreBridge.ts:37,110` already does). Load the seen-sets and `vc_*` keys lazily.
  - Refresh only when the token is within 5 minutes of expiry.
- **Effort:** M.
- **Impact:** up to 3,000 ms off cold start on bad networks, plus ~100–300 ms of JSON parsing.

**P0-10. The startup bundle graph.**
- **Problem:**
  - `app/_layout.tsx:19-20` imports the `features/live` and `features/photo` barrels (WebView, expo-video, fflate, PhotoViewer, ModerationSheet).
  - `core/index.ts` `export *` pulls in ~373 KB of generated data (`iptv.generated.ts` 261 KB, `life.generated.ts` 65 KB).
  - `metro.config.js` has no `inlineRequires`.
- **Fix:**
  - Import `AudioOwnerProvider` and `registerPhotoViewer` from their own files, not the barrels.
  - Make `iptv`/`life`/`streams` data lazy (`require` on first wall build), or ship them as JSON assets parsed on demand.
  - Turn on `transformer.getTransformOptions → inlineRequires: true`.
  - Stop re-exporting data from `core/index.ts`.
- **Effort:** M.
- **Impact:** measured by Hermes startup trace in step 0. Expect 200–600 ms less time to interactive on the P35.

**P0-11. Tabs are never frozen.**
- **Problem:** `app/(tabs)/_layout.tsx:17` has no `freezeOnBlur`.
- **Fix:** `freezeOnBlur: true`, together with P0-2/P0-6 so native players stop too.
- **Effort:** S.
- **Impact:** hidden tabs no longer re-render on store pushes. Tab switches feel instant.

**P0-12. The release build is not optimised (APK 100.8 MB).**
- **Measured:** 61.1 MB of dex across **6** dex files (no R8), 37.4 MB arm64 + 25.2 MB armv7 of native code in one universal APK, `libbarhopper_v3.so` + barcode models ≈ 9 MB even though `barcodeScannerEnabled:false`, and `expo-camera` with **zero JS imports**.
- **Fix:**
  - In `expo-build-properties.android`, set `enableMinifyInReleaseBuilds: true` and `enableShrinkResourcesInReleaseBuilds: true`, with keep rules for the sensing module, ML Kit and Reanimated.
  - Remove the `expo-camera` package, but **keep its permission strings** by moving them into the sensing module's `app.plugin.js`, which already owns CameraX. That drops the barcode ML.
  - The Play release is already an AAB, so it splits per ABI; for the preview APK, build arm64-only.
  - Remove `expo-sharing` (unused).
- **Effort:** M (R8 keep rules need a device test).
- **Impact:** expected ~100 MB → ~35–45 MB APK. Faster install, class loading and cold start (fewer dex files to map).

### P1 — Excellence gap (from "works" to "instant")

| ID | Item | Files | Fix | Effort | Impact |
|---|---|---|---|---|---|
| P1-1 | Card paint cost | `features/feed/PostCard.tsx:72-79,106-131`, `AudioPill.tsx:63-95` | Replace the 30 px blurred `boxShadow` + inset shadow with a pre-rendered 9-slice shadow image, so it looks the same with no runtime blur. The per-card Reanimated fade becomes `entering={FadeIn}` (layout animation, runs once, no persistent shared values). | M | Removes per-frame blur composites while scrolling; fewer UI-thread commits. |
| P1-2 | Global re-render fan-outs | `feed/reactions.ts:26`, `audioStore.ts:98-154`, `AudioPill.tsx:37` | Per-post subscription (`subscribe(postId)`) instead of a global version; `usePillTick` only for the playing pill id. | S | A reaction or an audio tick re-renders 1 component, not every card. |
| P1-3 | List engine | `features/feed/VoidFeedScreen.tsx`, reels, nation lists | Adopt `@shopify/flash-list` v2 (cell recycling; built for the new architecture). Drop the `index` prop so trimming the head doesn't re-render every card (`VoidFeedScreen.tsx:69-75`). Header hide via `useAnimatedScrollHandler` instead of JS `onScroll` at 16 ms. | M | Fewer mounted views; scroll stays on the UI thread. |
| P1-4 | Reanimated sync props | `package.json` → `"reanimated": {"staticFeatureFlags": {"ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS": true}}` | Test for regressions on the P35. | S | Animated opacity/transform skip the ShadowTree commit + layout pass per frame. |
| P1-5 | AudioOwner context churn | `features/live/AudioOwner.tsx:220`, `StreamTile.tsx:245` | Split into a stable actions context and an `audibleId` store selector; drop `audio` from `HlsPlayer`'s effect deps. | S | Tapping for sound doesn't re-subscribe every tile. |
| P1-6 | Feed images decoded at full size | `core/feed/bluesky.ts:79` | Use `thumb` in the feed and `fullsize` only in `PhotoViewer`; set the expo-image disk cache limit. | S | Big cut in image memory and bandwidth. |
| P1-7 | Offline and resume | new `src/lib/net.ts` (NetInfo), `core.ts:94-100` | Global offline banner; pause polls while offline; on reconnect re-run `pull`/`pullReelPage`/`loadConversations`; on foreground after more than 10 min show a "NEW SIGNAL" pill; retry `_sb` once on 401 after refresh (`voidApi.ts:27-33`). | M | No dead screens on the subway. |
| P1-8 | Error boundaries + crash reporting | `app/(tabs)/_layout.tsx`, `reels.tsx`, `thread/[id].tsx`, `nation/[iso].tsx`, one boundary per `StreamTile`/`GlobeCanvas` | Themed "SIGNAL LOST · RETRY" boundary; add `@sentry/react-native` (with ANR and slow-frame tracking). | M | One bad tile no longer kills the app; you can see real-world crashes. |
| P1-9 | Proxy hardening (feeds the whole app) | `proxy:649-658,757-762,770-828,863-898` | Single-flight cache (store the promise); stale-while-revalidate; never cache empty results; `AbortSignal.timeout(4000)` on every upstream; whitelist `mode`/`country` + an LRU; `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` + gzip; Cloudflare in front; 503 + `Retry-After` on failure instead of `200 {items:[]}`; `keepAliveTimeout 65000`. | M | The feed's first request goes from seconds to ~50 ms from the edge; the origin sees ~3 rpm per key regardless of user count. |
| P1-10 | Feed DB index | new `sql:008_perf.sql` | `create index on posts (created_at desc) where reply_to is null and hidden_at is null;` plus `(reply_to, created_at)`. | S | Full scan → index scan on every feed open. |
| P1-11 | DM polling → realtime | `messages/dmStore.ts:94-266`, `ChatScreen.tsx:75`, `MessagesScreen.tsx:42`, new RPC `dm_inbox()` | One Supabase Realtime channel per user plus a `dm_inbox()` RPC (one row per conversation, unread counted in SQL). Meanwhile: in-flight guard, backoff, pause in background. | L | ~4.5k rps at peak at 1M DAU → roughly 0 polling; the badge updates instantly instead of up to 60 s late. |
| P1-12 | Nation screen fan-out | `core/feed/nation.ts:160-259,488-539`, `core/streams/nation.ts:62` | Add a proxy `/nation/:iso` aggregate (SepiaSearch, archive.org, Commons, GDELT, Mastodon, Lemmy, radio) with a shared 5 min cache; the phone makes 1–2 requests instead of 40 or more. Remove the dead `/streams` call (404). | L | Nation first content 3–8 s → under 1 s; per-IP bans avoided. |
| P1-13 | Reels fan-out | `core/feed/reels.ts:50-164` | Same move: a proxy `/reels` endpoint that returns resolved, CORS-checked playable URLs, cached. | M | First reel renders almost instantly; no dead cards. |
| P1-14 | Auth robustness | `features/auth/coreBridge.ts:78-81`, `core/api/media.ts:41-43`, `core.ts:137` | Wipe the session only on `invalid_grant`; one in-flight lock on `signInAnonymously` (today the DM poll and first launch can create two accounts). | S | No silent logouts or duplicate accounts on flaky networks. |
| P1-15 | Supabase posts cursor | `core/api/voidApi.ts:94` | `created_at,id` keyset cursor. | S | Void posts older than the newest 40 become reachable. |

### P2 — Compounding debt (what hurts at scale, or slows every future change)

| ID | Item | Files | Fix | Effort |
|---|---|---|---|---|
| P2-1 | Unbounded in-memory pools | `core/feed/store.ts:6-10`, `voidFeed.ts:43-52`, `reels.ts:190`, `ReelsView.tsx:102-105`, `useNationFeed.ts:53`, `search.ts:22-80`, `replies.ts:12`, `reelStore.ts:58-61`, `gdelt.ts:23` | `Map` index + LRU cap (1,500 posts; ±20 reels around the cursor; windowed nation list). `findPost` becomes O(1). | M |
| P2-2 | Persisted state growth | `core/rank/seen.ts:38-79`, `replies.ts:223-226`, `moderation.ts:139` | Hash the seen ids (the file header already claims it does); move seen-sets and `vc_*` keys to MMKV or SQLite with a TTL; cap `void_reports_pending`; stop rewriting ~340 KB every 15 s. | M |
| P2-3 | Tests, typecheck and lint are never run | `package.json`, `.github/workflows/*` | Add `"test": "node --test …"` and `"typecheck"`; add ESLint (expo config); run all three in CI before `android-aab`; fix the yarn vs `package-lock.json` mismatch (use `npm ci`). | S |
| P2-4 | Four ~1 MB copies of the web app | `void2-final.html`, `copy33thevoid.html`, `void-app/assets/void.html` (unreferenced), `void-proxy/public/*.html` (not served) | Keep `void2-final.html` as the single source; delete the unused copies; the build script generates the rest. | S |
| P2-5 | Two session stores | `lib/supabase.ts`, `core/api/auth.ts:31`, `coreBridge.ts` | Make supabase-js the only store (with a SecureStore adapter, see S-2); the core reads from it. | M |
| P2-6 | 122 empty `catch`es / 113 `as any` | repo-wide | Route every catch through `report(e, ctx)` (Sentry breadcrumb); remove `any` in the `core/api` types first. | M |
| P2-7 | Reactions hot rows | `sql:001:147-169`, `006:270-282` | Counter table + periodic rank roll-up; TTL/partition on notifications. | M |
| P2-8 | Profile counts pull 2,000 rows | `features/profile/ProfileScreen.tsx:73-74` | `Prefer: count=exact`, `limit=0`. | S |
| P2-9 | Proxy state won't scale horizontally | `proxy:196,412,649,683` | Redis for the cache, X budget and Reddit token (or one origin behind the CDN); X budget reserved before the call, not charged after. | M |
| P2-10 | Dead code | unused barrels (`ui/index.ts`, `nav/index.ts`, most `features/*/index.ts`), `ScreenPlaceholder.tsx`, empty `native-modules-disabled/`, duplicate mod icon sets (`reels/ModIcons.tsx` vs `feed/vmodIcons.tsx`), polyfill regex bug (`lib/polyfills.ts:14`) | Delete or merge. | S |
| P2-11 | view-shot + fflate for a 32×18 pixel check | `live/frameSample.ts:19-29` | After P0-5, replace with an `expo-video` player status/stall heuristic (bitrate / `timeUpdate` stalls) and drop both deps (3.6 MB of node_modules). Same dead-stream detection. | M |

### Security & data (App Review blockers first)

| ID | Sev | Item | Fix | Effort |
|---|---|---|---|---|
| S-1 | P0 | OAuth callback accepts any token (login CSRF / session injection) — `app/auth-callback.tsx:22-28`, `core/api/auth.ts:109-119` | PKCE (`flowType:'pkce'`, `exchangeCodeForSession`); act only on a pending nonce set before `openAuthSessionAsync`; never overwrite a non-anonymous session without confirmation. | M |
| S-2 | P0 | Tokens in plain AsyncStorage + `allowBackup` defaults to true — `lib/supabase.ts:19`, `auth.ts:31`, `authActions.ts:198-199` | SecureStore adapter; drop the duplicate `void_sb_session`; delete `void_apple_*` on sign-out; `"android": {"allowBackup": false}` (this also fixes the "fresh install isn't fresh" problem noted in memory). | M |
| S-3 | P0 | Apple tokens never revoked on account delete (App Review 5.1.1(v)) — `DeleteAccountSheet.tsx:81-86`, `functions/delete-account/index.ts:96-101`, `coreBridge.ts:45-46,103` | An Edge Function exchanges `authorizationCode` at sign-in and stores the refresh token server-side; `delete-account` revokes it. | M |
| S-4 | P0 | Privacy manifest incomplete (photos/videos, audio, DMs, diagnostics via expo-observe); `privacy.html:51` says "no analytics" | Add the data types and match the App Store label; disclose EAS Observe (and Sentry once added). | S |
| S-5 | P1 | Proxy abuse: spoofable XFF rate limit, `/translate` unused but open, free-form cache keys, X query injection via `country` — `proxy:519,649,679,752,777,800,807` | Covered by P1-9, plus: remove or JWT-gate `/translate`; strip operators from `country`; rate-limit on the trusted hop. | S |
| S-6 | P1 | Three anonymous accounts can auto-hide any post — `sql:006:204-222`, `supabase/config.toml:213-216` | Count only non-anonymous reporters, or those with account age over N days; captcha (Turnstile) on anonymous sign-up; per-user insert rate limits. | M |
| S-7 | P2 | WebView hardening — `ytHtml.ts:79-103`, `StreamTile.tsx:524-533`, `core/streams/keys.ts:15` (unanchored allowlist) | Exact hostname match; `onShouldStartLoadWithRequest`; `mixedContentMode:'never'`; no third-party cookies for iframe cams; `youtube-nocookie.com`. | S |
| S-8 | P2 | `Linking.openURL` with any scheme (`ThreadScreen.tsx:314,435`); media URL check allows any host (`sql:007:165-167`); email sign-in falls through to sign-up (`authActions.ts:103-109`); `/health` leaks config (`proxy:812-820`); `void_supabase_*` storage override (`core/env.ts:93-95`) | Allow only https; pin the storage host; split sign-in from sign-up; slim `/health`; strip the override from production. | S each |

---

## 5. Targets and how each is measured

| Target | Measured by | Gate |
|---|---|---|
| Cold start < 2 s (P35: aim < 3 s) | `adb shell am start -W -n com.thevoid.app/.MainActivity` (TotalTime), 5 runs after `am force-stop` | median |
| 60 fps / no jank | `node scripts/perf-android.mjs` (gfxinfo janky %, frame p50/p90/p99) per screen: feed scroll, GLOBE + wall, REELS, nation | P35: janky < 10% on the feed, p90 < 32 ms |
| Input < 100 ms | tap → first frame via `adb shell input tap` + a gfxinfo timestamp; Sentry INP-style spans once added | p90 |
| Memory | PSS from `perf-android.mjs` after a 10-min soak across all tabs | < 400 MB on P35, no growth trend |
| Leaving globe tab releases resources | WebView process CPU and PSS 10 s after switching to the feed | WebView CPU ≈ 0 |
| No ANRs | `adb shell dumpsys dropbox --print data_app_anr` after the soak | zero new entries |
| APK size | `ls -la` of the preview APK; `unzip -l` breakdown | < 45 MB |
| Bad network | Android dev option "Network speed: EDGE" / airplane toggle mid-pull | every screen reaches content or a retryable error within 12 s |

## 6. Sequenced execution plan (each step shippable and measurable on its own)

Branch: `perf/mobile-fixes`. Other sessions share this checkout: check `git status -sb` before each commit, and **don't** stage the unrelated uncommitted web-reel edits in `void2-final.html` and its copies. One commit per step. After each step: typecheck, run the golden tests, build the preview APK (`gh workflow run android-aab.yml --ref perf/mobile-fixes -f profile=preview`, ~36 min, so batch 2–3 steps per build), install over adb, then run `perf-android.mjs` and record the numbers in a table at the bottom of `PERFORMANCE_AUDIT.md`. Check the phone is idle (`mResumedActivity` is the launcher) before driving it.

0. **Baseline + audit file.** Write `PERFORMANCE_AUDIT.md`. Capture the baseline on the current APK: cold start ×5, per-screen jank/PSS, ANR dropbox, and a Hermes startup profile (`--profile-hermes` on a release build is not possible, so use `Observe` TTI marks plus `am start -W`). Add `test`/`typecheck` scripts (P2-3) so every later step is verified.
1. **Freezes.** Cherry-pick `cce6c2d`; P0-1 (b–g), including the player release queue and rasterised static icons; P0-5. → ANR count goes to 0, UI thread CPU falls.
2. **Stop invisible work.** P0-11 `freezeOnBlur`; P0-2 wall teardown + budget; P0-4 MJPEG/iframe parking; P0-6 part 1 (rAF on `running`, lazy GLView). → WebView CPU ≈ 0 off the wall, PSS falls.
3. **Wall first paint.** P0-3 poster-first YouTube tiles + the message-loop fix. → the wall paints instantly, JS thread is quiet.
4. **Globe draws, and draws cheaply.** P0-6 part 2: Points markers with a shader-based back-face test, buffer/MSAA settings, try/catch fallback. → the globe renders on the P35 at 60 fps while dragging.
5. **Never stuck.** P0-8 fetch deadlines and lock release; P0-7 reels status machine, parallel sources, sync mode read. → a bad-network pass on every screen.
6. **Cold start.** P0-9 splash no longer waits on the network, key allowlist hydrate, conditional refresh; P0-10 barrel/import fixes, lazy data, `inlineRequires`. → `am start -W` median, compared with the baseline.
7. **Lean binary.** P0-12 R8 + shrink + keep rules, move camera permissions into the sensing plugin and remove `expo-camera`/`expo-sharing`, arm64-only preview. Smoke-test sensing, the composer camera, ML Kit and Reanimated on the device. → APK size, cold start.
8. **Security blockers.** S-1, S-2 (incl. `allowBackup:false`), S-3, S-4. → re-test sign-in (Apple/Google/email/anon), deep links, delete account.
9. **Scroll excellence.** P1-1, P1-2, P1-4, P1-5, P1-6, then P1-3 (FlashList). → feed jank %, p90 frame time.
10. **Resilience.** P1-7 NetInfo/resume, P1-8 boundaries + Sentry, P1-14 auth robustness.
11. **Backend for scale.** P1-9 proxy hardening + CDN, P1-10 indexes, P1-15 cursor, S-5; then P1-12 nation aggregate and P1-13 reels endpoint on the proxy; then P1-11 DM realtime + `dm_inbox()`. Each is a separate deploy with a before/after latency comparison (proxy logs and Supabase query stats). Supabase migrations need the user's access token each time, so ask then.
12. **Debt.** P2-1, P2-2, P2-4 to P2-11, S-6 to S-8, in any order, each its own commit.

## 7. Appendix

**A. Calls with no timeout** (fixed by P0-8): `core/feed/proxy.ts:37,48`, `bluesky.ts:122`, `reddit.ts:49`, `gdelt.ts:31`, `reels.ts:50,80,104,143`, `api/voidApi.ts:20,29,95,138`, `api/auth.ts:40,95`, `api/media.ts:72,121,132`, `api/replies.ts:43`, `features/feed/translate.ts:46`, `profile/profileApi.ts:18`.

**B. Polling load at 1M DAU today** (fixed by P1-11 and P1-14): DM badge ~1.05k rps average / 3.1k at peak (up to 50k if timers run in the background); messages list ~280 / 830; chat ~100 / 300; token refresh ~45 / 130. Total **≈1.5k rps average / 4.5k rps at peak**, ~240 rps of them 500-row reads with per-row RLS function calls.

**C. APK breakdown** (100.8 MB, 141 MB uncompressed): dex 61.1 MB (6 files); arm64 libs 37.4 MB; armv7 libs 25.2 MB; ML Kit face detector 13.9 MB + models ~4 MB (keep: body signals); barcode `barhopper` 8.1 MB + models 0.9 MB (unused); JS bundle 6.2 MB (Hermes bytecode, fine); `res/V6.ttf` 966 KB (identify the dependency).

**D. Already done (do not redo):** `b506428`: FlatList windows 3, `removeClippedSubviews`, expo-image downscale/recycle, wall constants 1/2/8, bundled 2048 globe texture. `cce6c2d` (on `onboarding`): loader pause. `bafcd89` (on `onboarding`): depth-independent globe occlusion, the pattern for P0-6.


## 8. Measurements log

Test phone: Helio P35 (MT6765), Android 11, 4 GB class, announces as SM-S938B. Tools: `am start -W` (cold start, after `am force-stop`), `scripts/perf-android.mjs` (gfxinfo, per-thread CPU, PSS), `dumpsys dropbox` (ANRs).

| Step | Build | Cold start median (ms) | Feed janky % / p90 | Globe+wall janky % / p90 | PSS after soak (MB) | WebView CPU off-wall | ANRs | APK (MB) |
|---|---|---|---|---|---|---|---|---|
| Baseline (09-20/21 perf-android.mjs; cold start 09-22) | installed v9 (1.0.0), installed 09-22 00:26 | 3,637 (runs: 6,404 / 3,637 / 3,296 / 3,347 / timeout >10,000); first frame only, time to feed content is later | 100% / 250 ms–5 s | 100% / globe never rendered | 650–826 | ~107% on globe tab | 5 (09-20 → 09-21) | 100.8 |

**Scripted route** (same taps and timing every run, driven over adb): feed idle 15 s → feed scroll 6 swipes → GLOBE 40 s → REELS 20 s → back to feed 36 s. Averages from `perf-android.mjs --every=3`.

| Build | feed jank / p90 | scroll jank / p90 | GLOBE jank / p90 / WebView CPU | REELS | back on feed (WebView CPU) | Notes |
|---|---|---|---|---|---|---|
| Before (installed 09-22 01:03, pre steps 1–4) | 100% / 550 ms | 100% / 154 ms | 100% / 1,650 ms / 54% | — | — | Globe drew nothing (black), all tiles CONNECTING; the app was killed by the system (`signal 9`) during GLOBE, so REELS/back were not reached |
| Steps 1–4 + player cap + buffer caps (09-22 16:18) | — (fresh install: feed never loads, see below) | 99% / **27–38 ms**, p50 21–27 ms | 100% / 150–450 ms; globe renders | — | **WebView CPU 0%, PSS flat ~318 MB** over 70 s | Off the wall the app is finally quiet: no decoders, no WebView CPU, no memory growth. ON the wall with 8 tiles in view it is still ~765 MB: `dumpsys meminfo` attributes 288 MB to EGL + 60 MB GL, i.e. the simultaneous decoders themselves, not the WebView count. |
| Steps 1–4 (09-22 14:28) | 75% / 450 ms | 99% / **41 ms** | 100% / **800 ms** / 82% | 100% / 667 ms | not reached | **The globe renders** (was black) and the wall fills with live video. But PSS climbed to 933 MB and Android killed the app ~5 s after leaving the wall, before the 20 s sleep could run: only WebView players were capped, and a paused off-screen HLS tile still holds its decoder. Fixed by MAX_MOUNTED_PLAYERS (next build). Cold start unchanged at 3.55 s median (startup is step 6). |


### Open after steps 1–4

1. **The wall's memory is the number of tiles decoding at once.** With 8 tiles in view: EGL 288 MB + GL 60 MB of ~765 MB total. Capping mounted players helps only off-screen ones, because every tile in view keeps playing by design. Options, in order of preference: cap the tiles that *play* at once (say 4) and rotate them, with the rest holding their poster or last frame; or move wall tiles to a `SurfaceView` (video composited outside the app's EGL memory, but it breaks rounded corners, overlay z-order and the colour-bar check); expo-video exposes no way to force a lower-resolution track (`videoTrack` is read-only).
2. **Fresh install has no feed.** After `adb uninstall`, the app sits on "SCANNING VERIFIED PUBLIC SOURCES…" indefinitely with the network fine — the failure mode P0-8 predicts (no request has a deadline). Step 5.
3. **The body-signals consent sheet reappears on every launch** once app data is cleared, and it renders over everything while the screens behind it stay in the accessibility tree.
4. **The earth texture fails on this device** (GL 1282, seen by the session on `fix/globe-wall-only`), so the globe draws with the flat fallback map. The globe itself now renders, where it was black before.
5. **Cold start unchanged** (3.55 s median): step 6.
