# Audit 2026-10-04b — index

Synthesis of six parallel audit lanes (render, async/threads, memory, payloads/scale, coupling/SOLID, debt) over E:/void-main/void-app @ web/parity 71aa593, the web source void2-final.html, and the deployed Railway proxy. Read-only; prior audits (PERFORMANCE_AUDIT.md, PERFORMANCE_AUDIT_2.md) honored — fixed items are not re-raised, unfixed re-raises are marked [STILL OPEN].

- **[PERFORMANCE_AUDIT_3.md](./PERFORMANCE_AUDIT_3.md)** — perf findings by severity + the perf roadmap slice.
- **[CODE_QUALITY_AUDIT.md](./CODE_QUALITY_AUDIT.md)** — architecture/debt findings + the refactoring roadmap slice.

## Headline

The device-level perf war is largely won — decoder budgets, settle-gated packing, the fling holiday, the worklet globe, and event-based video clocks are all verified in place, and the baseline rest-time behavior is materially healthier than at PA2. What remains splits cleanly in three: (1) **subscription granularity** — three coarse stores (reaction version, AudioOwner context, dmStore snapshot) still broadcast every change to every mounted consumer on every unfrozen tab, which is the "taps feel heavy" path; (2) **unbounded growth on the shipped config** — the store trim is bypassed on the proxy path and `_offFeed` posts are immune to it entirely, so long sessions degrade linearly; (3) **scale fragility that has nothing to do with the phones** — the proxy sends no gzip/cache headers and has no single-flight, so at real traffic the Reddit OAuth quota dies within minutes, long before bandwidth. On quality, the dual-implementation strategy is in better shape than its reputation (core is genuinely shared, golden-tested, node-runnable) but nothing in CI runs any of its guards, one parity constant has already silently drifted under two names, and the code that broke repeatedly this week has zero tests.

## What to do first (merged ranked roadmap — top 10 of 21; full table in each report)

| # | Item | Effort | Source |
|---|------|--------|--------|
| 1 | Proxy single-flight + SWR + gzip + cache headers (+CDN) | hours | NET-1/2/8/9, SCALE-1 |
| 2 | trimStore on all feed paths + _offFeed LRU | hours | MEM-1/2, ASYNC-9 |
| 3 | CI: npm test + typecheck + build.js --check + gen-data freshness | hours | ARCH-1, Q1, Q12 |
| 4 | Feed video players through the paced create queue | hours | ASYNC-1 |
| 5 | Reaction store: per-post bump | day | R2R3, ASYNC-7 |
| 6 | AudioOwner: actions context + per-id audible store | day | R1, ARCH-13 |
| 7 | Boot graph: lazy textures, direct AudioOwner import, inlineRequires A/B, drop dead globeScene prefetch | day | ASYNC-2, ARCH-7, Q4 |
| 8 | First-pull normalise: mark + tag alternation + slicing | day | ASYNC-3 |
| 9 | DM polls: AppState gate, single-flight, slim query, no-change emit skip | hours | F14, ASYNC-5, NET-3 |
| 10 | Search sig without liveCursor | hours | F16 |

Then: APK diet (R8 + delete 3 earth copies + barcode/camera/symbols, −30-40MB download), parity-constant dedupe, core-boundary fixes, DB index/cursor, image thumbs, audioStore events, sensing HandlerThread, thread/chat commit weight, tests for pacedPlayer/placement/budget, wall placement cleanup, low-group sweep, FlashList (last), god-module extraction (after the perf push).

## Scaling playbook verdicts

| Playbook item | Verdict | Why |
|---|---|---|
| 1. Scroll-settle & defer architecture for list batching | **already-done** | Shipped as the 7k fling holiday + 7l settle-gated packing (verified in place). One gap: feed videoStore creates players synchronously and bypasses the hold entirely (ASYNC-1) — fix that, don't rebuild the architecture. |
| 2. FlashList replacing FlatList | **adopt-modified** | Worth it for feed → nation → profile only, AFTER R2R3/R1/index-prop fixes land (fan-out re-renders hit recycled cells equally; AudioPill's index-seeded bars break on recycle). Wall (custom absolute grid) and search (deliberate ScrollView) stay out. 2-3 days with both-clone soak; one-line revert per surface. (flashlist-eval) |
| 3. Lazy windowing/virtualization with strict purge | **adopt-modified** | The windowing exists (wall budget+eviction, FEED_WINDOW); the *strict purge* does not — trimStore bypassed on the proxy path, _offFeed posts immune, nation posts never windowed, placement/lastGood maps never cleared (MEM-1/2/6, nation-header-churn). Finish the purge; don't add a new system. |
| 4. Instant skeleton placeholders | **already-done** | Sparkle loaders are the skeletons (Skia atlas, UI-runtime clock registry verified leak-free, MEM-7). Look is locked; no action. |
| 5. Background-thread/worker batching of list math | **reject** | RN offers no cheap JS worker, and the measured cost isn't "list math needs a thread" — it's 351 regexes/post and an unsliced 100-post loop (ASYNC-3). One alternation per tag + tick-slicing (pattern already in-repo) beats a worker at ~1/20 the complexity; the one true thread win is the JS onScroll → worklet move (F24-js-onscroll), already covered. |
| 6. Throttling/quantizing the expo-void-sensing bridge emissions | **already-done** (emission side) / **adopt-modified** (native side) | JS-side verified clean: motion-gated, change-gated, ≤0.5Hz quantized AffectState with one consumer. The remaining cost is BELOW the bridge: 100 sensor callbacks/s on the Android main looper and ungated context sensors (ASYNC-6) — fix is a HandlerThread + batching, ~10 lines of Kotlin, not more throttling. |
| 7. Supabase cursor pagination with selective ranges | **adopt** | Nothing cursors today: the main feed query has no keyset cursor AND no matching index (DB-1), DM polls read 500 full-body rows to count unread (NET-3), profile counts fetch 1000 UUIDs to .length them (DB-2). Partial index + created_at cursor + selective columns/HEAD counts are all cheap and all needed at scale. |

## Fixed-and-verified (do not re-open)

Wall decoder oversubscription, rendition floor, muted-tile audio decoders, player budget at rest, scroll fling holiday, settle-gated packing, nested-worklet crash class, feed/profile blur release, globe worklet rebuild — plus, newly verified this pass: expo-video runBlocking clock poll (now event-based), no per-frame runOnJS anywhere, sparkle clock registry leak-free, module listeners all singletons/cleaned (ASYNC-10, MEM-7/8/12).
