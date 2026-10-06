# RN New Architecture (Fabric) rendering & scrolling performance on low-end Android

Scope: RN 0.86 / Expo SDK 57 / Hermes / Reanimated 4, new architecture only. Target screen: dozens of absolutely-positioned tiles, gradients, animated loaders over a ScrollView, on weak MediaTek-class hardware.

## Fabric commit/mount costs, view flattening, shadow-tree churn, batching

### Takeaway
Fabric's pipeline is render → commit → mount; mount (host view creation/update on the Android main thread) is the expensive part on weak devices, and the two levers that cut it are (a) letting view flattening remove layout-only views (don't defeat it with `collapsable={false}` or visual props on wrapper views) and (b) producing fewer/smaller commits — React 18 automatic batching plus `startTransition` for non-urgent tile-count/state changes are the officially documented batching patterns.

### Cited Findings
- Fabric's render pipeline has three phases — render (create React/shadow tree), commit (layout + promote tree), mount (transform the shadow tree into a host view tree: `android.view.ViewGroup` per `<View>`, `android.widget.TextView` per `<Text>`) — [RN render pipeline docs](https://reactnative.dev/architecture/render-pipeline).
- View flattening is a renderer optimization that merges "Layout-Only" nodes (views that render nothing themselves, only affecting layout via `margin`/`padding` etc.) into their parent during the diffing stage; it "prevents creation and render of host views," is implemented in C++, on by default on both platforms, and adds no extra CPU cost because it is integrated into diffing — [RN view flattening docs](https://reactnative.dev/architecture/view-flattening).
- `collapsable` (default `true`): "Views that are only used to layout their children or otherwise don't draw anything may be automatically removed from the native hierarchy as an optimization. Set this property to false to disable this optimization" — [RN View props](https://reactnative.dev/docs/view).
- Automatic batching (new arch + React 18): "Automatic batching allows React to batch together more state updates when rendering to avoid the rendering of intermediate states"; in the official 0→1000 tiles slider demo, the new architecture "resolves to 1000 views faster… without as many intermediate states," while the old architecture "renders more intermediate states, and the UI keeps updating even when the slider stops moving" — [RN blog: The New Architecture is here](https://reactnative.dev/blog/2024/10/23/the-new-architecture-is-here).
- Transitions distinguish urgent updates (typing, pressing) from non-urgent ones; wrapping the tile-count update in `startTransition(() => setNumberOfTiles(input))` yields "less batch renders" because stale in-progress renders are interrupted; the doc's example is explicitly "tiles… rich component containing images and other components that are expensive to render" — [RN blog: The New Architecture is here](https://reactnative.dev/blog/2024/10/23/the-new-architecture-is-here).
- The new renderer "can handle multiple in-progress trees across multiple threads," letting React process concurrent update priorities and interrupt a low-priority update to render an urgent one — [RN blog: The New Architecture is here](https://reactnative.dev/blog/2024/10/23/the-new-architecture-is-here).
- Fabric "supports thread-safe layout calculations" and concurrent rendering "lets urgent interactions run first, keeping taps, scrolling, and screen updates responsive during demanding UI activity" — [RN fabric renderer docs](https://reactnative.dev/architecture/fabric-renderer).

### Inferences
- For a wall of absolutely-positioned tiles: give each tile exactly one host view where possible (no wrapper `<View>` per tile that carries `backgroundColor`/`borderRadius`/`overflow` plus an inner content view) — every non-flattenable wrapper is one more host view to create/measure/draw per tile on the Android main thread.
- Frequent `setState` in a list-like screen churns the shadow tree per commit; coalescing state (one store update per tick instead of per-tile `setState`) and marking non-urgent updates as transitions reduces both commit count and mount diff size. On new arch, updates inside events are already batched automatically — the remaining win is *not* updating state during scroll at all (defer to scroll-end).
- Absolute positioning changes (top/left) on tiles go through layout → commit → mount each time; moving tiles via `transform` driven by Reanimated avoids shadow-tree churn entirely because transforms applied from the UI thread don't re-run Yoga layout.

### Gaps
- No official numbers found for "cost per commit" or per-host-view mount cost on Android; the RN team documents the mechanisms but not microbenchmarks.
- Could not verify a documented list of exactly which props defeat flattening in 0.86 (the docs name the mechanism and `collapsable`, not an exhaustive prop list).

## Reanimated 4 CSS animations: where they run, cost of many infinite animations, alternatives

### Takeaway
Reanimated 4's CSS animations are declarative, require the new architecture, run off the JS thread (Reanimated's long-standing model: animation math on the UI thread), and `animationPlayState: 'paused'` is the documented way to freeze them at the current frame. No published benchmark exists for dozens of simultaneous infinite animations; for many similar animating elements the evidenced high-headroom alternative is Skia's `Atlas` (one GPU draw call for N sprites, transforms computed in a worklet on the UI thread).

### Cited Findings
- Reanimated 4 requires the New Architecture: "Reanimated 4 requires that your app uses the React Native New Architecture" — [Software Mansion: Reanimated 4 stable release](https://swmansion.com/blog/reanimated-4-stable-release-the-future-of-react-native-animations-ba68210c3713).
- CSS animations are "much easier to optimize… we understand many more details about what attributes of which components are being animated"; SWM recommends state-controlled animations adopt the CSS API and "expect it to yield less code… and also to perform better" — [Reanimated 4 stable release](https://swmansion.com/blog/reanimated-4-stable-release-the-future-of-react-native-animations-ba68210c3713).
- Reanimated 4 continues to "leverage the performance benefits of platform-native animation APIs and offloads work from the React Native JavaScript thread"; CSS animations are "fire-and-forget" and can't respond to dynamic external factors in real time (use worklets/shared values for gesture- or scroll-driven motion) — [Reanimated 4 is new but also very familiar](https://swmansion.com/blog/reanimated-4-is-new-but-also-very-familiar-b926dd59aa40).
- Official usage guidance: "Use CSS animations for self-contained, declarative motion: loading spinners, pulsing badges, looping attention-grabbers"; use shared values + `useAnimatedStyle` for frame-by-frame control — [Reanimated CSS animations overview](https://docs.swmansion.com/react-native-reanimated/docs/css-animations/overview).
- `animationPlayState` "lets you play and pause the animation. Defaults to running"; paused halts at the current frame; with animation arrays, each play-state entry pairs with the matching `animationName` entry — [animationPlayState docs](https://docs.swmansion.com/react-native-reanimated/docs/css-animations/animation-play-state).
- Reanimated's general threading model (since v2): animations are coded in JS but run on the UI thread via worklets in a secondary JS context, staying at 60fps even when the JS thread is busy — [ThoughtWorks Radar: Reanimated 2.0](https://www.thoughtworks.com/radar/languages-and-frameworks/react-native-reanimated-2-0).
- Skia `Atlas`: "efficient rendering of multiple instances of the same texture," "especially useful for drawing a large number of similar objects, like sprites or tiles, with varying transformations"; transforms "can be animated with near-zero cost using worklets" and Skia issues a single GPU draw call regardless of sprite count, with transforms computed on the UI thread — [react-native-skia Atlas docs](https://www.mintlify.com/shopify/react-native-skia/shapes/atlas); the library's guidance is to use Atlas for 10+ similar elements because "a single draw call beats N individual components" — [react-native-skia performance docs](https://www.mintlify.com/shopify/react-native-skia/advanced/performance).

### Inferences
- Each Reanimated CSS animation still updates real native view props every frame on the UI thread; dozens of concurrently animating small native views means dozens of per-frame property writes + invalidations on the Android main thread — exactly the thread that also handles scroll input on a weak device. Pausing off-screen/occluded loaders via `animationPlayState: 'paused'` (cheap, documented, keeps the component mounted) is the first lever; the second is reducing the number of independently animating native views (one animated container that many loaders inherit from, or a single Skia canvas with an Atlas).
- Because CSS animations are "fire-and-forget" and SWM's own guidance scopes them to spinners/badges, a wall of dozens of infinite loaders is at the upper end of their intended use; the Atlas path is the documented scalable design for that shape of problem.

### Gaps
- No measured cost data (ms/frame or FPS curves) for N simultaneous Reanimated CSS animations was found in SWM docs, blog, or GitHub discussions surfaced by search — the claim "easier to optimize" is qualitative. Any budget for "how many loaders is too many" must come from on-device gfxinfo/Perfetto measurement.
- Whether Reanimated 4's CSS engine applies props via direct view-prop updates (bypassing ShadowTree commits) or via Fabric commits is not stated in the fetched docs/blogs; SWM only confirms work is off the JS thread.
- No evidence found for sprite-sheet (image-sequence) loaders as a documented RN pattern; Atlas is the sourced alternative.

## ScrollView vs FlatList vs absolute tiles with manual windowing; clipping, overdraw, gradients, hardware textures

### Takeaway
For a wall layout, virtualization (FlatList tuning or FlashList v2's recycling) exists to bound host-view count; if tiles stay absolutely positioned inside a ScrollView, manual windowing must replicate that bound yourself, and `removeClippedSubviews` explicitly does NOT play well with absolute positioning. Overdraw levers: fewer stacked backgrounds, `dither={false}` or RN's native gradient styles instead of extra gradient views, `renderToHardwareTextureAndroid` only for transform/opacity-only animations (costs VRAM), and `needsOffscreenAlphaCompositing` avoided ("extremely expensive").

### Cited Findings
- `removeClippedSubviews` (FlatList: default `true` on Android): views outside the viewport are detached from the native view hierarchy, reducing main-thread time; caveats: "this implementation can have bugs, such as missing content… especially if you are doing complex things with transforms and/or absolute positioning," and it "does not save significant memory because views are only detached, not deallocated" — [RN 0.86 optimizing FlatList](https://reactnative.dev/docs/0.86/optimizing-flatlist-configuration).
- `removeClippedSubviews` as a raw View prop requires: a view containing many subviews extending outside its bounds, subviews with `overflow: hidden`, and the containing view (or a superview) with `overflow: hidden` — [RN View props](https://reactnative.dev/docs/view).
- FlatList tuning levers in 0.86: `maxToRenderPerBatch` (default 10; larger = fewer blanks but longer JS blocks that hurt press responsiveness), `updateCellsBatchingPeriod` (default 50ms), `windowSize` (default 21 viewports; smaller = less memory, more blank risk), `initialNumToRender`, and `getItemLayout` ("a very desirable optimization technique" — removes async layout measurement for uniform items) — [RN 0.86 optimizing FlatList](https://reactnative.dev/docs/0.86/optimizing-flatlist-configuration).
- FlashList v2 was "rebuilt from the ground up for React Native's new architecture," is JS-only, uses view recycling (reusing component instances instead of destroy/recreate), leverages synchronous measurements and progressive rendering, and no longer needs size estimates — [Shopify engineering: FlashList v2](https://shopify.engineering/flashlist-v2).
- `renderToHardwareTextureAndroid`: renders the view + children into a single GPU hardware texture; "useful for animations and interactions that only modify opacity, rotation, translation, and/or scale: in those cases, the view doesn't have to be redrawn and display lists don't need to be re-executed"; downside: "this can use up limited video memory, so this prop should be set back to false at the end of the interaction/animation" — [RN View props](https://reactnative.dev/docs/view).
- `needsOffscreenAlphaCompositing`: "Rendering offscreen to preserve correct alpha behavior is extremely expensive… which is why it is not turned on by default"; if needed for an animation, combine with `renderToHardwareTextureAndroid` when contents are static — [RN View props](https://reactnative.dev/docs/view).
- expo-linear-gradient: the `dither` prop reduces banding; setting it `false` "may improve gradient rendering performance" on Android — [Expo SDK 57 LinearGradient docs](https://docs.expo.dev/versions/v57.0.0/sdk/linear-gradient/).
- RN now ships `experimental_backgroundImage` (Android & iOS) supporting CSS `linear-gradient()`/`radial-gradient()` syntax directly as a View style — a gradient without an extra native component/view — [Expo LinearGradient docs, alternatives section](https://docs.expo.dev/versions/latest/sdk/linear-gradient).
- High GPU-work time in frame profiles "suggests overdraw or inefficient rendering effects" — [Android testing/performance docs (archived)](https://iut-fbleau.fr/docs/android/training/testing/performance.html).

### Inferences
- An absolutely-positioned tile wall inside a plain ScrollView gets no clipping help: `removeClippedSubviews` is both ineffective (needs `overflow: hidden` subview structure) and explicitly buggy with absolute positioning. Manual windowing — mount only tiles within ~1.5–2 viewports of the scroll offset, keyed by stable IDs, positioned with transforms — reimplements what FlatList/FlashList do, and is legitimate when the layout isn't a linear list; the key is bounding *host view count* and *concurrently animating view count*, which is the quantity all official levers (windowSize, recycling, flattening) ultimately control.
- Gradient overdraw: each expo-linear-gradient is its own native view layered over the tile background → 2–3x overdraw per tile. Replacing per-tile gradient views with `experimental_backgroundImage` on the tile itself (one view, one draw) or one full-wall gradient underlay removes a whole overdraw layer. Verify with Android's "Debug GPU overdraw" developer option.
- `renderToHardwareTextureAndroid` on a tile whose content is static while it translates during scroll avoids re-executing display lists per frame — but on a low-VRAM MediaTek device, applying it to dozens of tiles simultaneously risks texture-memory pressure; scope it to animating tiles only and clear it after.

### Gaps
- No source found quantifying expo-linear-gradient's per-view cost vs `experimental_backgroundImage` on Android; only the dither note and the existence of the native alternative are documented.
- No official doc on `removeClippedSubviews` behavior changes specific to Fabric in 0.86 (the 0.86 docs still carry the old-text caveats; no Fabric-specific regression/fix notes surfaced).

## Scheduling: keeping gesture/scroll responsive while JS does heavy work

### Takeaway
On the new architecture, `InteractionManager` is deprecated (0.80+ it degenerates to `setImmediate`; docs say use `requestIdleCallback`), so the sanctioned tools are React 18 scheduling (`startTransition`/`useDeferredValue` for non-urgent renders) plus chunking JS work into idle callbacks. Hermes' Hades GC runs mostly concurrently on a background thread, so GC pauses are rarely the headline cost — but note the 32-bit caveat.

### Cited Findings
- `InteractionManager` is deprecated; docs advise avoiding long-running work and using `requestIdleCallback` instead; from RN 0.80+ its behavior "has been changed to be the same as setImmediate" — [RN 0.86 InteractionManager docs](https://reactnative.dev/docs/0.86/interactionmanager).
- `startTransition` marks updates as interruptible transitions; urgent input renders can interrupt in-progress low-priority renders, and the new renderer handles "multiple in-progress trees across multiple threads" — [RN blog: The New Architecture is here](https://reactnative.dev/blog/2024/10/23/the-new-architecture-is-here).
- Hades GC: "most of the garbage collection work happens in a background thread concurrently with the interpreter running JavaScript code," targeting pause times "an order of magnitude over GenGC" better; young-gen allocations are copied/compacted, old-gen collection starts near 75% occupancy; longer pauses come from mark-finalization (write-barrier flush, WeakMap resolution) and YG compactions; on 32-bit platforms Hades runs in "incremental mode" spreading OG work across YG pauses instead of a background thread — [Hermes Hades doc](https://github.com/facebook/hermes/blob/main/doc/Hades.md).
- FlatList's own batching knobs are scheduling levers: large `maxToRenderPerBatch` causes "longer JavaScript execution periods [that] can block other event processing, like presses, hurting responsiveness" — [RN 0.86 optimizing FlatList](https://reactnative.dev/docs/0.86/optimizing-flatlist-configuration).

### Inferences
- "Input events delayed by seconds" is the classic signature of a saturated thread with a growing event queue. Which thread: if JS is saturated, native scroll (which runs on the UI thread under Fabric/Reanimated) stays smooth but JS-driven responses (press handlers, state-driven UI) lag; if the Android main (UI) thread is saturated, everything lags — scroll stutters, touches queue, and gfxinfo shows high Input/Animation/Draw stages. gfxinfo attributes UI-thread stages; a janky gfxinfo + idle JS profiler means UI thread; clean gfxinfo + delayed JS callbacks means JS thread.
- Practical pattern for the wall: during active scroll, suspend non-essential JS (feed polling, image prefetch decisions, analytics) via a scroll-state flag; resume in `requestIdleCallback` or on momentum-end. Avoid `setInterval` work landing mid-scroll — timers fire on the JS thread and their re-renders trigger Fabric commits during the scroll.
- Hermes GC is unlikely to be the primary jank source on arm64 builds (concurrent Hades); however this project builds arm64-only, so the 32-bit incremental-mode caveat doesn't apply. Allocation-heavy per-frame JS (closures in scroll handlers) still raises YG collection frequency — keep scroll-path JS allocation-free.

### Gaps
- No RN-official doc found describing `useDeferredValue` behavior specifics on RN (only the React 18 feature set announcement); no RN-specific benchmark of transitions on low-end Android.
- No published data on typical Hades pause durations on low-end Android hardware (the design doc gives architecture, not device numbers).

## Android HWUI: interpreting dumpsys gfxinfo stages

### Takeaway
gfxinfo framestats stages map cleanly to threads and causes: Input, Animation, Measure/Layout, and Draw run on the app's main (UI) thread; Sync and GPU/command-issue run on the RenderThread. In an RN new-arch app, a high Animation stage specifically implicates native-side animators and Choreographer frame callbacks — i.e., Reanimated's UI-thread animation work — not JS.

### Cited Findings
- Input handling (HANDLE_INPUT_START→ANIMATION_START): >2ms suggests too much work in touch-event callbacks; move work off or optimize — [Android testing/performance docs (archived official)](https://iut-fbleau.fr/docs/android/training/testing/performance.html).
- Animation (ANIMATION_START→PERFORM_TRAVERSALS_START): "evaluates registered animators… If this number is high (>2ms), check to see if your app has written any custom animators or what fields ObjectAnimators are animating" — [same source](https://iut-fbleau.fr/docs/android/training/testing/performance.html).
- Measure/Layout (PERFORM_TRAVERSALS_START→DRAW_START): should approach zero during scrolling/animations; high values = expensive measure/layout passes — [same source](https://iut-fbleau.fr/docs/android/training/testing/performance.html).
- Draw (DRAW_START→SYNC_QUEUED): time to call View.draw() on invalidated views; delays = excessive invalidation or complex custom drawing — [same source](https://iut-fbleau.fr/docs/android/training/testing/performance.html).
- Sync (SYNC_START→ISSUE_DRAW_COMMANDS_START): >0.4ms "typically indicates a lot of new Bitmaps were drawn which must be uploaded to the GPU" — [same source](https://iut-fbleau.fr/docs/android/training/testing/performance.html).
- GPU work (ISSUE_DRAW_COMMANDS_START→FRAME_COMPLETED): rough GPU load; high values suggest overdraw or expensive effects — [same source](https://iut-fbleau.fr/docs/android/training/testing/performance.html).
- Aggregate gfxinfo (dumpsys gfxinfo <pkg>) reports janky-frame %, percentiles, missed vsync, high input latency, slow UI thread, slow bitmap uploads, slow draw; `framestats` gives nanosecond timestamps for the last 120 frames — [same source](https://iut-fbleau.fr/docs/android/training/testing/performance.html).

### Inferences
- RN new-arch mapping of the buckets: **Animation** high → Reanimated worklet frame callbacks / CSS animation engine / native animators running per-frame on the UI thread (dozens of infinite loaders show up exactly here); **Measure/Layout** high → Yoga-triggered native layout from Fabric commits during scroll (state churn moving absolute positions); **Draw** high → too many invalidated views per frame (many small animating views each invalidating) or gradient/rounded-corner redraws; **Sync** high → image decodes/bitmap uploads (new tile images appearing during scroll); **GPU** high → overdraw from stacked backgrounds/gradients.
- Diagnostic recipe for the wall: run `adb shell dumpsys gfxinfo <pkg> framestats` after a reset, scroll for ~10s, and attribute: if Animation dominates, cut concurrent animators (pause off-screen loaders); if Draw/GPU dominates, cut overdraw/gradient layers; if Measure/Layout dominates, stop committing layout during scroll (use transforms); if none dominate but the app still feels slow, the JS thread is the bottleneck (gfxinfo can't see it — use Perfetto with the JS thread track or Hermes profiling).

### Gaps
- The fetched stage documentation is the archived pre-2017 official Android page; the live developer.android.com "Profile GPU rendering speed" page was not fetched to confirm current wording (stage semantics are stable in HWUI, but thresholds like ">2ms" date from that era and should be scaled for 60Hz budgets on slow SoCs).
- No official doc found that maps gfxinfo stages to RN new-arch internals; that mapping above is inference from the two documented halves (Android stage semantics + Reanimated/Fabric threading).

## JS-thread hygiene patterns for RN grids

### Takeaway
The sourced levers are: memoized `renderItem`/tile components with stable props (React.memo + useCallback, keyExtractor), batching knobs that trade JS block length against blank areas, automatic batching + transitions to collapse re-render storms, and deferring long-running work to `requestIdleCallback` now that InteractionManager is deprecated.

### Cited Findings
- Wrap list items in `React.memo()` with a custom props comparison to prevent unnecessary re-renders; "Avoid anonymous renderItem functions" — hoist and wrap in `useCallback`; use `keyExtractor`/stable keys for caching and reorder tracking; keep item components basic/light; use cached, resized images (community packages like `@d11/react-native-fast-image`) — [RN 0.86 optimizing FlatList](https://reactnative.dev/docs/0.86/optimizing-flatlist-configuration).
- `maxToRenderPerBatch`/`updateCellsBatchingPeriod` explicitly trade "longer JavaScript execution periods" against blank areas — the officially documented knob for bounding JS block length during scroll — [RN 0.86 optimizing FlatList](https://reactnative.dev/docs/0.86/optimizing-flatlist-configuration).
- Automatic batching collapses rapid sequential state updates into fewer renders with no code changes on the new architecture — [RN blog: The New Architecture is here](https://reactnative.dev/blog/2024/10/23/the-new-architecture-is-here).
- Deprecated `InteractionManager` → `requestIdleCallback` for long-running work — [RN 0.86 InteractionManager docs](https://reactnative.dev/docs/0.86/interactionmanager).

### Inferences
- Context re-render storms: a context whose value changes on scroll position or feed ticks re-renders every consumer tile. The standard fix is splitting contexts (static config vs volatile state), passing volatile values through Reanimated shared values (which bypass React render entirely), and memo boundaries per tile so a parent re-render diffs to zero commits for unchanged tiles. (Pattern inference from the memo guidance above + Reanimated's off-JS-thread model; no single official doc states the combined pattern.)
- Timer hygiene: any `setInterval` driving loader state in JS defeats the entire point of Reanimated CSS animations (which exist so that no JS runs per frame); loaders must be purely declarative (CSS animation) or UI-thread (worklet), with JS timers reserved for data, paused during scroll.

### Gaps
- No 2025-2026 Shopify/Coinbase/Discord engineering post specific to new-arch JS-thread hygiene surfaced in searches (their classic posts predate Fabric); FlashList v2's Shopify post is the closest current source.
- React 18 `useTransition`/`useDeferredValue` adoption reports from large RN apps on low-end Android: none found.
