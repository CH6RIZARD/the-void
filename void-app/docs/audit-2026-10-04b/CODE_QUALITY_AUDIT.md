# CODE_QUALITY_AUDIT — synthesis of the 2026-10-04b audit pass

Branch `web/parity` @ 71aa593. Two quality lanes (coupling/SOLID, debt/duplication/dead-code) synthesized. Read-only; LiveWall.tsx, GlobeCanvas.tsx, globeWorklet.ts, placementStore.ts, app/_layout.tsx, core/feed/*, lib/core.ts were under concurrent edit during the audit — line numbers cite the working tree at audit time. Prior audits read first; `[STILL OPEN]` marks verified-unfixed re-raises.

**Verified healthy first, so it isn't re-litigated:** src/core is genuinely shared and node-runnable (24/24 golden tests pass in ~2.2s, tsc clean), the store/signal singleton pattern is consistent with measured rationale (ARCH-12), build.js is genuinely good (exact-once patches, --check, shipped-regression invariants), the data layer (core/feed, core/api, core/rank) has zero empty catches, RefreshControl is live code, and the one patch-package patch (expo-gl opaque) is small, documented, and fails loudly (Q13 — file the upstream PR so it retires itself).

Companion: `PERFORMANCE_AUDIT_3.md` (same folder). `README.md` has the index and full roadmap.

---

## HIGH

### ARCH-1 / Q1 / Q12 — Nothing guards the guards: no CI runs the parity suite, typecheck, or drift checks
The entire dual-implementation strategy (web source of truth + hand-ported core + golden tests) rests on a suite nothing executes. `android-aab.yml:71` runs only `npx tsc --noEmit`; no workflow invokes `npm test` (24 tests, pass locally); `deploy-pages.yml:46` runs plain `node build.js`, never `--check` (the flag exists, build.js:113-119). The suite already rotted silently once — golden.test.ts:37-39 documents it ("unrunnable while they drifted"). The generated-data chain has the same hole: `generate-data.ts` has no npm script and nothing asserts `src/core/data/*.generated.ts` is fresh against void2-final.html (Q12) — the known failure mode is web changes landing in HTML builds while native core data silently stays stale.

**Fix (~15-line workflow + 2 package.json lines):** .github/workflows/test.yml running `npm ci`, `npm test`, `npm run typecheck`, `node build.js --check`; make android-aab's build `needs: test`; add `gen:data` script + a regenerate-to-temp-and-diff freshness assertion inside npm test. Also still open from the prior audit: quote `${{ inputs.profile }}`, add `permissions:` blocks, pin eas-cli. **This is the highest-leverage quality item in the codebase — everything below is only as real as this.**

### Q2 / Q3 — Parity constants duplicated in native, and one pair has ALREADY drifted
`CONNECT_TIMEOUT` exists twice with different values: `core/streams/keys.ts:10` `{hls:8000,mjpeg:6000,youtube:9000,iframe:7000}` — the copy golden.test.ts:47,58 pins to void2-final.html:4847 — vs `features/live/constants.ts:27` `{hls:5500,...}`, the copy StreamTile.tsx:27,199 actually uses. The golden test stays green while shipped wall behavior diverges from the web it claims parity with. EMBEDDABLE_IFRAME / IFRAME_PLAYER_URL / YT_DEAD_CODES are byte-identical twins in the same two files, BOTH live in one pipeline (core wall.ts:68 filters with one copy, StreamTile gates tiles with the other) — one edit away from accepted-by-core/rejected-by-tile blank tiles with all tests green.

**Fix:** constants.ts imports/re-exports from keys.ts; the deliberate retuning becomes one explicitly-named `WALL_CONNECT_TIMEOUT` override carrying its comment. Mechanical, zero behavior change today.

### ARCH-2 / ARCH-3 / ARCH-4 — The core boundary has two real inversions and one dead untyped adapter sitting on its most load-bearing seam
- `core/streams/wall.ts:13` imports `features/live/hlsVariant` (core importing UP; it still runs under node only because that file happens to be pure). Move hlsVariant into core/streams. (ARCH-2)
- `core/streams/health.ts:22-28` lazy-requires `lib/config` for the proxy base despite `env.proxyBase` existing, and :39 calls bare `fetch` instead of `env.fetch` — bypassing the deadline wrapper the P0-8 fix installed. A fresh no-timeout network call of exactly the regression class the seam exists to prevent. ~6-line diff. (ARCH-3)
- `features/live/core.ts` — the dead multi-agent adapter: `const S = streams as any` (:48-49) erases the whole core surface, `typeof S.markBadStream === 'function'` feature-detection with hand-written fallbacks reimplements core logic (:51-95), local type redeclarations duplicate core/types.ts:99-118. 11 files import through it. If core renames or regresses an export, tsc stays green and the wall silently switches to divergent fallback behavior — hiding exactly the parity drift the golden suite exists to catch. The Agent-B contingency it guarded ended months ago. **Fix:** make it a thin typed re-export of core's named exports (typecheck passes today, proving they exist); delete the fallback bodies; importers unchanged. (ARCH-4)

### Q6 — Zero tests on exactly the code that broke repeatedly this week, while a test seam sits unused
Only 3 test files exist. Untested: pacedPlayer.ts (254 lines, release queue/ledger), recomputePlacement (LiveWall.tsx:455-560 — its own comments document three shipped regressions: blanket amnesty, keepId never applying, placement-on-blur storm), the playerBudget learn-down (constants.ts:159-172 ships `_resetPlayerBudget` labeled 'Test seam' with zero test imports). Every fix in commits 93b74c3/c6f79fb/b506428/71aa593 was verified only by a 36-min APK build + phone soak instead of a 2s node --test run.

**Fix, five tests in value order:** (1) pacedPlayer lifecycle with fake players + fake timers (idempotent releasePaced, pacing gap, non-negative ledger; needs a _reset seam like constants has); (2) extract recomputePlacement into a pure `computePlacement(inputs) → {parked, evicted}` and table-test the three documented regressions (this extraction is also ARCH-5 step 1); (3) budget learn-down floors + propagation — would have caught SearchLiveTile.tsx:104 freezing `playerBudgetNow()` into a module-level const at import time; (4) useStreamCascade selection as a pure extraction; (5) sleep/wake eviction invariants via placementStore.applyPlacement sequences (already pure).

---

## MEDIUM

### ARCH-5 / ARCH-6 — God modules with seams already drawn: LiveWall (1,150 lines, 49 hooks) and StreamTile (966 lines, four players)
LiveWall bundles the Lanes semaphore, batch pipeline, heal/watchdog, the ~170-line recomputePlacement, onScroll, and WallTile in one component — every perf fix this month touched it, and its most bug-prone logic can't be unit-tested because it's a closure over a dozen refs. StreamTile bundles HlsPlayer/YouTubePlayer/MjpegPlayer/IframePlayer + settle telemetry behind one shared PlayerProps contract with section-divider comments already marking the boundaries. **Fix:** behavior-preserving moves only, AFTER the current perf push lands: computePlacement → wallPlacement.ts (gets the Q6 test), WallTile → own file, Lanes → lanes.ts, watchdog → useWallWatchdog.ts; players → live/players/*.tsx + settleStats.ts, leaving the ~250-line dispatcher. Keep the web-mapping header comments with the code they describe.

### ARCH-7 / Q4 / Q5 — Two complete globe renderers maintained; the dead three.js path is still statically imported, boot-prefetched, and owns a duplicated marker rasteriser
`GlobeCanvas.tsx:114` `const WORKLET_GLOBE = true` (compile-time) keeps globeScene.ts (~400 lines of three.js) as "the instant fallback"; GlobeCanvas.tsx:11 imports it statically and `_layout.tsx:129-145` prefetches it at boot+4s — a measured 300-450ms JS block evaluating code the constant guarantees never runs. earthTexture.ts's 765KB base64 literal rides the live import chain (textures.ts:18) for the same dead branch. The marker radial-gradient rasteriser + color stops exist twice (globeWorklet.ts:74-109 live vs textures.ts:238-313 fallback-only; third copy in web mkTex) — any look change to the most visually-locked surface must be made twice or the fallback silently diverges.

**Delete criteria:** once the worklet globe survives one release cycle + clean soaks on both MediaTek phones, delete globeScene.ts, earthTexture.ts, the three fallback exports in textures.ts, the !WORKLET_GLOBE branches, and the _layout prefetch. **Until then, today:** move the createGlobeScene import inside the dead branch, drop the prefetch, lazy-require EARTH_PNG_B64 inside loadEarthTexture. (The APK/bundle half of this is PERFORMANCE_AUDIT_3 APK-2.)

### ARCH-10 — coreBridge monkey-patches core's auth through any-casts, with globalThis flags from the multi-agent era [P2-5 STILL OPEN]
`coreBridge.ts:71,:91` — `(VoidAuth as any).refresh = ...` rewires core behavior at runtime from a feature; `G.__VOID_BRIDGE_PUSHING__`/`__VOID_CORE_CONFIGURED__` as cross-agent handshakes (:36,:59,:14). What VoidAuth.refresh actually does depends on module-load order — invisible to tsc and to the golden tests (which test core un-patched). **Fix:** a typed `VoidAuth.setRefresher(fn)`/authHooks seam in configureCore; module-level booleans instead of globalThis flags (it's one bundle now). Full two-session-store unification remains the eventual P2-5 fix.

### ARCH-11 / Q10 — `as any` climbing 113 → 139 → 166-179 with no mechanism pushing back; 187 swallowed catches with no error sink behind them
No `declare global`/.d.ts anywhere in src; 57 eslint-disable comments appease an absent linter. Most casts are honest boundary work (EXGL internals, expo-video's lagging types, three r128 shims) but each site re-asserts the same untyped fact, so an SDK bump breaks silently at N sites. The 130 empty catches + 57 `.catch(()=>{})` are concentrated device-hardening (textures.ts 21, StreamTile 11, pacedPlayer's are tombstone-documented) and the data layer is clean — keep them — but nothing reports: no Sentry (P1-8 STILL OPEN), so every swallowed production failure is invisible.

**Fix (ratchet, not rewrite):** one `src/types/globals.d.ts` (ExGL contexts, __sparkleClocks/__sparkleLoop, __VOID_* — kills ~20 casts); a typed `tuneWallPlayer(p: VideoPlayer)` owning the expo-video extras; expo eslint config with no-explicit-any as warn; a 10-line `report(e, tag)` sink that console.warns in dev and forwards when crash reporting lands, routed through the ~20 auth/session and player-create catches first.

### Q11 — console.warn is the only telemetry channel; on the MediaTek phones it is also lossy
44 tagged sites ([block]/[slow]/[switch]/[globe]) parsed by harnesses (jank-loop.mjs:87-93); audit 2 F21 measured the 256KiB logcat ring overwritten in seconds by GED/VDO_LOG spam — diagnoses have already gone wrong on this. **Fix:** document the tag vocabulary in one place, keep harnesses on STREAMED logcat; when the Q10 sink + Sentry land, the tags become breadcrumbs for free.

### ARCH-8 / ARCH-9 — Cross-feature import web: 95 edges, feed as an undeclared shared kit, one feed↔reels cycle, one ui→features edge
11 files outside feed import ../feed (PostCard, format, stores, media/*); settings/vmod is a mini design-system consumed by auth+profile; `feed/reactions.ts:8` imports reels/reelStore while `reels/ModIcons.tsx:3` imports feed/vmodIcons — a package-level cycle; `src/ui/SparkleLoader.tsx:17` imports features/live/wallScrollSignal — the only ui→features edge (the 14-line signal's clean home is src/ui). **Fix (promotions, not a layering crusade):** vmod → src/ui; ago/fmt/baseId → src/core/util; break feed↔reels by moving the reaction-store half into the feed/post kit; wallScrollSignal → src/ui/scrollSignal.ts (3 import lines). Accept globe+live as one feature and say so in a README line.

---

## LOW — deletions and hygiene (mostly minutes each)

- **Q7** — dead exports: probe.ts (63 lines, zero feature imports — while useNationHero.ts:99-121 hand-rolls the same preflight), healChain (wall.ts:187, zero callers), ScreenPlaceholder.tsx. Use-or-delete; ~15 min.
- **Q8** — frameSample.ts USE_RAW_ANDROID=false path (~40 lines) whose own header says it can never be enabled. Delete the branch, keep the two-line why.
- **Q9** — expo-sharing: zero imports, delete today. expo-camera: permission-strings-only, move them into the sensing plugin, drop the package (one device smoke). [= APK-3]
- **ARCH-14** — [STILL OPEN P2-4] build.js NATIVE target regenerates void-app/assets/void.html which nothing consumes (app.config.js:5: "The WebView shell that loaded void.html is gone") — a meaningless 1MB diff per web change. Delete the target + file.
- **Q14** — tracked runtime artifacts (device-watch.jsonl, probe-cache.json, source-health.json, source-quarantine.json, device-watch.report.md) churn the shared worktree. gitignore the outputs, keep the *-sources.generated.json inputs.
- **ARCH-12** — singletons are the house style with measured rationale; document the three kinds (per-id stores, process-abort ledgers, native-resource holders) in a short src/features/README and note the one rule: shared logic goes in src/core where the reset seams exist, never into feature stores holding native objects. No code change.

---

## Refactoring roadmap slice (see README.md for the merged ranked list)

| # | What | Effort | Risk notes |
|---|------|--------|-----------|
| 1 | CI: test + typecheck + build.js --check + gen-data freshness (ARCH-1/Q1/Q12) | hours | Zero app-code changes; unblocks trusting everything else |
| 2 | Dedupe keys.ts/constants.ts parity constants (Q2/Q3) | hours | Mechanical; keeps the one deliberate retune named |
| 3 | Core boundary: move hlsVariant, env seam in health.ts, de-any live/core.ts (ARCH-2/3/4) | hours | Pure moves + typed re-exports; tests already configure env |
| 4 | Tests for pacedPlayer / computePlacement / budget (Q6) | days | computePlacement extraction doubles as ARCH-5 step 1 |
| 5 | Globe dead-renderer trims now; full deletion after release-cycle sign-off (ARCH-7/Q4/Q5) | hours now | Deletion gated on both-phone soak of the worklet globe |
| 6 | coreBridge typed seam (ARCH-10) | day | Touches auth; test session rotation on device |
| 7 | globals.d.ts + eslint ratchet + report() sink (ARCH-11/Q10/Q11) | day | Warn-level only; no behavior change |
| 8 | Import-web promotions: vmod, format, scrollSignal, feed↔reels break (ARCH-8/9) | day | Mechanical moves; run golden suite after |
| 9 | LiveWall/StreamTile extraction (ARCH-5/6) | days | AFTER the perf push lands — the concurrent implementer owns these files |
| 10 | Deletions: probe/healChain/ScreenPlaceholder/USE_RAW/NATIVE target/expo-sharing + gitignore (Q7/8/9/ARCH-14/Q14) | hours | expo-camera drop needs one device smoke |
