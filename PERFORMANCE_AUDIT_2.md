# The Void: Performance Audit 2 (Android, `void-app/`)

> **Audited code:** `fix/tab-switch` @ **b8c8e98** (2026-09-29 17:28). It contains perf/steps-1-4, build/current, fix/globe-wall-only and fix/wall-clock-stall. `perf/mobile-fixes` (b506428) is 92 commits behind and not in b8c8e98's history, so it is not the current app.
> **Measured build:** the preview APK from GitHub Actions run 36633501568 (b8c8e98), sha256 `0b47677e…`, clean-installed by the branch's owner session.
> **Phone:** `R5CYA0GF6FP`. It reports `SM_S9080` / "Galaxy S22", but it is **not** one: `ro.hardware=mt6763` (Helio P23 class), Android 10, 720×1560 at 320 dpi. Treat every number as a low-end floor.
> **Branch owner:** the session that owns `fix/tab-switch` (`the-void-98`) committed three fixes after the measured build: 133d84c (globe map actually drawn; `StreamTileHandle.stop()`), 207f682 (NationHero unmount; audio track disabled on non-audible **wall HLS** tiles), 6005523 (mount budget, being reworked with hysteresis). None of them is in the numbers below.
> **Paths** are relative to `void-app/`. Every finding cites file:line at b8c8e98. Labels: **M** = measured, **C** = code proof, **H** = HYPOTHESIS (with the measurement that would confirm it).

## 1. Verdict

The app is not slow in a hundred small ways. **It opens far more video players and WebViews than this phone can decode, never lets go of them, and then tears them all down and rebuilds them on the JS and UI threads during the transitions you feel.** React rendering is a real but secondary cost. The feed data functions were rightly ruled out. The "[block] on JS" signal that pointed at React was partly the UI thread and the media stack: the heartbeat cannot tell them apart (F21).

The top 5 reasons, each tied to a symptom and a measurement:

1. **It crashes, repeatedly, within minutes of using the globe** (all symptoms; F1, F8, F5).
   - **Measured:** 4 native crashes in ~55 minutes of scripted use on b8c8e98:
     - `FORTIFY: FD_SET: file descriptor 1037/1081/1039 >= FD_SETSIZE 1024` at 18:37, 18:52 and 19:25;
     - a `SIGSEGV` on `ExoPlayer:Playback` (`SampleDataQueue.readData → memcpy` to an unmapped codec buffer) at 18:49.
   - Two more FD aborts (fd 1160, 1801) happened on b8c8e98 during the other session's use, and 20+ happened on older builds today.
   - On this ROM a vendor `select()` thread aborts the process as soon as any fd number reaches 1024. Every player, WebView renderer connection and socket counts.
   - The first crash I caused came ~60 s after a cold start, on the second Feed→Globe entry.
2. **The live wall oversubscribes the video decoders, so software decoding starves every thread** (symptoms 3, 1, 2; F5, F4, F17, F18).
   - **Measured:** logcat shows `C2SoftAvcDec` / `c2.android.avc.decoder` (software AVC) running on the wall.
   - In a single globe window, ExoPlayer playback threads used up to **69 CPU-seconds** and `MediaCodec_loop` 29 s. WebView renderers used 19–87 CPU-seconds per window.
   - adb itself stalled: 6 s measurement windows stretched to 45–100 s wall-clock.
   - The one ANR on record (17:11, previous build) had the main thread buried in ExoPlayer `onAudioUnderrun` analytics callbacks with 52 input events queued, while `media.swcodec` ran at 74%. Muted tiles still decode audio (F4).
3. **Leaving and returning to the globe triggers storms, not transitions** (symptom 1, worst Globe→Reels / Globe→any tab; F2, F3, F6).
   - **Measured:**
     - Globe→Reels: worst stall **20.9 s**, 0.2 fps over 6 s, and **41 players released + 12 created** in that one window.
     - Returning to the globe after 25 s away: worst stall **45.8 s**, **+29/−18** players (a fresh entry is +9/−6).
   - The code does all of the following:
     - "stopAll" actually calls `play()` (F2, fixed upstream after this build);
     - sleep never evicts, and waking evicts every tile and reconnects them all at once, without lanes (F3);
     - a single `setState` flips the wall, reels, GL loop, loaders, storage and toast in one commit (F6).
4. **Every tab stays live, and switching relays out whole hidden screens** (symptom 1; F7, F13, F14, F12).
   - **Measured** press→focus from the globe: Void 1.7 s, Messages 3.3 s, Search 4.3 s, Profile **8.9 s**, with stalls of 3.3–15.6 s in the same windows.
   - The code: `detachInactiveScreens={false}` renders hidden tabs as `display:none` subtrees, and `freezeOnBlur:false` lets DM polls, reaction bumps and audio ticks re-render hidden screens.
   - Each SparkleLoader is 14 separate native loops with its own focus listener, so a switch fans out across every loader.
5. **The globe draws on the JS thread, and drag input goes through JS, so any stall freezes it** (symptom 2, reels 4; F9, F10, F8, F15).
   - **Measured:** a 10 s drag ran at **0.5–1.8 fps**, with worst frames of 2.8–9.8 s and stalls up to 34 s, and the ExoPlayer churn was **+28/−52 players inside one drag window**.
   - three.js runs on `mqt_v_js`, drag is `runOnJS(true)`, and MSAA is 4×.
   - Reels create players inside render (`pacedPlayer.ts:131`), and each swipe is 3–4 commits that re-render every cell and remount the action rail.
   - The globe's earth map is not actually sampled on this build (it is the procedural fallback; fixed upstream in 133d84c, unverified).

**What X and Instagram do differently** (details in §3): they own a fixed pool of 2–3 players sized to the device's decoders, play one video at a time, release everything that isn't visible, disable audio on silent autoplay, freeze hidden screens, and stage transitions across frames. The Void does none of these consistently.

### 1.1 Measurements (b8c8e98, R5CYA0GF6FP, 2026-09-29 18:33–19:26)

**Method:**
- Harness: `D:/void-phone/f3/f3.mjs` (outside the repo). Run it as `ANDROID_SERIAL=R5CYA0GF6FP node f3.mjs <cold|feed2globe|drag|leave|return|wall> --runs=5`. Results are in `D:/void-phone/f3/`.
- Frames: `dumpsys gfxinfo framestats`, polled every 0.7 s and de-duplicated, so no frame is lost from the 120-frame ring. expo-gl's `GLView` is a TextureView, so globe frames are included.
- Tap times: `log -t VF3` marks around `input tap`, on the same monotonic clock as the frames. logcat is **streamed** during each window, because the 256 KiB ring buffer is overwritten by MediaTek `GED`/`VDO_LOG` spam within seconds.
- CPU: per-thread `/proc/<pid>/task/*/stat` deltas, plus the WebView sandbox processes.
- Stalls: the app's own `[block]` lines, which only fire at ≥ ~400 ms and fire on UI-thread stalls too.
- **Temporary timing marks:** none were added to app code. Adding them needs a new build of a branch another session owned and was actively building, on the only phone. Nothing to revert. Where a mark would settle a HYPOTHESIS, the finding names the exact line to time.

**Run counts:** the user asked for 5 runs per scenario. Where there are fewer, it is because the app crashed or the phone was saturated. Each crash is itself a result, and each is listed.

| Scenario | Runs (valid) | Median | Worst | Notes |
|---|---|---|---|---|
| a) Cold start, `am start -W` TotalTime | 5 (5) | **2,759 ms** | 2,773 ms | First frame at ~2.7 s. The next 12 s of feed frames: p50 33–69 ms, p95 200–339 ms, 90–98% janky. Stalls 302–456 ms. PSS 265–285 MB. "Time to first feed content" is not machine-detectable yet (step 0 in §5). |
| b) Feed→Globe, first 5 s | 5 (2 frame-valid; 3 lost marks under load; then a crash) | 11.8 fps | 6 fps | Run 1: 17.6 fps, 100% janky, max frame 1,338 ms, stalls 404/833/730 ms. Run 2: 6 fps, max frame 2,169 ms, stalls 673/1,683/817/375 ms. The **FD crash** (1037) came on the next entry. |
| c) Globe drag 10 s | 5 attempted (3 valid after crash/relaunch) | **1.2 fps** | 0.5 fps | 100% janky. Worst frame 2.8 / 9.8 / 4.7 s. Stalls up to 14.5 / 30.3 / 34.2 s. ExoPlayer +9/−6, **+28/−52**, +21/−12 per window. The first attempt ended in an **FD crash** (1081) after a 6.2 s stall. |
| d) Globe→Reels | 1 | — | stall **20.9 s** | 0.2 fps, worst frame 5.3 s, ExoPlayer +12/**−41**. |
| d) Globe→Void | 1 | — | stall 4.8 s | `[switch]` 1,679 ms; 3 fps; worst frame 3.0 s; 18 frames >100 ms. |
| d) Globe→Search | 1 | — | stall **15.6 s** | `[switch]` 4,314 ms; 5.7 fps; 34 frames >100 ms. |
| d) Globe→Messages | 1 | — | stall 3.3 s | `[switch]` 3,302 ms; 8.7 fps; 52 frames >100 ms. |
| d) Globe→Profile | 1 | — | stall 10.3 s | `[switch]` **8,902 ms**; 6.7 fps; 40 frames >100 ms. |
| d') Void→Globe after 25 s away (wall asleep) | 2 (2) | — | stall **45.8 s** | Run 1: 45 stalls ≥300 ms, worst 9.3 s, +13/−8. Run 2: +29/−18. `[switch]` said "globe 322–326 ms" both times. |
| e) Live wall: entry → tile video moving | 1 (screencap every ~3 s under load) | median tile area **12.3 s** | — | First tile area moving at 3.6 s; 25% at 9.7 s. Stalls 4.9/5.2 s. **FD crash** (1039) ~45 s in, so memory at 60 s could not be read. For reference only: on the older Helio P35 phone (09-22, a different device) the live wall held 540–770 MB PSS. |
| ANRs (`dropbox data_app_anr`) | — | — | — | None new during the audit. The last one is 17:11:38 (2a58f47): input channel full, main thread in ExoPlayer audio-underrun analytics. |
| Tombstones | — | — | — | 18:22 (fd 1160), 18:26 (fd 1801), **18:37 (fd 1037), 18:49 (ExoPlayer SIGSEGV), 18:52 (fd 1081), 19:25 (fd 1039)**. The last four happened during this audit's runs. |

Reading the numbers honestly:
- The frame stats in b)–e) are dominated by decoder saturation and crash-adjacent states. They are the floor today, not a stable baseline.
- After §5 steps 1–3, re-run the same harness for 5 runs each. Only then do jank % and p95 become meaningful targets.
- Where one run is reported, the magnitude (seconds, not milliseconds) is what matters. Five runs would not change the verdict.

## 2. Findings (ranked by user-felt impact)

Mechanism key: **JS** = JS thread (`mqt_v_js`); **UI** = Android main thread; **GPU**; **GC**; **NET** = network; **DEC** = hardware/software video decoders; **TD** = native teardown; **FD** = file descriptors.
Evidence key: **M** = measured on the phone (b8c8e98 unless stated otherwise); **C** = code proof; **H** = HYPOTHESIS, with the measurement that would confirm it.
Effort: S ≤ ½ day, M 1–2 days, L 3–5 days.

| ID | Symptom | file:line | What the code does | Why it is slow (mechanism) | Evidence | Impact | Fix sketch | Effort |
|---|---|---|---|---|---|---|---|---|
| **F1** | all (crash) | `src/features/live/pacedPlayer.ts:131-132`, `src/features/live/LiveWall.tsx:593,628-633`, `src/features/nation/NationHero.tsx:39-48`, `src/features/reels/ReelsView.tsx:297`, `src/features/feed/media/PostMedia.tsx:53-57` | Every player, WebView and socket holds file descriptors, and several paths create them without bound or keep them after they are no longer seen. Players are created in render (`useMemo`), so renders that never commit leave orphans that a sweeper frees later. Nation heroes stay alive under pushed routes. Hidden reels keep ~3 ExoPlayers. Feed cards keep a player per card that has ever been in view. | **FD / crash.** On this ROM a vendor thread in `libandroid_runtime.so` (`snct`→`ckdm`→`get_rdm`→`pllg`→`trtine`) calls `select()`, which aborts as soon as any fd number reaches 1024: `FORTIFY: FD_SET: file descriptor N >= FD_SETSIZE 1024`. | **M** tombstones on b8c8e98: 18:22:04 fd 1160, 18:26:14 fd 1801, 18:37:07 fd 1037 (the last one reproduced by this audit ~60 s after a cold start, on the second Feed→Globe entry). 20+ identical tombstones earlier today on older builds. | The app **dies** within 1–5 min of globe use. Nothing else matters until this is fixed. | Hard budget: at most N players + M WebViews app-wide (one pool shared by wall, reels, feed, search and nation hero), created in effects, never in render. Unmount (not pause) anything not visible. Count fds in a debuggable build: `run-as com.thevoid.app ls -l /proc/<pid>/fd`. | M |
| **F2** | 1, 3, 4 | `src/features/live/LiveWall.tsx:314-326` (`stopAll` → `nudge(false)`), `src/features/live/StreamTile.tsx:211-217,256-259,474-482` | "Stop all" on leaving the globe calls `nudge(false)`, which is a **play** operation: it calls `play()` on paused HLS tiles and posts `playVideo` to paused YouTube tiles. | **DEC / NET / UI.** Players keep downloading and decoding on every other tab. | **C**. Confirmed by the author session (`the-void-98`), fixed in 133d84c (`StreamTileHandle.stop()`), not in the measured build. | Every tab switch away from the globe inherits a live wall. | Already fixed upstream in 133d84c: verify on device. | S |
| **F3** | 3, 1 | `src/features/live/LiveWall.tsx:139,141-146,360,375-378,406-408,628-633` | Sleep (20 s away) never evicts: `recomputePlacement` returns at `:360` while inactive. On return, the render sets `activeRef=true` while `asleepRef` is still true, so `:375-378` evicts **every** tile. The next pass un-evicts them, and `:632-633` `connect(false)` runs for all of them **without a lane** (`lanes.acquire` is only in the mount effect at `:593`). `wakeAll()` (`:329`) plays them first. | **TD + UI + JS.** One commit destroys every WebView synchronously (not paced), and the next starts every cascade at once, with players created in render. | **C** trace (sent to and acknowledged by `the-void-98`; unfixed in 133d84c). **M**: returning to the globe after 25 s away gave worst stalls of 9.3 s and **45.8 s**, with ExoPlayer +13/−8 and **+29/−18** created/released in the window (a fresh entry is +9/−6). | Seconds-long freeze on returning to the globe. Big FD spike (feeds F1). | Evict while inactive and asleep (move the asleep branch above the `:360` return). On wake, reconnect via `lanes.acquire()` in viewport order. | S |
| **F4** | 3, 1, 4 | `src/features/live/StreamTile.tsx:190-201`, `src/features/reels/ReelVideo.tsx:27`, `src/features/feed/videoStore.ts:31` | Wall, reel and feed players are **muted**, but their audio track is never deselected, so each player keeps an audio decoder and AudioTrack. | **DEC + UI.** When the CPU is saturated, every audio underrun is an ExoPlayer analytics event posted to the **main looper**. | **M**: the ANR at 17:11:38 (build 2a58f47) had its main thread inside `AudioRendererEventListener.onAudioUnderrun` → `DefaultAnalyticsCollector.generateEventTime`, with **52 input events queued** ("input channel is full"). CPU at the ANR: app 313%, WebView renderer 103%, `media.swcodec` 74%, `media.codec` 51%, `kswapd0` 13%. | Taps are dropped for 5 s+ (ANR). The audio decoders add to decoder exhaustion. | Disable the audio track (track selection), not just `muted`, for every non-audible tile. Owner: `the-void-98` has taken this. | S |
| **F5** | 3, 1 | `src/features/live/constants.ts:23,63,71,102`, `src/features/live/LiveWall.tsx:388-400` | A 2-wide wall shows 6–8 tiles, and a tile in view is never evicted, so 6–8 decoders or WebViews run at once. The caps (4 lanes, 4 players, 2 WebViews) only bind off-screen tiles. | **DEC.** The MT6763 has few hardware AVC instances, so the rest fall to **`c2.android.avc.decoder` / `C2SoftAvcDec` (software)** on the CPU. | **M**: logcat on the wall shows `C2SoftAvcDec` and `oid.avc.decoder` (software). `media.swcodec` was at 74% CPU at the ANR. Per-window CPU on globe entry: WebView renderers 19–45 CPU-s, `ExoPlayer:Playback` up to 12.4 s, `MediaCodec_loop` 11 s. | The wall starves the UI, JS and GPU of CPU, so every other screen lags while it runs. | Cap **playing** tiles at the measured hardware decoder count (probe `MediaCodecList` for the instance limit; default 2–3 on low-end). Other tiles in view show poster or last frame and rotate. | M |
| **F6** | 1 (worst: Globe→any) | `src/features/globe/GlobeScreen.tsx:59-64,128-141,169-170,185-201` | Blur or a mode flip is one `setState` that, in a single commit, flips both `LoaderActiveContext` providers, deactivates LiveWall, (de)activates ReelsView, stops the GL loop, and also writes AsyncStorage and shows a toast. Globe→Reels starts reels seeding and 2–3 player creations in the same window. | **JS + UI + TD.** The work is proportional to wall tiles × loader dots, all in one frame. | **M**: Globe→Reels worst JS/UI stall **20.9 s**, 0.2 fps, 41 players released + 12 created in one window. Globe→Void/Search/Messages/Profile worst stalls 4.8/15.6/3.3/10.3 s. **C** as cited. | The "wave of lag" when leaving the globe. | Split into phases: stop the GL loop now; deactivate the wall next frame (paced); activate reels in the `withTiming` finish callback; defer the toast and storage write. | M |
| **F7** | 1 | `app/(tabs)/_layout.tsx:23,30,36`; `node_modules/react-native-screens/src/components/Screen.tsx:310-315` | `detachInactiveScreens={false}`, so rn-screens renders every hidden tab as an `Animated.View` with `display:'none'`. `freezeOnBlur:false`, so hidden tabs re-render on every store emit. `lazy:true`, so the first visit mounts the whole tab in the press commit. | **UI + JS.** A switch toggles `display` on two whole subtrees: Yoga relayout of both, `onLayout` in hidden screens, and the TextureView/SurfaceViews resized. **H**: confirm with a Perfetto count of UpdateLayout mount items on one switch. Hidden tabs keep rendering (see F13, F14). | **C**. **M**: `[switch]` press→focus from Globe: Void 1,679 ms, Messages 3,302 ms, Search 4,314 ms, Profile **8,902 ms**. | Every tab switch. | Keep screens attached, but hide them with `opacity:0` + `pointerEvents:none` + an offscreen transform (no relayout). `freezeOnBlur:true` for search, messages and profile. Pre-mount tabs with `navigation.preload` at idle after the first feed paint. | M |
| **F8** | 4, 3, 1 | `src/features/live/pacedPlayer.ts:129-139`; `node_modules/expo-video/.../VideoModule.kt:75-81` | `createVideoPlayer` runs inside `useMemo` during render: the ExoPlayer, MediaSession and listeners are built synchronously on the JS thread in the render pass. | **JS + FD.** Render pays the native construction. Renders that do not commit leak a player until the sweeper (F1). | **C**. **H**: time `pacedPlayer.ts:132`; expected 20–60 ms per player on this phone. | Reels entry (2–3 players in the first commit) and every swipe. Wall wake (F3). | Create players in an effect (or a pool of 3 that uses `replaceAsync`). Show the poster until then. | M |
| **F9** | 2 | `src/features/globe/GlobeCanvas.tsx:88-115,127-128`; `src/features/globe/globeScene.ts:109-110,327-363`; `GlobeCanvas.tsx:216` | three.js renders on the **JS thread** via expo-gl. Drag is `Gesture.Manual().runOnJS(true)`. The gesture object is rebuilt every render. Constant drift (`tRotY += 0.0015*dt`, `:339`) means the loop never idles. `msaaSamples={4}`, `highp`, full-resolution buffer. | **JS + GPU.** Any JS stall (wall messages, GC, reels) stops both input and drawing. 4× MSAA on a Mali-class GPU. | **M**: 10 s drag (wall live): **0.5–1.8 fps**, worst frame 2.8–9.8 s, stalls up to 34 s. **C** as cited. Note: on b8c8e98 the earth map is not actually sampled (per `the-void-98`, fixed in 133d84c), so texture cost here is the fallback's. | Globe stutter while dragging. | Memoise the gesture, `msaaSamples={0}`, `mediump`, buffer ≤1.5×. Render only dirty frames. Move touch tracking into a worklet (shared values) that the frame reads. | M |
| **F10** | 2 | `src/features/globe/GlobeCanvas.tsx:79-81,88-115` | After a GL retry, `setSceneReady(true)` does not change state (it is already true), so the loop effect `[sceneReady, running, appActive]` never re-runs. | **Logic.** The globe stays black or frozen until the user leaves and returns. | **C**. **M** (other session): smoke checks "globe canvas is not blank" and "globe still draws after leaving and returning" FAIL in `D:/void-phone/perf-forever.log` #300. | "The globe never shows". | A `sceneGen` counter in the deps. Dispose the old scene. | S |
| **F11** | 3 | `src/features/live/useStreamCascade.ts:92-108`; `src/core/streams/probe.ts:24-38` (unused); `src/features/live/StreamTile.tsx:112,177-189,224-237,462-468`; `src/features/live/LiveWall.tsx:184,239-247` | Sources are tried strictly one after another, each with a full 8–9 s connect timeout; no HLS preflight (`createPreflight` exists but is only used by the nation hero). HLS: the master is fetched twice (ExoPlayer plus `variantFor`), then the player is **re-created** on the variant, while the 8 s timer is not reset. Then a 700 ms wait plus an unpaced `captureRef` frame judge that is useless on a SurfaceView. YouTube: a 3.2 s veil plus a 450 ms fade after it is already playing. The next batch waits for the slowest tile. | **NET + UI.** | **C** timeline: HLS min ≈ network + 1.15 s, worst 24 s per tile; YouTube worst 27 s; tile 12 of the first batch up to ~73 s. **M**: the first wall tile area was moving 3.6 s after entry, the median tile area at 12.3 s (±3 s screencap resolution). | "Streams take too long to start". | Parallel preflight of every chain URL at lane acquire; wait ≤600 ms for the variant before creating the player; skip the frame judge on SurfaceView; reveal YouTube at state 1 + ≤1.2 s; batches don't wait for stragglers. | M |
| **F12** | 1, 3, 2 | `src/ui/loaders/useLoaderClock.ts:50-73,90-116`; `src/ui/SparkleLoader.tsx:46-58`; `src/features/live/TileChrome.tsx:14-29,118-119` | Every SparkleLoader is 14 dots, each with its **own** native `Animated.loop` (~98 animated nodes per loader), and its **own** focus listener that `setState`s on blur/focus. The wall keeps a loader on every non-playing tile (20–30 realistic); none is gated on the viewport. The LiveDot loop never pauses. | **UI + JS.** ~300–400 native loops stepped per frame on the UI thread. Each tab switch triggers N re-renders and ~3×14×N native animation ops. | **C**. **H**: count live loops (module counter at `useLoaderClock.ts:104/111`) and systrace `NativeAnimatedNodesManager.runUpdates`. | UI-thread load on the wall; a burst on every switch. | One shared native clock per app (dots are `Animated.modulo(add(clock, lead))`); one focus store per screen; gate on the viewport; pause LiveDot with `useLoaderShown`. | M |
| **F13** | 1, 4 | `src/features/reels/reelStore.ts:35-48`; `src/features/feed/reactions.ts:26`; `src/features/feed/audioStore.ts:31-34,98-127,149-156`; `src/features/feed/media/AudioPill.tsx:36-37` | A global version counter: one bolt/repost/follow anywhere re-renders **every** mounted PostCard on every surface, hidden tabs included, plus every reel cell. While audio plays, the audio store emits every 100 ms and every AudioPill re-renders its 26 bars. | **JS.** | **C**. **H**: a Profiler render counter on PostCard during a reel bolt. | Taps in reels feel heavy; background churn on the JS thread. | Per-post subscriptions (the `touchPost` map already exists at `reactions.ts:15`); select `state.postId===id`; drive the wave with shared values. | S |
| **F14** | 1 | `src/features/messages/dmStore.ts:26-36,91-137,210-216,256-262`; `src/features/profile/ProfileScreen.tsx:63,85-90` | `emit()` always makes a new snapshot, and `useDmStore()` returns all of it. The hidden Messages and Profile tabs re-render on every emit: every 60 s (the badge poll, which also runs in the background), and every 5 s while a chat is open, even with no new messages. Each Profile focus refetches and rebuilds its Post objects (defeating `memo`). | **JS**, in the sync lane, so it cannot be interrupted during a switch. | **C**. | Random JS stalls that land mid-transition. | Selector hooks; skip no-op emits; gate the poll on AppState; stale-while-revalidate on Profile. | S |
| **F15** | 4 | `src/features/reels/ReelsView.tsx:206-228,298,318-322,343`; `src/features/reels/ReelItem.tsx:126-137,184-195,232-236` | Each swipe causes 3–4 commits (`setCur`, `setViewedTick`, append, `setCleared`), and `renderItem` deps include all of them, so every cell re-renders. `Act` is a component **defined inside render**, so the action rail (~15 native views) remounts on every re-render. Gestures are rebuilt each render. "Warm next two" is false: `windowSize=3` renders ±1. | **JS + UI** view churn. | **C**. **M**: Globe→Reels 0.2 fps over 6 s, worst frame 5.3 s. | Swipe lag. | Hoist `Act`; `useMemo` the gestures; pass `cur` via a store so only 2 cells re-render; keep `viewed`/`cleared` in refs. | S |
| **F16** | 1, 3 | `src/features/search/searchModel.ts:171,181-182`; `src/features/search/SearchScreen.tsx:84-87,113-126` | The "unchanged set" signature includes `liveCursor`, which advances on every build, so it never matches. Every focus or discovery event re-keys the 3 live slots (WebViews and players destroyed and recreated) and resets `shown` to 4 (blocks 5–19 unmount, then remount 3 per 90 ms). | **TD + JS + FD.** | **C** (sent to `the-void-98`). | Entering Search stutters; live tiles restart every time. | Leave `liveCursor` out of the signature; rotate only on a real refocus; keep `shown` when the ids are unchanged. | S |
| **F17** | 3, 4 | `src/features/feed/media/PostMedia.tsx:53-57,62-68`; `src/features/feed/viewability.ts:57-70`; `src/features/profile/ProfileScreen.tsx:51,235` | A feed or profile clip plays while ≥60% in view. The in-view set is only cleared on unmount, and tabs never unmount, so the clip **keeps decoding on the globe, reels and every other tab**. The player is kept for every card that has ever been in view. | **DEC + FD.** It competes with the wall and reels for the few hardware decoders. | **C**. **H**: `dumpsys media.resource_manager` on the globe after scrolling a video into view on the feed. | Slower wall and reel starts; more FDs. | `useFocusEffect` blur → `setInView(surface, [])`; release players >2 s out of view (paced). | S |
| **F18** | 4 | `src/features/globe/GlobeScreen.tsx:188`; `src/features/reels/ReelsView.tsx:297` | ReelsView stays mounted permanently. When not live only `want` flips, so ~3 paused ExoPlayers with 8 s buffers and MediaSessions stay alive in GLOBE mode, on other tabs and in the background. The `/reels` overlay adds 3 more. | **DEC + FD + memory.** | **C**. | The wall starts slower after visiting reels. | When `!live`: keep only the current card's player (or none) and release the rest through the paced queue. | S |
| **F19** | cold start | `src/lib/core.ts:30-41,109,137`; `src/core/api/auth.ts:130` → `src/features/auth/coreBridge.ts:78-81`; `src/core/index.ts:7-15`; `src/core/data/sources.ts:3-6`; `app/_layout.tsx:48-49,102-111`; `metro.config.js` | The splash waits on: a full AsyncStorage `getAllKeys` + `multiGet` (every key, including ~300 KB of seen-sets), up to 3 s of `ensureCore`, and a forced token refresh. The root imports the `core` barrel (373 KB of generated stream literals, evaluated at load), the `features/live` and `features/photo` barrels. No `inlineRequires`. three.js is prefetched 4 s after Shell mounts, i.e. mid-feed. | **JS + NET.** | **M**: `am start -W` TotalTime median **2,759 ms** (5 runs, 2,743–2,773); the feed then renders at p50 33–69 ms and p95 200–339 ms per frame for the next 12 s. | Cold start above the 2 s target; a janky first 10 s. | Hydrate an allowlist; move `ensureCore` and refresh off the splash; lazy-`require` the generated data; `inlineRequires: true`; move the globe prefetch to after interactions. | M |
| **F20** | cold start, 1 | `src/lib/sensing.tsx:40-51,65-70,83-103`; `modules/expo-void-sensing/.../MotionCapture.kt:92-97,105-128`; `ExpoVoidSensingModule.kt:118-129,291,652-655` | First run auto-grants motion+touch and starts LINEAR_ACCEL + GYRO at 50 Hz each, delivered on the **main looper** (no Handler), allocating per sample. Proximity and light run without a consent check. An `onAffect` event every 2 s re-renders the root `SensingProvider`. Its only output, `BIO.setAffect`, has **no caller**. Three `EncryptedSharedPreferences` (Tink/Keystore) are built in `OnCreate`. | **UI + GC** (100 callbacks/s); **JS** (a root commit every 2 s); cold start. | **C**. **H**: `dumpsys sensorservice` active connections; A/B tab-switch time with the kill switch on. | Constant UI-thread noise; cold-start cost. | Don't auto-start (the output is unused); pass a `HandlerThread`; keep `affect` in a ref; build prefs lazily off the main thread. | S |
| **F21** | 1, 2, 3 | `src/core/slow.ts:12-26,52-68`; `src/nav/switchTiming.ts:19-31` | The `[block]` heartbeat (100 ms tick, `LATE_MS` 300) only reports gaps ≥ ~400 ms. It also fires when the **UI thread** is blocked (RN timers are driven from Choreographer), and it fires falsely after resume. `timed()` wraps only synchronous calls, so the React render that a `setState` schedules is never inside it. `[switch]` stops at focus, before the follow-up renders and the first painted frame. | **Diagnostics.** This is why "the feed functions never show as slow" while the thread is blocked: the tools cannot see render work, and they blame JS for native stalls. | **C**. **M**: on return to the globe `[switch]` reported `globe 322–326 ms` while the same windows had stalls of 9.3 s and 45.8 s. The logcat ring buffer (256 KiB) is overwritten by MediaTek `GED`/`VDO_LOG` spam within seconds, so scripts that read `logcat -d` after a run (jank-loop, perf-forever) silently lose `[block]` lines. | Wrong turns in every past investigation. | A UI-runtime frame-gap probe (Reanimated `useFrameCallback`) alongside the heartbeat; `LATE_MS` 100 in perf builds; `React.Profiler` around `<Tabs>`, `<LiveWall>` and `<ReelsView>`; the switch mark after a double rAF. | S |
| **F22** | 3, 1 | `src/features/live/AudioOwner.tsx:220-223`; `src/features/live/StreamTile.tsx:81,135,172,288,372,396` | The context value changes with `audibleId`, so one tap re-renders every tile (2 hooks each), NationScreen, every feed AudioPill, ComposerSheet and ReelsView. HlsPlayer effects depend on `audio`, so every tile removes and re-adds its listeners and calls `muted`/`play()`/`pause()`. | **JS + UI** (JSI calls to main). | **C**. | Tap-for-sound hitch. | Split into a stable actions context plus a per-tile `audibleId` selector. | S |
| **F23** | 3 | `src/features/live/LiveWall.tsx:201,237,154-163,250,337-338`; `src/features/live/TileChrome.tsx:117` | Tiles only accumulate and are never unmounted. Every first success does `setOrder({...prev})` plus a full sort, so every tile in between gets new `left`/`top` props. Timers are never cleared (AppState resume, `healVisible`). | **JS + UI** layout. | **C**. | Wall hitches grow over the session. | Virtualise the wall (FlashList masonry or a windowed absolute layout); stable positions; clear timers. | M |
| **F24** | 1 | `src/features/feed/VoidFeedScreen.tsx:57,91-95,110-119,156-169,197,219-236`; `src/features/feed/PostCard.tsx:72-79,111,116` | A 30 s `useTick` re-renders the whole feed (hidden too) without updating the labels. The `index` prop means a head trim re-renders every card. JS `onScroll` fires every 16 ms. Every card has a 30 px blurred `boxShadow`, an inset shadow and a persistent Reanimated fade. Still a `FlatList`. | **JS + UI/GPU.** | **C**. | Scroll and return-to-feed cost. | Remove the tick or gate it on focus; a stable per-post seed; `useAnimatedScrollHandler`; a 9-slice shadow image; FlashList v2. | M |
| **F25** | 2 | `src/features/globe/textures.ts:41-89,312,331-340,359-362`; `src/features/globe/globeScene.ts:82-91` | Synchronous `gl.getError()` loops and `getParameter` right after the first render; three's `checkShaderErrors` on by default; anisotropy at the GPU max (up to 16×). The fallback path copies an 8 MB raw map through JS and keeps `rawCache` (8 MB) forever. | **JS** waits on the GL thread (shader compile); **GPU** filtering. | **C**. **M** (other session): first-entry worst block 1,905 ms on b8c8e98. | Slow first globe render. | `checkShaderErrors=__DEV__`; drop the getError loop; anisotropy ≤4; free the raw buffer. | S |
| **F26** | nation → reels | `src/features/nation/NationHero.tsx:39-48`; `src/features/nation/useNationHero.ts:161`; `src/core/feed/nation.ts:488-539` | The nation screen stays mounted under `/reels` and other pushed routes. Its hero StreamTile has no `active`/`parked` prop and keeps decoding. The heal interval and the empty-feed retries (each a full 35–60 request fan-out) keep running. | **DEC + FD + NET.** | **C** (also independently found by `the-void-98`). | Reels entered from a nation lag; FD growth per nation visited. | A `useIsFocused` gate that parks the hero and pauses the timers. | S |
| **F27** | 4 | `src/core/feed/reels.ts:85-87,109-110,138-161`; `src/lib/net.ts:42` | Reel sources are strictly sequential (1 search + up to 8 `ptDetail` awaits + up to 10 Bluesky pages ≈ 28 round trips) behind the `_reelLoading` lock. The deadline timer is cleared on headers, so body reads are unbounded. | **NET.** | **C**. | First reel is slow on 4G. | `Promise.allSettled` 4-wide; race sources; keep the deadline through the body. | S |
| **F28** | general | `src/core/rank/tags.ts:54-86`; `src/core/rank/order.ts:25-41,50-98`; `src/core/rank/seen.ts:38-52,79`; `src/lib/core.ts:84` | `inferTags` runs ~351 regexes per post in every normaliser (unwrapped). `diversify`/`spreadSubjects` are O(n²) with uncached `subjectOf`. Seen ids are stored raw (~300 KB) and re-stringified every 15 s when dirty. | **JS** bursts invisible to `[slow]`. | **C**. **H**: `timed` around `bluesky.ts:120-130` and `lib/core.ts:72-73`. | Periodic 50–150 ms hitches. | One alternation per tag; cache `_subj`; hash ids; MMKV or delta writes. | S |
| **F29** | thread, chat | `src/features/thread/ThreadScreen.tsx:293,458-480`; `src/features/thread/ReplyOverlay.tsx:110-126`; `src/features/messages/ChatScreen.tsx:88-118` | Threads render all comments in a ScrollView, and every keystroke re-renders the OP, all comments and the overlay tree. Chat renders up to 200+ bubbles, each with its own native LinearGradient, in one commit. | **JS + UI.** | **C**. | Typing lag; slow chat open. | Uncontrolled input; FlatList; memoised rows; one shared gradient. | M |
| **F30** | build | `app.json:111,113-124,134-142`; `package.json:28,42`; `.github/workflows/android-aab.yml:79` | No R8/minify/shrinkResources; two ABIs; `expo-camera` (~9 MB barcode ML, zero JS imports) and `expo-sharing` still shipped; the `expo-dev-client` plugin in every profile; no Reanimated static flags. Hermes on; New Arch on (RN 0.86.3). | Class loading / install size / cold start. | **C**. **M**: the APK is 103.1 MB (`rb8c8e98`). | Cold start, install. | See prior P0-12. | M |
| **F31** | network | `src/lib/supabase.ts:17`; `src/core/feed/voidFeed.ts:24-38,113-122`; `src/core/feed/bluesky.ts:118-130`; `src/core/feed/reddit.ts:44-56` | supabase-js gets no `global.fetch`, so auth refresh, `ensureSession`, uploads and delete have **no deadline**. The feed pull is proxy → Bluesky (6 feeds in sequence) → Reddit (8 subs in sequence). | **NET.** | **C**. | A stuck feed or composer on bad networks. | `createClient(..., { global: { fetch: fetchWithDeadline } })`; race the feeds. | S |

## 3. What X and Instagram do that The Void does not

Both apps hold far more data than The Void and stay at 60 fps on phones like this one. They get there by owning a small set of expensive native resources explicitly, and never letting React decide when those are created or destroyed.

| # | X / Instagram practice | What The Void does instead | Findings |
|---|---|---|---|
| 1 | **A fixed pool of video players** (Instagram reuses 2–3 ExoPlayer instances for the whole app; feed, reels and stories borrow and return them). The pool size is derived from the device's real decoder count (`MediaCodecList` / `MediaCodecInfo.getMaxSupportedInstances`). | Every surface creates its own players, in render, with no global cap. Wall + reels + feed + search + nation hero can hold 20+ at once. The MT6763 then falls back to software AVC and crashes at 1024 fds. | F1, F5, F8, F17, F18, F26 |
| 2 | **One playing video at a time on screen** (X autoplays only the most-visible item; Instagram's grid and Explore show stills or a single preview). | The wall plays every tile in view, 6–8 at once, by design. | F5, F11 |
| 3 | **Hidden = released** (a backgrounded tab's players go back to the pool; WebViews are never kept for off-screen content). | Hidden tabs keep players playing (F2, F17). Sleep never evicts (F3). Reels keep 3 players in GLOBE mode (F18). | F2, F3, F17, F18 |
| 4 | **Audio disabled on silent autoplay** (track selection drops the audio renderer until the user unmutes). | `muted = true` only; an audio decoder plus AudioTrack per tile. Underruns flood the main looper (ANR). | F4 |
| 5 | **Frozen inactive screens** (RN apps: `react-freeze` / `freezeOnBlur`; native apps: a paused fragment/VC lifecycle). Store updates never reach hidden screens. | `freezeOnBlur:false` everywhere. Hidden Messages/Profile/Feed re-render on DM polls, reaction bumps and audio ticks. | F7, F13, F14 |
| 6 | **Staged transitions** (the animation first, then the teardown of the old screen, then the heavy mount of the new one, each in its own frame or on idle). | One `setState` flips the globe loop, wall, reels, loaders, storage and toast in a single commit. | F6, F3 |
| 7 | **Cell recycling** (Instagram's IGListKit/RecyclerView; X's RecyclerView; RN apps use FlashList). Constant view count regardless of data size. | FlatList everywhere. The wall is a non-virtualised ScrollView whose tiles are never unmounted. Threads and chat use plain ScrollViews. | F23, F24, F29 |
| 8 | **Prefetch and preflight** (the next items' manifests and first segments are fetched while the current one plays; dead URLs are known before a player is spent on them). | The cascade is strictly sequential, with 8–9 s timeouts per source, no preflight (the code exists but is unused), and a double HLS connect. | F11, F27 |
| 9 | **Rendering off the JS thread** (native views and GL on a render thread; gestures on the UI thread). | three.js on the JS thread; drag delivered to JS via `runOnJS(true)`. | F9, F25 |
| 10 | **Per-item subscriptions** (a like re-renders one cell). | A global version counter re-renders every card on every surface. | F13, F22 |
| 11 | **Poster first, video on demand** (a still image paints in under 100 ms; the player attaches when the item settles). | Mostly done for YouTube tiles (P0-3), but the veil hides a playing video for 3.65 s and HLS tiles show a loader until the frame judge finishes. | F11 |
| 12 | **A startup budget** (Instagram's cold start only hydrates what the first screen needs; everything else is lazy-loaded after first draw). | A full AsyncStorage hydrate plus network on the splash, 373 KB of generated data evaluated at import, no `inlineRequires`. | F19, F30 |
| 13 | **Production perf telemetry** (frame and ANR tracing per build; regressions blocked in CI). | Homemade heartbeat that can't see <400 ms stalls or tell JS from UI; no Sentry; no CI perf gate. | F21 |

## 4. Status of every item from PERFORMANCE_AUDIT.md (checked at b8c8e98)

| Item | Status | Proof |
|---|---|---|
| P0-1(a) loader pause on blur/hidden/background | **Fixed** | `src/ui/loaders/useLoaderClock.ts:50-73`, `GlobeScreen.tsx:187-200` |
| P0-1(b) no per-dot frame callbacks | **Partly fixed** | Native driver now (`useLoaderClock.ts:90-116`), but still one loop per dot, 14 per loader (F12) |
| P0-1(c) static NO SIGNAL / (e) stop before fade | **Fixed** | `SparkleLoader.tsx:107`, `TileChrome.tsx:119` |
| P0-1(d) YouTube hold reuses the tile loader | **Fixed** | `StreamTile.tsx:566` poster + veil; one TileLoader |
| P0-1(f) SVG icon storms | **Fixed for icons** / open for `RadialFill` | `ui/icons/Glyph.tsx:100-110`, `feed/vmodIcons.tsx:26-28`; `ui/Surface.tsx:75-92` still react-native-svg |
| P0-1(g) paced player release | **Fixed** (players) / **open** (WebViews) | `live/pacedPlayer.ts:21,36-67`; WebView destroys are still synchronous and unpaced (F3) |
| P0-2 wall runs when hidden | **Still open, made worse in b8c8e98** | `LiveWall.tsx:314-326` stopAll *plays* (F2, fixed upstream 133d84c); sleep never evicts `:360` (F3); caps only bind off-screen `:388-400` (F5) |
| P0-3 YouTube poster-first, quiet message loop | **Mostly fixed** | Poster `LiveWall.tsx:643-662`; `info` on change or every 5 s `ytHtml.ts:52-60`; still 1 Hz before PLAYING and a never-cleared `kick` interval `ytHtml.ts:47` |
| P0-4 MJPEG/iframe parking | **Partly fixed** | MJPEG honours `parked` (`StreamTile.tsx:584-606`) but `parked` is never set while inactive; iframe tiles are still unparked (`:636`) |
| P0-5 HLS frame check | **Fixed mid-stream**, open at connect | 15 s paced sampler, skipped on SurfaceView (`StreamTile.tsx:73,336`); the connect-time judge is still unpaced and runs on SurfaceView (`:224-237`) |
| P0-6 globe loop and draw cost | **Mostly fixed** | Loop stops when not running (`GlobeCanvas.tsx:88-115`); 199 sprites → one `Points`, ~5 draw calls (`globeScene.ts:209-255`); shader facing test instead of depth. **Open:** `msaaSamples={4}`, `highp`, full-res buffer, dirty-only rendering, static fallback image, and the new retry bug (F10) |
| P0-7 reels "PULLING SIGNAL" forever | **Mostly fixed** | Stall timer, tap-to-retry, auto-retry (`ReelsView.tsx:175-198`). Open: sequential PeerTube details (`reels.ts:85-87,109-110`); blank `/reels` overlay dead end (`ReelsView.tsx:347`); mode read from the sync store (`persist.ts`) |
| P0-8 network deadlines | **Fixed at the core seam** | `lib/core.ts:121` → `lib/net.ts:29-43` (12 s / 90 s). Open: supabase-js has none (`lib/supabase.ts:17`, F31); body reads unbounded (`net.ts:42`) |
| P0-9 splash waits on the network | **Open** | `lib/core.ts:30-41,137`; forced refresh `auth.ts:130` → `coreBridge.ts:78` |
| P0-10 startup bundle graph | **Open** | `core/index.ts:7-15`, `data/sources.ts:3-6`, `app/_layout.tsx:48-49`; no `inlineRequires` in `metro.config.js` |
| P0-11 freeze tabs | **Deliberately reversed** (`freezeOnBlur:false`, `detachInactiveScreens={false}`) | `app/(tabs)/_layout.tsx:23,30,36`. Moves the cost into display:none relayouts and hidden re-renders (F7) |
| P0-12 release build optimisation | **Open** | `app.json:113-124` (no R8/shrink), `app.json:134-142` + `package.json:28` (expo-camera), `package.json:42` (expo-sharing), two ABIs `android-aab.yml:79`. APK 103.1 MB (was 100.8) |
| P1-1 card shadows / per-card fade | **Open** | `PostCard.tsx:72-79,116`; `AudioPill.tsx:94-95` |
| P1-2 global re-render fan-outs | **Open** | `feed/reactions.ts:26`, `reelStore.ts:35-48`, `audioStore.ts:149-156`, `AudioPill.tsx:36-37` |
| P1-3 FlashList / drop `index` / animated scroll | **Open** | `VoidFeedScreen.tsx:197,219,225-226`; `ReelsView.tsx:327` |
| P1-4 Reanimated sync UI props flag | **Open** | No `reanimated.staticFeatureFlags` in `package.json` |
| P1-5 AudioOwner context churn | **Open** | `AudioOwner.tsx:220-223`; `StreamTile.tsx:135,288,372` (F22) |
| P1-6 feed images `thumb` not `fullsize` | **Open** | `core/feed/bluesky.ts:79` |
| P1-7 offline / resume | **Open** | No NetInfo anywhere in `src/` |
| P1-8 error boundaries + crash reporting | **Open** | Only the root `ErrorBoundary` (`app/_layout.tsx:63`); no Sentry |
| P1-9 proxy hardening | **Open** | `void-proxy/server.js` (937 lines): no upstream timeouts, `Cache-Control`, compression or single-flight |
| P1-10 feed DB index | **Open** | No `008_perf.sql`; no `posts (created_at …)` index in `supabase/migrations/*` |
| P1-11 DM polling → realtime | **Open** | `messages/dmStore.ts:91-137,256-262`; badge poll ignores AppState (F14) |
| P1-12 nation fan-out | **Open** | ~35–60 requests per open; dead `/streams` call `core/streams/nation.ts:62` |
| P1-13 reels proxy endpoint | **Open** | `core/feed/reels.ts:50-164` |
| P1-14 auth robustness | **Open** | `coreBridge.ts:79-81` wipes on any error; no lock on `signInAnonymously` (`auth.ts:46`, `media.ts:42`) |
| P1-15 posts keyset cursor | **Open** | `core/api/voidApi.ts:94` |
| P2-1 unbounded pools | **Partly fixed** | `STORE_MAX` 600/300 (`core/feed/store.ts:32`), but `_offFeed`, search, replies, nation and reels pools are uncapped; `findPost` O(n) |
| P2-2 persisted state growth | **Partly fixed** | Seen-sets dirty-flagged; ids stored raw (`rank/seen.ts:79`); `vc_*` keys never expire (`api/replies.ts:223-226`) |
| P2-3 tests / typecheck / lint in CI | **Partly fixed** | `test` and `typecheck` scripts exist (`package.json`); no workflow runs them; no ESLint |
| P2-4 four copies of the web app | **Open** | `void2-final.html`, `copy33thevoid.html`, `void-app/assets/void.html`, `void-proxy/public/*.html` all present |
| P2-5 two session stores | **Open** | `lib/supabase.ts` + `core/api/auth.ts:31` + `coreBridge.ts` |
| P2-6 empty catches / `as any` | **Made worse** | 171 empty-ish catches (was 122), 139 `as any` (was 113) in `app/` + `src/` |
| P2-7 reactions hot rows | **Open** | No counter table in the migrations |
| P2-8 profile counts pull 2,000 rows | **Open** | `ProfileScreen.tsx:73-74` |
| P2-9 proxy horizontal state | **Open** | `void-proxy/server.js` in-memory caches |
| P2-10 dead code | **Partly fixed** | Mod icon sets merged (`reels/ModIcons.tsx:3-7`); `ui/ScreenPlaceholder.tsx` unused; `core/streams/probe.ts` unused; `wall.ts:124 healChain` unused |
| P2-11 view-shot + fflate | **Open** | `live/frameSample.ts:19,29` |
| S-1 OAuth PKCE | **Open** | `lib/supabase.ts:23` `flowType: 'implicit'` |
| S-2 tokens in AsyncStorage, `allowBackup` | **Open** | No `allowBackup:false` in `app.json`; `authActions.ts:207-208` |
| S-3 Apple revoke on delete | **Fixed server-side** | `supabase/functions/delete-account/index.ts:104` calls `appleid.apple.com/auth/revoke` (needs `APPLE_*` secrets); client TODO remains at `DeleteAccountSheet.tsx:78-86` |
| S-4 privacy manifest | **Partly fixed** | `app.json:51` now declares `NSPrivacyCollectedDataTypes`; contents not re-audited here |
| S-5 proxy abuse | **Open** | `void-proxy/server.js` |
| S-6 anonymous auto-hide | **Not re-checked** | No new migration since 007 |
| S-7 WebView hardening | **Open** | `core/streams/keys.ts:15` unanchored allowlist |
| S-8 `Linking.openURL` any scheme | **Open** | `ThreadScreen.tsx:401,435` |

## 5. Fix order (small, shippable steps; no feature removed)

Every step is one commit, verified on `R5CYA0GF6FP` with the same harness (`D:/void-phone/f3/f3.mjs`, method in §1.1) before the next. The targets are the user's: **60 fps, input response <100 ms, JS stall <150 ms, janky frames <5%, cold start <2 s.** Steps 1–3 must happen first. While the app crashes within minutes and runs software decoders, no frame metric can be meaningful.

| Step | Change (findings) | Metric it moves | Pass condition before moving on |
|---|---|---|---|
| **0. See clearly** | UI-runtime frame-gap probe next to the heartbeat; `LATE_MS` 100 in a perf build; `React.Profiler` on `<Tabs>`, `<LiveWall>`, `<ReelsView>`; streamed-logcat harness (F21). One **debuggable** diagnostic build to count fds by type (`run-as … ls -l /proc/<pid>/fd`), on the user's say-so. | Attribution (JS vs UI vs native) | Every stall ≥100 ms in a run is labelled JS or UI |
| **1. Stop the crashes** | One app-wide **media budget**: N players + M WebViews total across wall, reels, feed, search and nation hero, N = measured hardware AVC instances (2–3 here). Players are created in effects (pooled or paced), never in render (F1, F8). Hysteresis on mount/unmount (being done upstream, after 6005523). Pace creation as well as release. | Crashes; fd count; `media.swcodec` CPU | 0 tombstones in a 10 min soak across all tabs; `C2SoftAvcDec` absent from logcat on the wall |
| **2. Hidden means stopped** | `stopAll` really stops (F2, done in 133d84c); sleep evicts (F3); feed/profile clips pause and release on blur (F17); reels keep ≤1 player when not live (F18); nation hero unmounts when covered (F26, done in 207f682); audio track disabled on non-audible tiles on **every** surface, not only wall HLS (F4). | CPU and decoders on non-globe tabs | 10 s after leaving the globe: WebView procs + ExoPlayer + MediaCodec threads ≤5% CPU; `media.resource_manager` shows ≤1 video codec |
| **3. The wall fits the device** | Cap *playing* tiles at the decoder budget; the rest show poster or last frame and rotate (F5). Reconnect through lanes in viewport order (F3). Virtualise the wall; stable positions (F23). | Globe fps; wall CPU; memory | Globe idle ≥30 fps with the wall live; PSS on the wall < 400 MB |
| **4. Transitions in phases** | Globe blur/mode flip split into frames: GL stop now → wall deactivate next frame → reels activate on slide end → toast/storage idle (F6). Hide tabs without `display:none` (opacity + offscreen transform), `freezeOnBlur` for search/messages/profile, `navigation.preload` at idle (F7). Search signature fix (F16). | Longest JS/UI stall per switch; switch → settled | Globe→any tab: longest stall <150 ms, janky frames in the 1 s after the tap <5%, first response <100 ms |
| **5. One clock, not four hundred** | A shared native loader clock and a per-screen focus store; loaders gated on the viewport; LiveDot pauses (F12). | UI-thread CPU on the wall; tab-switch burst | UI thread <40% on the wall with loaders visible |
| **6. Streams start fast** | Parallel preflight per chain; variant resolved before the player (≤600 ms); skip the frame judge on SurfaceView; YouTube reveal ≤1.2 s after state 1; batches don't wait for stragglers (F11). | Tap → first video frame per tile | Median tile <2.5 s on Wi-Fi; first tile <1.5 s |
| **7. Globe at 60** | Memoised gesture, touch in a worklet; `msaaSamples={0}`, `mediump`, buffer ≤1.5×, dirty-only rendering; `checkShaderErrors=__DEV__`, no getError loops; retry bug (F9, F10, F25). Verify the real earth map (133d84c) on device. | Drag fps; time to first globe frame | Drag p95 frame <20 ms; first globe frame <500 ms after the tap |
| **8. Reels swipe** | Hoist `Act`, memoised gestures, `cur` via a store, refs for viewed/cleared (F15); players from the pool (F8); parallel reel sources (F27). | Swipe → next reel playing; commits per swipe | ≤1 commit touching >2 cells per swipe; next reel plays <300 ms |
| **9. Quiet background** | Per-post reaction subscriptions, audio pill selector (F13); dmStore selectors + no-op emits + AppState gate (F14); AudioOwner split (F22); sensing not auto-started, off the main looper (F20); feed tick/index/onScroll (F24). | JS commits per minute while idle | 0 commits/min on a hidden tab; ≤1/min on the visible idle feed |
| **10. Cold start** | Allowlist hydrate; `ensureCore` + refresh off the splash; lazy generated data; `inlineRequires`; globe prefetch after interactions; lazy sensing prefs (F19, F20). | `am start -W`; time to first feed content | TotalTime <2,000 ms median of 5; feed cards visible <2.5 s |
| **11. Lean binary** | R8 + shrink + keep rules; drop expo-camera/expo-sharing (keep the permissions via the sensing plugin); arm64-only preview; dev-client plugin out of release (F30). | APK size, class-load time | APK <45 MB; cold start improves again |
| **12. Lists and long screens** | FlashList v2 for feed/reels/nation; ThreadScreen and ChatScreen virtualised with uncontrolled input (F24, F29); `thumb` images (P1-6). | Scroll jank, typing latency | Feed scroll janky <5%; keystroke → echo <50 ms on a 100-reply thread |
| **13. Network resilience and scale** | supabase-js deadline (F31); race the feed sources; proxy hardening + CDN (P1-9); nation aggregate (P1-12); DM realtime (P1-11). | Time to first content on 3G | Every screen reaches content or a retryable error within 12 s on EDGE |

## 6. Coverage checklist

Every source file in `void-app/app` and `void-app/src` at b8c8e98 (227 files, 32,523 lines), plus the runtime configs and the Android side of the native sensing module. Ten parallel readers each read every line of their files in full, one area each: nav/startup/config, globe/GL, live wall, streams/data, reels/search, feed/thread, network/nation, stores/screens, UI/animation/rank, tests/native. Each reader returned its own checklist. The lead re-read the code behind every top-5 finding.

Notes:
- `lines read` equals `actual lines` for every file. Actual counts come from `wc -l` on the snapshot. Some viewers show one extra line for a trailing newline; those were reconciled.
- `src/features/globe/earthTexture.ts` is 4 lines, but line 4 is one 765,609-character base64 literal. The Read tool refused the 748 KB line, so it was read with `awk`.
- `src/core/data/iptv.generated.ts` (2,501 lines, 263 KB) was paged through in six reads.
- **Excluded, with reason:** `modules/expo-void-sensing/ios/*` (20 Swift files and a podspec), which do not run on Android. `node_modules` was not audited line by line; specific library files were read to confirm behaviour (react-native-screens `Screen.tsx`, expo-router `BottomTabView.js`, expo-video `VideoModule.kt`, expo-gl `GLView.kt`, RN Fabric feature flags). There is no `android/` directory: it is generated by prebuild, and the build settings come from `app.json` / `app.config.js` / `eas.json`.
- Tests and fixtures (`src/core/__tests__/*`) are imported by no runtime code; they were confirmed and read anyway.

| # | file (void-app/) | area | lines read | actual lines | match |
|---|---|---|---|---|---|
| 1 | `app/(tabs)/_layout.tsx` | A nav/startup | 42 | 42 | ✅ |
| 2 | `app/(tabs)/globe.tsx` | A nav/startup | 11 | 11 | ✅ |
| 3 | `app/(tabs)/messages.tsx` | A nav/startup | 10 | 10 | ✅ |
| 4 | `app/(tabs)/profile.tsx` | A nav/startup | 9 | 9 | ✅ |
| 5 | `app/(tabs)/search.tsx` | A nav/startup | 16 | 16 | ✅ |
| 6 | `app/(tabs)/void.tsx` | A nav/startup | 10 | 10 | ✅ |
| 7 | `app/_layout.tsx` | A nav/startup | 172 | 172 | ✅ |
| 8 | `app/auth-callback.tsx` | A nav/startup | 51 | 51 | ✅ |
| 9 | `app/blocked.tsx` | A nav/startup | 7 | 7 | ✅ |
| 10 | `app/composer.tsx` | A nav/startup | 8 | 8 | ✅ |
| 11 | `app/index.tsx` | A nav/startup | 8 | 8 | ✅ |
| 12 | `app/messages/[id].tsx` | A nav/startup | 8 | 8 | ✅ |
| 13 | `app/nation/[iso].tsx` | A nav/startup | 16 | 16 | ✅ |
| 14 | `app/onboarding.tsx` | A nav/startup | 1 | 1 | ✅ |
| 15 | `app/photo.tsx` | A nav/startup | 2 | 2 | ✅ |
| 16 | `app/reels.tsx` | A nav/startup | 12 | 12 | ✅ |
| 17 | `app/settings.tsx` | A nav/startup | 7 | 7 | ✅ |
| 18 | `app/sign-in.tsx` | A nav/startup | 1 | 1 | ✅ |
| 19 | `app/thread/[id].tsx` | A nav/startup | 1 | 1 | ✅ |
| 20 | `app/u/[handle].tsx` | A nav/startup | 8 | 8 | ✅ |
| 21 | `src/core/__tests__/fixtures/bsky-feed.json` | J tests | 602 | 602 | ✅ |
| 22 | `src/core/__tests__/fixtures/lemmy-posts.json` | J tests | 635 | 635 | ✅ |
| 23 | `src/core/__tests__/fixtures/mastodon-statuses.json` | J tests | 1098 | 1098 | ✅ |
| 24 | `src/core/__tests__/fixtures/post-texts.json` | J tests | 41 | 41 | ✅ |
| 25 | `src/core/__tests__/golden.test.ts` | J tests | 373 | 373 | ✅ |
| 26 | `src/core/__tests__/more.test.ts` | J tests | 147 | 147 | ✅ |
| 27 | `src/core/__tests__/tools/generate-data.ts` | J tests | 82 | 82 | ✅ |
| 28 | `src/core/__tests__/webHarness.ts` | J tests | 159 | 159 | ✅ |
| 29 | `src/core/api/auth.ts` | G network/nation | 219 | 219 | ✅ |
| 30 | `src/core/api/media.ts` | G network/nation | 145 | 145 | ✅ |
| 31 | `src/core/api/moderation.ts` | G network/nation | 206 | 206 | ✅ |
| 32 | `src/core/api/replies.ts` | G network/nation | 291 | 291 | ✅ |
| 33 | `src/core/api/voidApi.ts` | G network/nation | 148 | 148 | ✅ |
| 34 | `src/core/data/countries.generated.ts` | D streams/data | 204 | 204 | ✅ |
| 35 | `src/core/data/iptv.generated.ts` | D streams/data | 2501 | 2501 | ✅ |
| 36 | `src/core/data/life.generated.ts` | D streams/data | 658 | 658 | ✅ |
| 37 | `src/core/data/nationVocab.generated.ts` | D streams/data | 87 | 87 | ✅ |
| 38 | `src/core/data/regionAliases.generated.ts` | D streams/data | 173 | 173 | ✅ |
| 39 | `src/core/data/regions.ts` | D streams/data | 74 | 74 | ✅ |
| 40 | `src/core/data/sources.ts` | D streams/data | 60 | 60 | ✅ |
| 41 | `src/core/data/streams.generated.ts` | D streams/data | 448 | 448 | ✅ |
| 42 | `src/core/env.ts` | D streams/data | 102 | 102 | ✅ |
| 43 | `src/core/feed/bluesky.ts` | G network/nation | 134 | 134 | ✅ |
| 44 | `src/core/feed/fedi.ts` | G network/nation | 80 | 80 | ✅ |
| 45 | `src/core/feed/gdelt.ts` | G network/nation | 55 | 55 | ✅ |
| 46 | `src/core/feed/nation.ts` | G network/nation | 550 | 550 | ✅ |
| 47 | `src/core/feed/proxy.ts` | G network/nation | 51 | 51 | ✅ |
| 48 | `src/core/feed/reddit.ts` | G network/nation | 58 | 58 | ✅ |
| 49 | `src/core/feed/reels.ts` | E reels/search | 218 | 218 | ✅ |
| 50 | `src/core/feed/search.ts` | G network/nation | 174 | 174 | ✅ |
| 51 | `src/core/feed/store.ts` | G network/nation | 48 | 48 | ✅ |
| 52 | `src/core/feed/voidFeed.ts` | G network/nation | 175 | 175 | ✅ |
| 53 | `src/core/index.ts` | D streams/data | 47 | 47 | ✅ |
| 54 | `src/core/package.json` | D streams/data | 4 | 4 | ✅ |
| 55 | `src/core/rank/bio.ts` | I UI/anim/rank | 131 | 131 | ✅ |
| 56 | `src/core/rank/filters.ts` | I UI/anim/rank | 128 | 128 | ✅ |
| 57 | `src/core/rank/nation.ts` | I UI/anim/rank | 61 | 61 | ✅ |
| 58 | `src/core/rank/order.ts` | I UI/anim/rank | 162 | 162 | ✅ |
| 59 | `src/core/rank/seen.ts` | I UI/anim/rank | 90 | 90 | ✅ |
| 60 | `src/core/rank/story.ts` | I UI/anim/rank | 148 | 148 | ✅ |
| 61 | `src/core/rank/tags.ts` | I UI/anim/rank | 86 | 86 | ✅ |
| 62 | `src/core/slow.ts` | D streams/data | 69 | 69 | ✅ |
| 63 | `src/core/streams/frame.ts` | D streams/data | 67 | 67 | ✅ |
| 64 | `src/core/streams/keys.ts` | D streams/data | 107 | 107 | ✅ |
| 65 | `src/core/streams/nation.ts` | D streams/data | 173 | 173 | ✅ |
| 66 | `src/core/streams/probe.ts` | D streams/data | 63 | 63 | ✅ |
| 67 | `src/core/streams/wall.ts` | D streams/data | 143 | 143 | ✅ |
| 68 | `src/core/types.ts` | D streams/data | 169 | 169 | ✅ |
| 69 | `src/core/util.ts` | D streams/data | 84 | 84 | ✅ |
| 70 | `src/features/auth/README.md` | H stores/screens | 15 | 15 | ✅ |
| 71 | `src/features/auth/SignInScreen.tsx` | H stores/screens | 190 | 190 | ✅ |
| 72 | `src/features/auth/TermsSheet.tsx` | H stores/screens | 86 | 86 | ✅ |
| 73 | `src/features/auth/authActions.ts` | H stores/screens | 225 | 225 | ✅ |
| 74 | `src/features/auth/coreBridge.ts` | H stores/screens | 222 | 222 | ✅ |
| 75 | `src/features/auth/handles.ts` | H stores/screens | 37 | 37 | ✅ |
| 76 | `src/features/auth/index.ts` | H stores/screens | 5 | 5 | ✅ |
| 77 | `src/features/composer/ComposerSheet.tsx` | H stores/screens | 358 | 358 | ✅ |
| 78 | `src/features/composer/README.md` | H stores/screens | 23 | 23 | ✅ |
| 79 | `src/features/composer/drop.ts` | H stores/screens | 144 | 144 | ✅ |
| 80 | `src/features/composer/dropStore.ts` | H stores/screens | 81 | 81 | ✅ |
| 81 | `src/features/composer/index.ts` | H stores/screens | 4 | 4 | ✅ |
| 82 | `src/features/composer/media.ts` | H stores/screens | 101 | 101 | ✅ |
| 83 | `src/features/feed/ModerationSheet.tsx` | F feed/thread | 459 | 459 | ✅ |
| 84 | `src/features/feed/PostCard.tsx` | F feed/thread | 245 | 245 | ✅ |
| 85 | `src/features/feed/README.md` | F feed/thread | 132 | 132 | ✅ |
| 86 | `src/features/feed/VoidFeedScreen.tsx` | F feed/thread | 294 | 294 | ✅ |
| 87 | `src/features/feed/audioStore.ts` | F feed/thread | 156 | 156 | ✅ |
| 88 | `src/features/feed/format.ts` | F feed/thread | 70 | 70 | ✅ |
| 89 | `src/features/feed/index.ts` | F feed/thread | 7 | 7 | ✅ |
| 90 | `src/features/feed/media/AudioPill.tsx` | F feed/thread | 100 | 100 | ✅ |
| 91 | `src/features/feed/media/GraphicVeil.tsx` | F feed/thread | 41 | 41 | ✅ |
| 92 | `src/features/feed/media/PostCarousel.tsx` | F feed/thread | 106 | 106 | ✅ |
| 93 | `src/features/feed/media/PostMedia.tsx` | F feed/thread | 155 | 155 | ✅ |
| 94 | `src/features/feed/navigation.ts` | F feed/thread | 43 | 43 | ✅ |
| 95 | `src/features/feed/reactions.ts` | F feed/thread | 46 | 46 | ✅ |
| 96 | `src/features/feed/stores.ts` | F feed/thread | 115 | 115 | ✅ |
| 97 | `src/features/feed/translate.ts` | F feed/thread | 54 | 54 | ✅ |
| 98 | `src/features/feed/videoStore.ts` | F feed/thread | 108 | 108 | ✅ |
| 99 | `src/features/feed/viewability.ts` | F feed/thread | 73 | 73 | ✅ |
| 100 | `src/features/feed/vmodIcons.tsx` | F feed/thread | 28 | 28 | ✅ |
| 101 | `src/features/globe/GlobeCanvas.tsx` | B globe/GL | 276 | 276 | ✅ |
| 102 | `src/features/globe/GlobeModeToggle.tsx` | B globe/GL | 53 | 53 | ✅ |
| 103 | `src/features/globe/GlobeScreen.tsx` | B globe/GL | 217 | 217 | ✅ |
| 104 | `src/features/globe/GlobeSearch.tsx` | B globe/GL | 84 | 84 | ✅ |
| 105 | `src/features/globe/README.md` | B globe/GL | 124 | 124 | ✅ |
| 106 | `src/features/globe/ReelsView.tsx` | B globe/GL | 11 | 11 | ✅ |
| 107 | `src/features/globe/earthTexture.ts` (line 4 = one 765,609-char base64 literal; Read tool refused 748 KB, read with awk) | B globe/GL | 4 | 4 | ✅ |
| 108 | `src/features/globe/globeScene.ts` | B globe/GL | 396 | 396 | ✅ |
| 109 | `src/features/globe/index.ts` | B globe/GL | 5 | 5 | ✅ |
| 110 | `src/features/globe/persist.ts` | B globe/GL | 35 | 35 | ✅ |
| 111 | `src/features/globe/textures.ts` | B globe/GL | 394 | 394 | ✅ |
| 112 | `src/features/live/AudioOwner.tsx` | C live wall | 262 | 262 | ✅ |
| 113 | `src/features/live/LiveWall.tsx` | C live wall | 697 | 697 | ✅ |
| 114 | `src/features/live/README.md` | C live wall | 59 | 59 | ✅ |
| 115 | `src/features/live/StreamTile.tsx` | C live wall | 658 | 658 | ✅ |
| 116 | `src/features/live/TileChrome.tsx` | C live wall | 142 | 142 | ✅ |
| 117 | `src/features/live/__tests__/hlsVariant.test.ts` | C live wall | 51 | 51 | ✅ |
| 118 | `src/features/live/constants.ts` | C live wall | 177 | 177 | ✅ |
| 119 | `src/features/live/core.ts` | C live wall | 94 | 94 | ✅ |
| 120 | `src/features/live/frameSample.ts` | C live wall | 239 | 239 | ✅ |
| 121 | `src/features/live/hlsVariant.ts` | C live wall | 104 | 104 | ✅ |
| 122 | `src/features/live/index.ts` | C live wall | 9 | 9 | ✅ |
| 123 | `src/features/live/liveTheme.ts` | C live wall | 52 | 52 | ✅ |
| 124 | `src/features/live/pacedPlayer.ts` | C live wall | 145 | 145 | ✅ |
| 125 | `src/features/live/useStreamCascade.ts` | C live wall | 122 | 122 | ✅ |
| 126 | `src/features/live/ytHtml.ts` | C live wall | 112 | 112 | ✅ |
| 127 | `src/features/messages/ChatScreen.tsx` | H stores/screens | 238 | 238 | ✅ |
| 128 | `src/features/messages/ConvRow.tsx` | H stores/screens | 121 | 121 | ✅ |
| 129 | `src/features/messages/MessagesScreen.tsx` | H stores/screens | 144 | 144 | ✅ |
| 130 | `src/features/messages/README.md` | H stores/screens | 13 | 13 | ✅ |
| 131 | `src/features/messages/dmStore.ts` | H stores/screens | 267 | 267 | ✅ |
| 132 | `src/features/messages/index.ts` | H stores/screens | 4 | 4 | ✅ |
| 133 | `src/features/nation/NationCards.tsx` | G network/nation | 53 | 53 | ✅ |
| 134 | `src/features/nation/NationChrome.tsx` | G network/nation | 137 | 137 | ✅ |
| 135 | `src/features/nation/NationHero.tsx` | G network/nation | 84 | 84 | ✅ |
| 136 | `src/features/nation/NationScreen.tsx` | G network/nation | 144 | 144 | ✅ |
| 137 | `src/features/nation/README.md` | G network/nation | 89 | 89 | ✅ |
| 138 | `src/features/nation/index.ts` | G network/nation | 6 | 6 | ✅ |
| 139 | `src/features/nation/useNationFeed.ts` | G network/nation | 173 | 173 | ✅ |
| 140 | `src/features/nation/useNationHero.ts` | G network/nation | 221 | 221 | ✅ |
| 141 | `src/features/onboarding/CardGate.tsx` | B globe/GL | 545 | 545 | ✅ |
| 142 | `src/features/onboarding/GlobeIntro.tsx` | B globe/GL | 49 | 49 | ✅ |
| 143 | `src/features/onboarding/Ignite.tsx` | B globe/GL | 99 | 99 | ✅ |
| 144 | `src/features/onboarding/JumpIn.tsx` | B globe/GL | 126 | 126 | ✅ |
| 145 | `src/features/onboarding/OnboardGlobe.tsx` | B globe/GL | 123 | 123 | ✅ |
| 146 | `src/features/onboarding/OnboardingScreen.tsx` | B globe/GL | 145 | 145 | ✅ |
| 147 | `src/features/onboarding/copy.ts` | B globe/GL | 105 | 105 | ✅ |
| 148 | `src/features/onboarding/flag.ts` | B globe/GL | 30 | 30 | ✅ |
| 149 | `src/features/onboarding/globeBuild.ts` | B globe/GL | 184 | 184 | ✅ |
| 150 | `src/features/onboarding/landDots.ts` | B globe/GL | 41 | 41 | ✅ |
| 151 | `src/features/onboarding/onboardAuth.ts` | B globe/GL | 226 | 226 | ✅ |
| 152 | `src/features/onboarding/parts.tsx` | B globe/GL | 98 | 98 | ✅ |
| 153 | `src/features/onboarding/places.ts` | B globe/GL | 95 | 95 | ✅ |
| 154 | `src/features/onboarding/seed.ts` | B globe/GL | 53 | 53 | ✅ |
| 155 | `src/features/photo/PhotoViewer.tsx` | H stores/screens | 460 | 460 | ✅ |
| 156 | `src/features/photo/README.md` | H stores/screens | 35 | 35 | ✅ |
| 157 | `src/features/photo/index.ts` | H stores/screens | 15 | 15 | ✅ |
| 158 | `src/features/profile/AccountSheet.tsx` | H stores/screens | 111 | 111 | ✅ |
| 159 | `src/features/profile/EditProfileSheet.tsx` | H stores/screens | 113 | 113 | ✅ |
| 160 | `src/features/profile/ProfileAvatar.tsx` | H stores/screens | 36 | 36 | ✅ |
| 161 | `src/features/profile/ProfileScreen.tsx` | H stores/screens | 276 | 276 | ✅ |
| 162 | `src/features/profile/README.md` | H stores/screens | 12 | 12 | ✅ |
| 163 | `src/features/profile/index.ts` | H stores/screens | 4 | 4 | ✅ |
| 164 | `src/features/profile/profileApi.ts` | H stores/screens | 117 | 117 | ✅ |
| 165 | `src/features/reels/ModIcons.tsx` | E reels/search | 7 | 7 | ✅ |
| 166 | `src/features/reels/README.md` | E reels/search | 104 | 104 | ✅ |
| 167 | `src/features/reels/ReelAudioPill.tsx` | E reels/search | 136 | 136 | ✅ |
| 168 | `src/features/reels/ReelItem.tsx` | E reels/search | 342 | 342 | ✅ |
| 169 | `src/features/reels/ReelModSheet.tsx` | E reels/search | 312 | 312 | ✅ |
| 170 | `src/features/reels/ReelVideo.tsx` | E reels/search | 97 | 97 | ✅ |
| 171 | `src/features/reels/ReelsView.tsx` | E reels/search | 415 | 415 | ✅ |
| 172 | `src/features/reels/reelStore.ts` | E reels/search | 231 | 231 | ✅ |
| 173 | `src/features/reels/useSafeClaimAudio.ts` | E reels/search | 12 | 12 | ✅ |
| 174 | `src/features/search/README.md` | E reels/search | 86 | 86 | ✅ |
| 175 | `src/features/search/SearchLiveTile.tsx` | E reels/search | 276 | 276 | ✅ |
| 176 | `src/features/search/SearchPostCard.tsx` | E reels/search | 217 | 217 | ✅ |
| 177 | `src/features/search/SearchScreen.tsx` | E reels/search | 341 | 341 | ✅ |
| 178 | `src/features/search/format.ts` | E reels/search | 18 | 18 | ✅ |
| 179 | `src/features/search/searchModel.ts` | E reels/search | 199 | 199 | ✅ |
| 180 | `src/features/settings/BlockedAccountsScreen.tsx` | H stores/screens | 102 | 102 | ✅ |
| 181 | `src/features/settings/BodySignals.tsx` | H stores/screens | 175 | 175 | ✅ |
| 182 | `src/features/settings/DeleteAccountSheet.tsx` | H stores/screens | 173 | 173 | ✅ |
| 183 | `src/features/settings/README.md` | H stores/screens | 24 | 24 | ✅ |
| 184 | `src/features/settings/SettingsScreen.tsx` | H stores/screens | 373 | 373 | ✅ |
| 185 | `src/features/settings/index.ts` | H stores/screens | 4 | 4 | ✅ |
| 186 | `src/features/settings/prefs.ts` | H stores/screens | 50 | 50 | ✅ |
| 187 | `src/features/settings/vmod.tsx` | H stores/screens | 203 | 203 | ✅ |
| 188 | `src/features/thread/CommentCard.tsx` | F feed/thread | 162 | 162 | ✅ |
| 189 | `src/features/thread/ComposePill.tsx` | F feed/thread | 66 | 66 | ✅ |
| 190 | `src/features/thread/ReplyOverlay.tsx` | F feed/thread | 214 | 214 | ✅ |
| 191 | `src/features/thread/ThreadScreen.tsx` | F feed/thread | 548 | 548 | ✅ |
| 192 | `src/features/thread/index.ts` | F feed/thread | 4 | 4 | ✅ |
| 193 | `src/features/thread/threadModel.ts` | F feed/thread | 121 | 121 | ✅ |
| 194 | `src/features/thread/threadTheme.ts` | F feed/thread | 49 | 49 | ✅ |
| 195 | `src/lib/auth.tsx` | A nav/startup | 92 | 92 | ✅ |
| 196 | `src/lib/config.ts` | A nav/startup | 17 | 17 | ✅ |
| 197 | `src/lib/core.ts` | A nav/startup | 152 | 152 | ✅ |
| 198 | `src/lib/net.ts` | A nav/startup | 43 | 43 | ✅ |
| 199 | `src/lib/polyfills.ts` | A nav/startup | 20 | 20 | ✅ |
| 200 | `src/lib/sensing.tsx` | A nav/startup | 119 | 119 | ✅ |
| 201 | `src/lib/storage.ts` | A nav/startup | 61 | 61 | ✅ |
| 202 | `src/lib/supabase.ts` | A nav/startup | 48 | 48 | ✅ |
| 203 | `src/nav/BottomNav.tsx` | A nav/startup | 120 | 120 | ✅ |
| 204 | `src/nav/badges.ts` | A nav/startup | 28 | 28 | ✅ |
| 205 | `src/nav/index.ts` | A nav/startup | 4 | 4 | ✅ |
| 206 | `src/nav/layout.ts` | A nav/startup | 19 | 19 | ✅ |
| 207 | `src/nav/routes.ts` | A nav/startup | 39 | 39 | ✅ |
| 208 | `src/nav/switchTiming.ts` | A nav/startup | 33 | 33 | ✅ |
| 209 | `src/theme/ThemeProvider.tsx` | A nav/startup | 111 | 111 | ✅ |
| 210 | `src/theme/index.ts` | A nav/startup | 1 | 1 | ✅ |
| 211 | `src/theme/palettes.ts` | A nav/startup | 194 | 194 | ✅ |
| 212 | `src/theme/tokens.ts` | A nav/startup | 8 | 8 | ✅ |
| 213 | `src/ui/ImageOrbitLoader.tsx` | I UI/anim/rank | 79 | 79 | ✅ |
| 214 | `src/ui/Pill.tsx` | I UI/anim/rank | 88 | 88 | ✅ |
| 215 | `src/ui/ScreenPlaceholder.tsx` | I UI/anim/rank | 44 | 44 | ✅ |
| 216 | `src/ui/Sheet.tsx` | I UI/anim/rank | 147 | 147 | ✅ |
| 217 | `src/ui/SparkleLoader.tsx` | I UI/anim/rank | 152 | 152 | ✅ |
| 218 | `src/ui/Surface.tsx` | I UI/anim/rank | 111 | 111 | ✅ |
| 219 | `src/ui/Text.tsx` | I UI/anim/rank | 84 | 84 | ✅ |
| 220 | `src/ui/Toast.tsx` | I UI/anim/rank | 83 | 83 | ✅ |
| 221 | `src/ui/VoidImage.tsx` | I UI/anim/rank | 76 | 76 | ✅ |
| 222 | `src/ui/icons/Glyph.tsx` | I UI/anim/rank | 111 | 111 | ✅ |
| 223 | `src/ui/icons/Icon.tsx` | I UI/anim/rank | 27 | 27 | ✅ |
| 224 | `src/ui/icons/index.ts` | I UI/anim/rank | 2 | 2 | ✅ |
| 225 | `src/ui/icons/paths.ts` | I UI/anim/rank | 56 | 56 | ✅ |
| 226 | `src/ui/index.ts` | I UI/anim/rank | 12 | 12 | ✅ |
| 227 | `src/ui/loaders/useLoaderClock.ts` | I UI/anim/rank | 116 | 116 | ✅ |
| 228 | `app.json` | A build config | 174 | 174 | ✅ |
| 229 | `app.config.js` | A build config | 56 | 56 | ✅ |
| 230 | `babel.config.js` | A build config | 8 | 8 | ✅ |
| 231 | `metro.config.js` | A build config | 11 | 11 | ✅ |
| 232 | `package.json` | A build config | 67 | 67 | ✅ |
| 233 | `eas.json` | A build config | 54 | 54 | ✅ |
| 234 | `tsconfig.json` | A build config | 29 | 29 | ✅ |
| 235 | `modules/expo-void-sensing/index.ts` | J native module | 378 | 378 | ✅ |
| 236 | `modules/expo-void-sensing/app.plugin.js` | J native module | 72 | 72 | ✅ |
| 237 | `modules/expo-void-sensing/expo-module.config.json` | J native module | 9 | 9 | ✅ |
| 238 | `modules/expo-void-sensing/package.json` | J native module | 14 | 14 | ✅ |
| 239 | `modules/expo-void-sensing/android/build.gradle` | J native module | 56 | 56 | ✅ |
| 240 | `modules/expo-void-sensing/android/src/main/AndroidManifest.xml` | J native module | 24 | 24 | ✅ |
| 241 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/ExpoVoidSensingModule.kt` | J native module | 705 | 705 | ✅ |
| 242 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/Geometry.kt` | J native module | 37 | 37 | ✅ |
| 243 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/affect/AffectModel.kt` | J native module | 31 | 31 | ✅ |
| 244 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/affect/AffectState.kt` | J native module | 233 | 233 | ✅ |
| 245 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/capture/BleHeartRate.kt` | J native module | 358 | 358 | ✅ |
| 246 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/capture/CalmReading.kt` | J native module | 141 | 141 | ✅ |
| 247 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/capture/ContextCapture.kt` | J native module | 140 | 140 | ✅ |
| 248 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/capture/FaceCapture.kt` | J native module | 397 | 397 | ✅ |
| 249 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/capture/MotionCapture.kt` | J native module | 161 | 161 | ✅ |
| 250 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/capture/PPGCameraSource.kt` | J native module | 150 | 150 | ✅ |
| 251 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/capture/PPGCapture.kt` | J native module | 309 | 309 | ✅ |
| 252 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/capture/RPPGCapture.kt` | J native module | 112 | 112 | ✅ |
| 253 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/capture/TouchCapture.kt` | J native module | 135 | 135 | ✅ |
| 254 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/pipeline/Attribution.kt` | J native module | 145 | 145 | ✅ |
| 255 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/pipeline/BaselineStore.kt` | J native module | 325 | 325 | ✅ |
| 256 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/pipeline/MotionGate.kt` | J native module | 68 | 68 | ✅ |
| 257 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/privacy/ConsentManager.kt` | J native module | 163 | 163 | ✅ |
| 258 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/privacy/KillSwitch.kt` | J native module | 67 | 67 | ✅ |
| 259 | `modules/expo-void-sensing/android/src/main/java/com/thevoid/sensing/privacy/PrivacyGate.kt` | J native module | 212 | 212 | ✅ |

**Total: 259 files. Mismatches: 0.**
