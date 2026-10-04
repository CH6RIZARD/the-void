# PERFORMANCE_AUDIT_3 — synthesis of the 2026-10-04b audit pass

Branch `web/parity` @ 71aa593. Four parallel lanes (render cycles, async/threads, memory retention, payloads/scale) audited read-only against E:/void-main/void-app, void2-final.html and the deployed Railway proxy. Prior audits (PERFORMANCE_AUDIT.md, PERFORMANCE_AUDIT_2.md) were read first; recently-fixed items (wall decoder oversubscription, rendition floor, muted-tile audio decoders, player budget at rest, scroll fling holiday, settle-gated packing, nested-worklet crash class, feed/profile blur release, globe worklet rebuild) are NOT re-raised. `[STILL OPEN]` marks a prior finding verified unfixed. Every item carries file:line evidence from the lane reports.

Companion: `CODE_QUALITY_AUDIT.md` (same folder) for architecture/debt. `README.md` has the one-page index, scaling-playbook verdicts, and the full ranked roadmap.

---

## CRITICAL

### MEM-1 / ASYNC-9 — [STILL OPEN M1] Store trim bypassed on the production path; `_offFeed` posts immune everywhere (MEM-2)
`src/core/feed/voidFeed.ts:27-37` — `pullVoidFeed()` returns `'ok'` at :31 inside the `if (env.proxyBase)` branch, before `trimStore(new Set(_rendered))` at :36. trimStore is the ONLY caller of the store ceiling; `refreshVoidFeed` (:106-128) and `pullSupabasePosts` (:160-175, 40 rows per 20s) never trim either. With a proxy configured (the shipped config), `allPosts` and `reelPosts` grow for the whole session; every `peekFeedFresh`/`unseen()`/`findPost`/`syncReplyCount` scan grows with them. `store.ts:21-27` documents the measured consequence class: "switching to the VOID tab blocked 2s early on and 9s a few rounds later."

Worse: `store.ts:39` — `trim()` unconditionally skips `p._offFeed`, and every nation deal pushes dealt posts into allPosts with that flag (`nation.ts:443-444`, 16+/deal; `search.ts:172` same for opened search cards). Nothing clears the flag. Nation browsing converts the "bounded" ceiling into a floor that only rises, even where trim runs.

**Fix:** move `trimStore` into a `finally` in pullVoidFeed (runs on every path), call it from refreshVoidFeed/pullSupabasePosts; give `_offFeed` posts an LRU budget (~200) in trim(). STORE_MAX (600/300) already exists — only the call sites are wrong. One-liner + small LRU. *(Check the concurrent implementer hasn't already landed this.)*

### NET-1 / SCALE-1 — [STILL OPEN P1-9] Proxy: no gzip, no cache headers, no single-flight — the Reddit stampede is what kills the feed first at scale
`void-proxy/server.js:821-826` — `sendJson()` sets only CORS + Content-Type (verified live: no `content-encoding`, no `cache-control` on /feed). `cached()` at :651-658 stores the resolved value, not the promise, so every request arriving while the 60s TTL is expired re-runs `aggregateGlobal` — 12 Reddit calls each (:232-241, :336-344) — and the app's mode rotation (`src/core/feed/proxy.ts:35-41`) keeps 3 pools hot. At 1M DAU the 60s cache-expiry stampede blows the 100 req/min Reddit OAuth quota within minutes → 429 lockout → empty pools → per-phone www.reddit.com fallback that 403s carrier-NAT users. Independent of bandwidth; ~700GB/day of uncompressed origin egress on top.

**Fix (hours, all in `cached()`/`sendJson()`):** store the in-flight promise (single-flight), serve stale-while-revalidate, add `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`, gzip when Accept-Encoding allows (OkHttp auto-inflates). Then Cloudflare free in front: origin becomes ~3 req/min/mode regardless of users. This one change removes failure modes 1 and 3 of SCALE-1.

---

## HIGH

### ASYNC-1 — [STILL OPEN] Feed shared players built synchronously, bypassing the paced create queue and the decoder cap
`src/features/feed/videoStore.ts:30` — `acquire()` calls `createVideoPlayer({uri})` directly inside the useSharedPlayer effect (:85), not via `enqueueCreate`. `pacedPlayer.ts:41-47` admits feed players are never counted into liveCount, so they're invisible to CREATE_CAP (:148) and healVisible's pressure gate (LiveWall.tsx:281). pacedPlayer.ts:106-118's own comment documents 20-60ms+ per synchronous ExoPlayer build on the JS thread; `PostMedia.tsx:62-63` can flip several cards' `wantPlayer` in one viewability commit. Release side IS paced (videoStore.ts:58) — only creation isn't.

**Fix:** route acquire() through enqueueCreate and count into liveCount/counted (~15 lines in videoStore.ts + one export from pacedPlayer.ts). Removes scroll-time JS stalls AND the decoder-budget bypass on the MediaTek clones.

### ASYNC-2 — [STILL OPEN F19/P0-10] Boot evaluates three.js, ~2.7MB of base64, the live-wall barrel and 302KB stream tables before first paint
`app/_layout.tsx:8` statically imports `textures.ts` → `* as THREE` (:14) + EARTH_PNG_B64 (765,805B file) + EARTH_Z (1,990,446B) + fflate; `_layout.tsx:69` imports AudioOwnerProvider via the live barrel (pulls LiveWall/StreamTile/WebView graph); `lib/core.ts:19` → core barrel → `data/sources.ts` builds the 302KB iptv tables at eval. `metro.config.js` has no getTransformOptions override and the Expo default is `inlineRequires:false` — so all of it runs on the splash path, defeating the deliberate deferred `require('globeScene')` at _layout.tsx:129-145 (three.js is already paid up front).

**Fix:** (a) lazy-require textures inside the useWarmEarthTexture timer; (b) import AudioOwnerProvider from `./AudioOwner` directly; (c) A/B `inlineRequires:true` in metro.config.js on device. Pairs with ARCH-7/Q4 (delete the dead globeScene prefetch — see CODE_QUALITY_AUDIT).

### ASYNC-3 — [STILL OPEN F28-adjacent] First feed pull normalises ~100 posts in one unmarked tick — best candidate for the 416+359ms post-boot:ready stalls
`src/core/feed/proxy.ts:40-42` — limit=100 fetch, synchronous `.map(proxyPostToApp)`; each post runs inferTags' ~351 individually compiled regexes (`src/core/rank/tags.ts:56-64,82`), two unicode `_normText` passes (`seen.ts:55-58`), then O(n²) `spreadSubjects` with uncached subjectOf (`order.ts:19-35`). ~35k+ regex executions in one tick on a Helio-class JS thread, with NO `mark()`/`timed()` around it — which is why three audits attributed it to "idle."

**Fix:** mark('feed:normalise') to confirm on device; one alternation RegExp per tag (351 → ~20 tests/post); slice the 100-post loop across ticks (wall's loadBatch pattern exists); cache `p._subj`.

### R2R3 / ASYNC-7 — [STILL OPEN F13/P1-2] Reaction store global version: one bolt re-renders every mounted PostCard on every surface
`src/features/reels/reelStore.ts:36-49` — module-global `version` + `bump()` notifying all listeners; fires in toggleBolt (:79,:83), toggleRepost (:100,:104), toggleFollow (:125,:128). `reactions.ts:26` `usePostReaction` → `useReelStoreVersion()`; PostCard.tsx:67, ThreadScreen.tsx:77, ReelsView.tsx:92 all consume. With `freezeOnBlur:false` on all tabs (`app/(tabs)/_layout.tsx:30`) the fan-out reaches hidden tabs. The per-post listener map the fix needs already exists in the same file (`reactions.ts:15-22`). This is the "taps feel heavy" path.

**Fix:** bump(postId) → per-id Set; separate per-handle channel for toggleFollow. ~half a day, no behavior change.

### R1 / ARCH-13 — [STILL OPEN F22/P1-5] AudioOwner context rebuilt on every audibleId change, re-rendering every consumer
`src/features/live/AudioOwner.tsx:223-226` — `value = useMemo(..., [audibleId, ...])`. Consumers: every StreamTile (:149,295,681), LiveWall.tsx:676, the whole NationScreen (:45), every AudioPill via useClaimAudio (:257-260), ComposerSheet.tsx:44-50, reels. One tap-for-sound commits re-renders on exactly the frame the user expects instant audio feedback.

**Fix:** split into a stable actions context (all already useCallback-stable) + an audibleId store exposed as `useIsAudible(id)` via useSyncExternalStore (the per-id pattern is already in-repo at placementStore.ts). ~half a day.

### F16 — [STILL OPEN, mutated] Search signature embeds liveCursor, so every search-data event resets the list to 4 blocks and re-keys live WebView slots
`src/features/search/searchModel.ts:171` — `sig = filter + '|' + q + '|' + liveCursor + '|' + ids`; :182 `advanceLive(LC, 3)` runs on EVERY build, so sig N+1 never equals sig N. `SearchScreen.tsx:87-94` resets `setShown(FIRST_PAINT)` (4) on mismatch; featured-tile keys rotate (searchModel.ts:185), remounting up to 3 live WebViews — decoder/FD churn on phones that crash at fd 1024, plus a scroll jump mid-use.

**Fix:** compute sig without liveCursor; advance the cursor only on real refocus; keep `shown` when the id list is a superset. ~2 hours.

### F14 / ASYNC-5 / NET-3 — [STILL OPEN P1-11] dmStore: whole-snapshot emits, overlapping polls, 500-row reads, no AppState gate on the 60s badge poll
`dmStore.ts:26-36` — emit() always builds a new snapshot; whole-store subscription (MessagesScreen.tsx:84, ChatScreen.tsx:43). pollChat emits unconditionally every 5s with a NEW conv object (:210-216) → all ~200 bubbles re-create with zero new messages. `startDmBadgePoll` (:256-262, mounted app-wide at `app/(tabs)/_layout.tsx:11`) fires every 60s with no AppState gate; loadConversations = 4 REST calls incl. `messages?limit=500` full bodies (:109-111) parsed in one gulp, no in-flight guard, so the 15s focused poll (MessagesScreen.tsx:92-99) double-fetches every minute. At 1M DAU: ~1.5-4.5k rps against Supabase, much of it 500-row RLS-checked reads, 1,440 polls/day even backgrounded.

**Fix now (lines):** AppState gate in the badge timer; in-flight promise guard; skip emit when nothing changed; slim the badge query to `select=conversation_id,created_at,sender_id&created_at=gt.<last_read>`. Real fix stays P1-11: Realtime channel + dm_inbox() RPC.

### MEM-5 — [STILL OPEN P2-2] AsyncStorage grows without expiry and the boot hydrate pins the whole store in JS memory
`lib/core.ts:43-61,141-142` — hydrate() getAllKeys+multiGet of EVERYTHING into a session-long Map; splash gates on it. Growth: one `vc_`/`vcb_` key per thread ever touched (replies.ts:223,226 — deleted only on account deletion), uncapped report queue (moderation.ts:139), `void_seen_ids` ~4000 RAW ids (~200-300KB; only text/link are hashed despite seen.ts:8-9's claim) rewritten every 15s while dirty.

**Fix:** post-hydrate sweep (TTL vc_*/vcb_*, cap reports), hash seen ids like text/link (also shrinks the 15s rewrite ~5x). Longer term: allowlist hydrate + lazy vc_* per thread.

### NET-2 — [STILL OPEN, partial] /streams/health: full-table re-serialize per request, no gzip/ETag, and the table lives in /tmp so deploys wipe it
`server.js:919-937` rebuilds + JSON.stringifys per GET (mutating entries inside the GET loop at :924). Cache-Control max-age=60 landed (:936) — but no gzip, no ETag/304, and STREAM_HEALTH_FILE defaults to `/tmp` (:753) — verified live: endpoint returns 3KB today because the redeploy wiped the seeded table, so the wall regresses to burning 5.5s lane timeouts on dead streams until clients re-teach it.

**Fix:** serialize+gzip once on write (table only changes in /streams/report), serve cached buffer + ETag/304, max-age=600 to match the client's 10min cadence; move the file to a Railway volume.

### APK-1 — [STILL OPEN P0-12/F30] R8/minify still off: 58.3MB of dex
APK 94.6MB measured (E:/void-main/tmp apk-b7l): classes.dex..classes6.dex = 58.3MB uncompressed / 22.0MB compressed. No `enableMinifyInReleaseBuilds` anywhere (app.json:113 block has no minify keys); expo-dev-client still in plugins (app.json:111). Expected: dex → ~25-35MB, APK −12 to −18MB. Only payload item needing device re-test (keep rules for sensing, ML Kit, Reanimated, Skia).

### APK-2 / MEM-4 — The earth night map ships FOUR times (~11.3MB uncompressed, 2.63MB = 27% of the Hermes bundle)
EARTH_Z (earthPixels.ts, 1.99MB — the live path, textures.ts:477) + legacy EARTH_PNG_B64 (earthTexture.ts, 766KB, last-resort at :417) + assets/globe/earth-night.rgba.bin (8.39MB — provably unreadable on device per textures.ts:66-68's own comment) + earth-night.jpg (158KB, GL-refused on the MT676x phones per :386-390). **Fix:** keep EARTH_Z + the jpg; delete the .bin require and EARTH_PNG_B64 + its decode path. Install −9.2MB, bundle 9.6→7.0MB, zero behavior change on the measured devices.

---

## MEDIUM

### ASYNC-4 / audiostore-broadcast — Audio pill polls three runBlocking expo-audio getters at 10Hz and re-renders every mounted pill
`audioStore.ts:98-112` — 100ms interval reads `duration`/`currentTime`/`playing`; all three are `runBlocking(main)` on Android (AudioModule.kt:415-451, :940) = 30 JS→main blocking round-trips/s, the exact mechanism the expo-video fix removed (StreamTile.tsx:552-565). Plus set() (:31-34) replaces the whole snapshot so EVERY pill re-renders 10×/s diffing 26 bar Views; AudioPill.tsx:36-37 double-subscribes. **Fix:** event-based playbackStatusUpdate (ComposerSheet already does); per-post snapshot via the translate.ts:15-31 keyed pattern; drop the redundant usePillTick.

### ASYNC-6 — [STILL OPEN F20, narrowed] Sensing: 100 sensor callbacks/s on the Android main looper; context sensors start without a consent gate
`MotionCapture.kt:96-97` — 3-arg registerListener (no Handler), so 50Hz accel + 50Hz gyro land on the main looper with per-sample allocation (:105-128); `ContextCapture.kt:66-69` registers proximity+light with no consented() check. JS side verified clean (≤0.5Hz change-gated emits, one consumer). **Fix:** 4-arg registerListener with a HandlerThread + maxReportLatencyUs batching; gate contextCapture on its tier. ~10 lines of Kotlin, no behavior change.

### F29a — [STILL OPEN F29] Thread: every keystroke re-renders OP + all comments
`ThreadScreen.tsx:302` — compose `text` on the root; CommentCard memo (CommentCard.tsx:53) defeated by inline closures (:492-495) and a Date.now()-derived `delay` prop (:293,:480); all comments in a plain ScrollView (:353). Typing latency scales with comment count. **Fix:** text state into ComposePill; useCallback the four handlers; freeze deal/delay per comment id in a ref. ~half a day.

### F29b — Chat: up to 200 bubbles in one ScrollView commit, a native LinearGradient per own bubble, re-created every 5s
`ChatScreen.tsx:177-191` over `rows`; fetch limit 200 (dmStore.ts:196); one expo-linear-gradient per own bubble (:116). Compounds F14's unconditional emits. **Fix:** flat backgroundColor (visual delta negligible at bubble size), cap initial render ~50; full fix is inverted FlatList + the dmStore selector work.

### F24-js-onscroll — [STILL OPEN F24] Feed header auto-hide through JS onScroll at scrollEventThrottle 16
`VoidFeedScreen.tsx:239-240`, handler :157-170. Every fling frame pays a JS hop while that thread does cell mounts. **Fix:** Animated.FlatList + useAnimatedScrollHandler worklet. ~2 hours.

### nation-header-churn — Nation header re-renders on every batch; whole screen on every audibleId flip; posts never windowed; removeClippedSubviews under a tall header
`NationScreen.tsx:45` (R1 coupling), :48-50 ctaTick → cards → header memo chain re-rendering NationHero + NationCards per batch; :129 removeClippedSubviews under a tall ListHeaderComponent — the exact combo ProfileScreen.tsx:369-372 documents avoiding; `useNationFeed.ts:53` concat with no FEED_WINDOW-style trim. **Fix:** memo the hero/cards, inherit the R1 split, add a head-trim, verify removeClippedSubviews on the clones. S.

### MEM-3 — [ACCEPTED, now quantified] 8MB decoded earth pixels pinned from boot for every session (+ transient 8MB UI-runtime copy per globe build, ~11MB GPU)
`textures.ts:42,152` bundledCache never freed; `_layout.tsx:54` warms at boot+2.5s globe-or-not; `globeWorklet.ts:129-158` serializes the full 8MB into the UI runtime per rebuild. Deliberate trade — record as a budget line. Cheap wins: warm on first globe intent; null bundledCache after texture upload.

### MEM-6 — Wall session structures only accumulate; `dropPlacement`/`clearPlacement` are imported and never called
`LiveWall.tsx:259` tiles concat (cleared only in build()); build() resets registry but NOT `w.lastGood` (:167) → old ids' StreamSources unreachable-but-retained forever; `placementStore.ts:34-35` current/listeners grow per evicted tile ever, and `applyPlacement` walks the union every 2.5s watchdog tick and every settle. Views/bitmaps ARE bounded by the cull band (F23 fixed) — this is the O(tiles-ever-loaded) CPU residual + ~1KB/tile. **Fix:** dropPlacement in WallTile unmount past the band; clearPlacement() + lastGood.clear() in build().

### MEM-11 / NET-4 — [STILL OPEN P1-6] Feed fetches bsky `fullsize` for card-width boxes; proxy picks Reddit original-resolution previews
`bluesky.ts:79` — `x.fullsize || x.thumb` (measured ~25-30% wasted bytes on the dominant image source); `server.js:313-317` takes `preview.images[0].source` and ignores `resolutions[]` (multi-MB originals for a 170dp card). Decode side already fixed (VoidImage downscaling, b506428) — this is network bytes. **Fix:** thumb for `_img/_imgs`, fullsize only in PhotoViewer; proxy picks the resolutions[] entry nearest 640px.

### NET-5 — X video posts are paid for but shipped unplayable
`server.js:454-457` media.fields lacks `variants`, so :487-488 emits `{type:'video', url:''}` — verified live on the deployed /feed. Up to 1,000 wasted $0.005 reads/day at the cap plus dead cards on the highest-signal items. **Fix:** request variants, pick highest-bitrate mp4, demote to preview image when none.

### NET-6 — [STILL OPEN P1-12/13] Nation and reels fan out from every phone to ~12 volunteer APIs per pull
`nation.ts:506-520` — ~35-60 third-party requests per nation open from the phone; GDELT/archive/Commons rate-limit per IP → carrier-NAT populations get banned collectively. No /nation/:iso or /reels aggregate exists in server.js (:1026). Does not hold at 1M. **Fix:** the already-specified proxy aggregates with a 5-min shared cache.

### DB-1 — [STILL OPEN P1-10/P1-15] Main feed query has no matching index and no keyset cursor
`voidApi.ts:94` — `posts?reply_to=is.null&order=created_at.desc&limit=40`; migrations 001-007 only index the complement (`posts_reply_idx WHERE reply_to IS NOT NULL`). Every app open sorts all top-level posts; older posts unreachable. **Fix:** 008_perf.sql partial index + `created_at=lt.<cursor>` param.

### APK-3 / Q9 — [STILL OPEN P0-12] Barcode ML (4.9MB .so + 881KB models) + expo-camera + expo-sharing shipped, zero JS imports
Drop both packages; move camera permission strings into modules/expo-void-sensing/app.plugin.js (it already owns CameraX). ~5.8MB.

### APK-6 — Production payload after quick wins
Today: preview 94.6MB APK / ~140MB install. After APK-1/2/3/5: Play arm64 download ~35-45MB, install ~95-105MB. Floor = Skia (14.3MB, the locked sparkle loader's price — APK-4, keep) + RN + ML-face (deliberate).

---

## LOW (grouped)

- **useTick-dead-rerender** — `VoidFeedScreen.tsx:58` useTick(30000) re-renders the feed shell every 30s (hidden included) and the ago() labels it exists for never update anyway (PostCard memo). Delete the line.
- **F24-index-prop** — `VoidFeedScreen.tsx:201` index into memoized PostCard; head-trim (:111-120) shifts every index → whole-window re-render spikes; also blocks FlashList recycling (AudioPill.tsx:40 seeds bars from index). Pass `highlight={index===0}` + hash-of-id seeds.
- **profile-memo-gaps** — `ProfileScreen.tsx:377-383` inline renderItem + per-render onPress defeat ProfileTile memo; focus refetch (:154-158) rebuilds Post identities. useCallback + id-join stale-while-revalidate.
- **ASYNC-8** — MJPEG tiles remount a native Image + 2 commits/s while visible (StreamTile.tsx:885-940; parked gating now FIXED). Two persistent Images alternating source props.
- **MEM-9** — hlsVariant caches unbounded, memoize failures (hlsVariant.ts:17-23,109-112). ~200-entry LRU, don't cache failed fetches.
- **MEM-10** — per-post subscriber Maps never delete emptied keys (reactions.ts:29-36, translate.ts:22-28, threadModel.ts:67-76 — contrast placementStore.ts:98-103 which does it right); plus faded Set, _evicted, vwQueue (full Post copies), _remoteReplies. "Death by registries" tail; 3 one-line fixes + caps.
- **NET-7** — native translate hits Google gtx directly from the phone (translate.ts:46 — the endpoint server.js:662 documents as IP-banned at scale); proxy's 400k/day global cap exceeds DeepL's 500k/MONTH quota. Point the client at /translate, fix the cap math.
- **NET-8** — [STILL OPEN] /social cache keyed on free-form `country`, Map never evicts (server.js:877-881, :649) — scanner-driven OOM. Allowlist + small LRU.
- **NET-9** — X budget charged after the call, counter on ephemeral disk (server.js:463, :371). Reserve-then-refund, move to the volume.
- **DB-2** — [STILL OPEN P2-8] profile counts = two 1000-row UUID reads to .length them (ProfileScreen.tsx:141-142). `Prefer: count=exact` HEAD.
- **APK-5** — 966KB Material Symbols font via expo-router→expo-symbols, never used (res/V6.ttf). Autolinking exclude.

## FlashList (flashlist-eval) — adopt-modified, sequenced
Not installed; RN 0.86 new-arch + Reanimated 4.5.1 meet v2 requirements. Worth it for feed → nation → profile ONLY, and only AFTER R2R3 + R1 + index-prop land (fan-out re-renders hit recycled cells equally; index-derived AudioPill bars show the wrong waveform on recycle). Blur-release flag wiring (viewability.ts:86-104) is list-agnostic and survives; verify two-pair viewability parity + maintainVisibleContentPosition/onEndReached on device. Wall (custom absolute grid) and search (deliberate ScrollView) stay out. 2-3 days incl. soak on both clones; revert is one import swap per surface.

## Verified fixed / clean — do not re-litigate (ASYNC-10, MEM-7, MEM-8, MEM-12)
- expo-video runBlocking clock poll → event-based timeUpdate (StreamTile.tsx:552-607); no expo-video .currentTime on timers anywhere; no per-frame runOnJS in src/.
- __sparkleClocks UI-runtime registry unregisters correctly by SharedValue identity; loop self-stops; registry tracks mounted loaders only.
- Module-level AppState/nav listeners are process singletons; every per-mount listener has cleanup (one cosmetic 2.8s timeout nit, LiveWall.tsx:448-449).
- Bounded by design: /streams/health client map (~0.5MB), seen sets (capped 4000), stories/tokens, used-streams. Full rest-time timer inventory is in lane report ASYNC-10.

---

## Perf roadmap slice (see README.md for the full ranked list)

| # | What | Effort | Why first |
|---|------|--------|-----------|
| 1 | Proxy single-flight + SWR + gzip + s-maxage (+CDN) — NET-1/NET-2/NET-8/NET-9 | hours | Removes the scale-death failure mode; a few lines in server.js |
| 2 | trimStore on all paths + _offFeed LRU — MEM-1/MEM-2/ASYNC-9 | hours | Unbounded growth on the shipped config; the 2s→9s tab-block class |
| 3 | Feed players through enqueueCreate — ASYNC-1 | hours | Scroll stalls + decoder-cap bypass, ~15 lines |
| 4 | Reaction per-post bump — R2R3 | day | "Taps feel heavy," fix pattern already in-repo |
| 5 | AudioOwner context split — R1/ARCH-13 | day | Tap-for-sound frame, pattern in placementStore |
| 6 | Boot graph: lazy textures, direct AudioOwner import, inlineRequires A/B — ASYNC-2 | day | Cold start on 2GB devices |
| 7 | Feed normalise: mark + tag alternation + slice — ASYNC-3 | day | The 416+359ms unattributed stalls |
| 8 | Search sig without liveCursor — F16 | hours | List reset + WebView churn on fd-fragile phones |
| 9 | DM poll gates + slim query + no-change emit skip — F14/ASYNC-5/NET-3 | hours | Background battery + Supabase rps; Realtime later |
| 10 | APK: R8 + delete earth copies + drop barcode/camera/symbols — APK-1/2/3/5 | days | −30-40MB download; R8 needs device pass |
| 11 | audioStore events + per-post — ASYNC-4 | hours | 30 runBlocking hops/s while audio plays |
| 12 | DB index + cursor; profile count HEAD — DB-1/DB-2 | hours | Supabase CPU ceiling at scale |
| 13 | Image thumbs (bsky + reddit resolutions) — NET-4/MEM-11 | hours | User data plans + decode pressure |
| 14 | Sensing HandlerThread + consent gate — ASYNC-6 | hours | 100 main-looper wakeups/s at rest |
| 15 | Thread/chat commit weight — F29a/F29b | day | Typing latency, chat-open commit |
| 16 | AsyncStorage sweep + hashed seen ids — MEM-5 | hours | Boot hydrate + 15s write amplification |
| 17 | Wall placement cleanup — MEM-6 | hours | Long-session watchdog cost |
| 18 | Nation header/window — nation-header-churn | hours | Batch churn + Android clipping risk |
| 19 | X video variants; nation/reels aggregates — NET-5/NET-6 | days | Paid-for dead cards; NAT bans at scale |
| 20 | Low-group sweep (useTick, index prop, profile memo, MJPEG, registries, LRUs) | day | Background churn tail |
| 21 | FlashList feed→nation→profile — flashlist-eval | days | After 4/5/20; soak both clones |
