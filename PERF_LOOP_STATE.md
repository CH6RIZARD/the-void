# NATIVE PERF LOOP — state

## ORDERED BY USER (2026-10-04, reversing the wontfix below): settle-gated packing
- Implement: every batch gets a connection rank (w.wallConn++) in
  onFirstSettled; commit immediately when batch===1 OR wall at rest
  (!fingerDown && !momentum); otherwise queue in w.pendingOrder and flush in
  ONE setOrder commit at the settle points 7k added (momentum-end /
  end-drag-no-momentum, beside the deferred placement pass). Reset clears the
  queue with wallConn. Sort at LiveWall.tsx:214 is global + ranks stable, so
  no mid-gesture movement ever (the regression guard), fast connectors rise
  at settle/idle.
- APPLY AFTER workflow wc2beswd0 completes (it edits LiveWall.tsx too);
  ship with its fixes as 7l; film the settle reorder on the lab phone.

## superseded wontfix record (kept for the mechanism + history)
- Edge case: slightly scrolled, a fast-connecting stream lights up in the
  lower section while slower tiles above still show loaders. MECHANISM
  (located, LiveWall.tsx onFirstSettled): only batch 1 packs by connection
  order; later batches keep spawn slots DELIBERATELY - packing every batch
  was tried before and caused the recorded complaint "content sat randomly /
  jumped around under an active scroll". User accepts the trade; grid
  mechanics otherwise called "almost perfect".
- Safe future variant if ever revisited: pack batch-N by connect order only
  on scroll-SETTLE (never mid-gesture), gated after 7k/7l placement work
  stabilizes. Do not re-investigate from scratch.

## 7j GATE BLOCKED -> A/B EXONERATED IT -> the budget doesn't hold in CHURN HOURS
- 7j gate: 20 players / 16 hw / 4 sw -> blocked (correctly). Same-hour A/B:
  7i reinstalled = 19->18 players, 16->11 hw. NOT a 7j regression - the 9/9/0
  at 7i's original gate was a calm-hour anomaly. ~20 is suspiciously stable
  across builds/hours (equilibrium or ceiling). 19 DISTINCT SurfaceViews vs
  cap 8 -> still-frame VideoViews / park-keeps-surface / release-drain vs
  heal-cascade inflow are the suspects; C1's cheap-before-health sort may
  feed churn with flaky-but-cheap leads.
- 7k (scroll fixes, c6f79fb) dispatched: run 37187104713, gate watcher task
  b1fip6zwa (gate includes stage-of wall scroll measurement; promotion will
  likely be blocked by the budget check in churn hours - that is fine, the
  scroll numbers still land).
- Workflow wf_0417bc43-10d (task wc2beswd0) running: mount accounting (code)
  + live attribution (device, passive-only) -> design budget-holds fixes ->
  implement safe subset = 7l. Candidate levers: eviction unmounts the
  VideoView; heal/cascade backpressure gate; release drain 350->150 (B1 soak
  now justified?); health-before-cost sort repair; hard create backpressure
  at players>=N.
- User phone: ON 7I (promoted in the calm hour). Its churn-hour behavior is
  what the user feels - the budget fix is what finally pins it.

## WALL SCROLL (user 2026-10-04: "2/10 on scrolls") — MEASURED, workflow running
- stage-of.mjs wall on 7i, lab, scripted scroll: total p50 204.6ms (~5fps UI)
  p90 414.9 worst 968; animation p50 58.3 p90 117.6 DOMINANT, gpu 25.5/41.3.
  Per-stream decode unaffected (30.2fps) - this is mount/marshal churn on the
  main thread during scroll: globe loop GL marshal (7j halves it), Fabric tile
  mounts + SurfaceView create/destroy on reveal, sparkle clocks, re-renders.
- WORKFLOW DONE, 5 safe fixes APPLIED (uncommitted until 7j's chain ends;
  chain /e/tmp/chain7k.sh ready): F1 fling holiday (placement passes defer to
  momentum-end; paced creates take a self-expiring deadline hold - the 968ms
  worst frame was a synchronous ExoPlayer build mid-gesture); F2 pullArmed
  deleted (write-only state re-rendering the whole wall at every gesture
  start); F3 globe holds frames during wall scroll via wallScrollSignal.ts
  shared-value timestamp read in the render worklet (450ms self-expiry;
  watchdog taught held!=dead; WATCHED TRADE: static header during fling -
  fallback is a 10fps tick if it reads dead on film); F4 LiveWall+GlobeCanvas
  memoized; F5 one shared sparkle clock for all loaders (bit-identical math,
  sleeps when all paused). Transform-proofed both worklet files (2 + 5
  factories, no self-capture), tsc clean.
- Ledger highlights for later: watchdog nudge storms are NOT scroll-gated
  (quiet=globeTouching only); 15-25 loaders animate mid-fling because fresh
  batch tiles have no placement entry; gated F6 (reanimated sync-props flag),
  F7 (TextureView A/B for the gpu 25ms term), F8 (player pool) remain.
- Workflow wf_8de78f1e-575 (task wjkp3x6zq): scroll-path census + list infra
  -> design (defer mounts to settle / cell-boundary re-renders / mount batching
  / globe-throttle-during-scroll with look-risk flagged / report items) ->
  implement safe subset. 7j (globe governor) in CI meanwhile (task bip5yu9k4);
  its commit 30e8701 is pushed. NEXT: when both land, commit scroll fixes as
  7k, gate, re-run stage-of wall (honest bar: p50 <=66ms this round, target
  <=33) + guards (per-layer 30fps intact, players<=11, sw=0).

## Build 7i MEASURED: WALL TARGET MET · 7j in flight (globe governor, task bip5yu9k4)
- 7i gate PASSED and PROMOTED TO THE USER PHONE (02:55): players 9, hw
  sessions 9, sw 0, aac 0 after settle. Per-layer fps on the settled wall:
  7/7 live layers at 30.2fps median (33.1ms cadence = full source rate);
  baseline was 3.2-7.6. Two layers frame-less (mid-connect/queue corpses).
  Width histogram now shows 426x36 + 416x6 sessions (was zero <=480).
- Globe drag on 7i: total p50 118ms still, but the bottleneck FLIPPED:
  gpu p50 35->26ms, 'animation' (the worklet loop's UI-thread window) now
  dominant at p50 37ms = 60Hz GL marshaling for ~8 presented fps. 7j makes
  the ~30fps governor apply during drag too (one line; busy flag removed;
  transform + tsc verified). Expect animation p50 to roughly halve and
  pacing to steady out; re-run stage-of.mjs globe after 7j installs.
- Remaining benched levers if needed: B1 release-gap 150ms (soak-gated),
  F4 expo-video decoder-fallback patch (sessions<=10 + sw=0 now proven on
  7i - eligible), GLView buffer-scale (pixel-compare gated).
- User phone: ON 7I. The user's next look at the wall is the real verdict.

## Build 7i in flight (chain /e/tmp/chain7i.sh, task bnfod6tl0) — THE GLOBAL BUDGET
- Carries (one commit): feed/profile release players on tab blur (surface-focus
  flag -> videoStore releasePaced, Search's path); PostMedia unconditional
  pause (buffering-at-blur active-decode bypass closed); reels hidden side
  holds zero players; sentinel `w` annotation (1766/2645, 374 cheap) + wallSlots
  sorts [cheap, unknown, expensive] on BOTH native and web + capExpensive (max 2
  concurrent >480-wide wall streams, reorder never filter); golden suite
  resurrected (slow.ts lazy AppState, health.ts lazy config, harness learned
  provenDead/health, cascade test encodes the native YT ban) - 24/24 + tsc.
- Gate now REQUIRES: texture breadcrumb + players <=11 + sw sessions 0 after a
  60s settle, else user stays on b6.
- NEXT TICK on gate pass: full measure - per-layer fps (PASS >=12 all visible,
  TARGET >=15, baseline 3.2-7.6), media.metrics width histogram (expect
  majority <=480 on new wall sessions), feed-restore bar (poster frame 1,
  first video frame <700ms on tab return), scroll-transient player count.
- GATED next if fps still short: B1 release-gap 150ms (needs soak-wall),
  F4 expo-video patch (needs sessions <=10 + sw 0 proven first).
- Web side rides the same push (Cloudflare Pages deploys void-proxy/public).

## GLOBE FLUIDITY (user 2026-10-04: "could be a little more fluid") — MEASURED
- stage-of.mjs globe on 7h, lab, mid-drag: total p50 127ms (~8fps) p90 162,
  100% janky; gpu p50 35.3 p90 70.0 DOMINANT; animation (worklet loop) p50
  10.7; input/draw/traversal ~0. The worklet+gesture path is healthy - the
  GPU is starved by compositing ~20 video surfaces alongside the globe.
- PLAN: (1) re-run the same command after 7i installs (7i halves the layer
  count) - directly comparable. (2) If gpu still >16ms p50: pace the worklet
  loop to a steady ~30fps DURING drag too (currently only idle-governed) so
  endFrameEXP stops outrunning vsync - the 247ms worst is pipeline backlog,
  not slow math; steady 30 reads fluid, oscillating 8-15 reads jank. No look
  change. (3) Bench: GLView at 1/1.4 layout size + transform scale (smaller
  buffer, HWUI upscales) - ONLY behind a screenshot pixel-compare, look is
  locked.

## WALL FRAMERATE — root-caused by workflow wf_fd7068c2-0ae (2026-10-04)
User: "frame rate is still catastrophic, stop motion." Measured truth (lab, 7f):
19/20 video layers at 5.0-6.7fps median (SurfaceFlinger --latency); 14
concurrent MTK hw AVC sessions, 20 live players vs 8 visible tiles; decode IS
hardware - the VPU is time-sliced to death at 3-4x the intended pixels
(MIN_WIDTH=480 made the 1.6x cap dead code; media.metrics showed 640-1280
wide); 12 sw AAC decoder threads for muted tiles; ~200 decoder flushes/30s
(live-edge resync storm). Full causes/fixes/measure plan: task output
E:/tmp/claude/.../tasks/wndvp7rev.output.
COMMITTED on web/parity (0661c2d, NOT yet dispatched - 7g still in CI):
F1 detachAudio at setup, F2 MIN_WIDTH 480->320, F3 MAX_MOUNTED_PLAYERS 10->8.
GATED (apply only per measure plan): F4 expo-video patch removing
setEnableDecoderFallback (surfaces hw exhaustion to the budget); F5
replace(null) on park (SIGSEGV class - soak first); F6 TextureView A/B
(memory trade). MEASURE PLAN (run after 7h installs): per-layer fps PASS
>=12 all visible layers; decoder sessions <=9; C2SoftAvcDec count 0;
aac.decoder threads <=1; flushes <40/30s; media.metrics widths <=480 on
ladder streams. Lab phone bloatware com.abfota.systemUpdate (60% CPU) may be
disabled for clean runs (pm disable-user, lab only).

Updated: 2026-10-04 ~03:45 (build 7f dispatched - the worklet-globe crash is ROOT-CAUSED)

## Build 7h MEASURED (2026-10-04 01:40-01:55) — gate passed, target NOT met
- Gate (fresh launch): crash-free, globe textured+alive, 8 hw sessions, 0 sw,
  0 aac threads. 25 min later (steady state, globe tab foreground): 20 live
  ExoPlayer threads, 16 hw + 3 SOFTWARE AVC sessions, ALL in the live app pid
  (old pid dead, holds none). Wall budget is 8 -> ~12 players are non-wall
  (hidden feed/reels/nation?) or leaked wall releases. The 3 sw sessions = the
  silent setEnableDecoderFallback path ACTIVE (F4's scenario, live).
- Per-layer fps: live tiles 3.2-7.6 (baseline 5.0-6.7) - STILL STOP MOTION.
- WHY the shipped fixes didn't move fps: media.metrics shows sessions at
  1280x10 / 1920x6 / 720x4, ZERO <=480 - single-rendition streams (~72% of
  pool) can't be floored down; and the global player count never fell.
- WINS confirmed: flush storm 198 -> 5 per 30s; aac decoders 12 -> 0;
  gate-time sessions 14 -> 8.
- NEXT: workflow wf_a9729d58-d50 (task wxyhnkm8h) running: player census
  (who owns the ~12 non-wall players; c1c3a9b hidden-release regression),
  global decode budget (non-wall players must replace(null) when wall
  focused - NOT pause; SIGSEGV sequencing), cheap-streams-first wall feed
  (ladder streams preferred, 720p+-only capped at K~2 concurrent, grid
  fullness still wins), F4 promotion verdict.
- User phone: still b6, off cable. Do NOT promote 7h (fps target unmet);
  next promotable build is the global-budget one after lab measure passes.

## Build 7h chain record (task bprkj83w7)
- Carries: 7g's globe (worklet + night map) + wall framerate commit 0661c2d
  (MIN_WIDTH 320, MAX_MOUNTED_PLAYERS 8, detachAudio at setup).
- Gate: crash check + '[globe] worklet map' breadcrumb + instant wall truth
  (decoder sessions <=9, sw-codec lines 0, aac threads <=1) + screenshots.
- NEXT TICK after install: FULL measure plan from the workflow (per-layer
  SurfaceFlinger --latency fps on every visible layer, PASS >=12 TARGET >=15
  vs 5.0-6.7 baseline; flush count <40/30s; media.metrics widths <=480 on
  ladder streams; scroll transient codec count). User phone still on b6 and
  OFF CABLE - promote 7h on next connect if gate passed.

## Build 7g gate: PASSED IN FULL (2026-10-04 01:06)
- Survives globe tab, '[globe] worklet map: 2048x1024 uploaded' breadcrumb
  fired, screenshot = THE WEB LOOK: night-lights earth, north-up (North
  America upper-right with city glow), centered, markers + atmosphere + rim
  light correct, animating between 1s shots. The globe rebuild is DONE
  visually; remaining globe work is only measurement (drag fps under wall
  load) and the pickCountry/hover parity check.
- User phone off cable at gate time -> 7g never promoted (7h supersedes).

## Build 7g chain record (task bldkmf2tn)
- 7f GATE RESULT: SURVIVES. No crash, globe animating (markers drifting between
  the 1s-apart shots), wall 8/8 tiles showing live pictures. ONE defect: the
  planet face sampled pure (0,0,0) - pixel-verified in 7f-globe-a.png.
- Root cause (code-read, two layers): EXGL's 6-arg texImage2D({localUri}) sets
  width/height 0 on decode failure and STILL redefines level 0 -> 0x0 upload ->
  incomplete texture -> black; batched ops never throw into JS. And the decode
  was guaranteed to fail: textures.ts recorded this device family refusing the
  localUri path (GL 1282) long ago, plus resolveEarthUri passed 'a.localUri ||
  a.uri' (a bare resource name in release builds).
- 7g fix: render worklet publishes its texture's EXGL id (texIdSV);
  deliverEarthPixels pipes the boot-warmed bundled pixels (2048x1024, row 0 =
  north; measured EARTH_Z = authored south-first, flipRows makes row 0 north;
  worklet samples v directly) through a second runOnUI dispatch, 9-arg raw
  upload (the proven path - the marker sprites use it). localUri is banned.
  Breadcrumb '[globe] worklet map: 2048x1024 uploaded' on success; gate now
  requires it before promoting to the user phone.
- Babel transform pre-verified (scratchpad/babeltest): two factories, closures
  {sv} only, tryUpload/loop plain closures.

## Build 7f gate record (task bcl9veb0v)
- 7b/7c/7d/7e all fataled on globe-tab open: "undefined is not a function",
  stack = worklets AnimationFrameQueue -> executeQueue. Root cause FOUND AND
  VERIFIED locally (ran the real react-native-worklets@0.10.1 babel plugin over
  globeWorklet.ts in scratchpad/babeltest): the nested 'worklet' directive on
  `loop` made the plugin factory-ize it separately, and the factory destructures
  `loop` ITSELF from its closure - captured undefined mid-initializer - so the
  recursive requestAnimationFrame(loop) queued undefined; the next frame flush
  threw at executeQueue (it calls callback(ts) unvalidated) -> FATAL on main.
- Fix: directive removed; re-ran the transform: single outer factory, closure
  {sv} only, loop a plain lexical closure. The GL-context lookups (7c/7d
  theories) were never the problem: expo-gl's native installer puts the full
  WebGL method set (incl. endFrameEXP/getExtension) on the worklet runtime, and
  reanimated 4.5.1 still publishes _WORKLET_RUNTIME in the exact format expo-gl
  reads.
- Gate unchanged: lab phone must open the globe tab and survive + screenshots
  1s apart; only then passive-install to the user phone (currently on b6).
- NEXT TICK: read /e/tmp/claude/.../tasks/bcl9veb0v.output. If SURVIVES ->
  MEASURE on lab per protocol (scrcpy film, globe drag during wall load,
  textured-on-entry check, sparkle pair). If crash -> pull full stack again;
  do NOT guess (the transform harness in scratchpad/babeltest reproduces the
  emitted worklet code in seconds - use it first).

## Target (the user's bar, non-negotiable)
- Every tile IN VIEW plays — 8 visible = 8 playing, always; grid full at the end of every scroll; new streams arrive already-playing.
- Globe textured on entry; tracks the finger with no lag.
- Sparkles: moving from the first frame, logically unfreezable (see memory: sparkle-loader-look-is-locked).
- Reels swap fluid. All interactions ≤16ms perceived.

## In flight
- BUILD #4 (37152937068) finishing in CI: cascade youtube/health guard + mountDots.
- BUILD #5 committed (chained dispatch fires when #4 ends; watcher bbz76pakt):
  (a) SPARKLES ENGINE 3: Skia Atlas - one GPU draw per loader, one worklet clock,
  accumulated time so pause holds phase; new dep @shopify/react-native-skia@^2.6.2
  (Expo SDK 57's pin; CI uses yarn from package.json so no lockfile concern);
  (b) GLOBE gesture on the UI thread (worklets + shared-value deltas, JS loop
  consumes; tap via one runOnJS); (c) wall renditions capped ~240p (VPU budget -
  streams crawled at 5-8fps sharing one decoder engine); (d) '[audio] cut' breadcrumbs
  to convict the audio-on-scroll cut (code reading says the exemption is intact).
  Engine history: void-app/docs/sparkle-loader-engines.md (user asked to keep it).
  - INCIDENT: build #4 crashed app-wide on the user's phone (useRef unimported in
  SparkleLoader). Rolled back to #3 (/e/tmp/void-apk5). CI now gates on tsc (commit b9c68ad).
  NEW RULE: never install a new build on the USER'S phone until it passed a crash check -
  on the lab phone when present, else install + passive logcat FATAL/error-boundary scan
  within the same tick, with instant rollback to the last good APK on any crash.
  → NEXT TICK: when #5's run finishes, crash-check then install, MEASURE on the lab
  phone (sparkle smoothness ON FILM is the headline check, then per-stream fps, globe
  drag-during-stall, '[audio] cut' lines).
- User phone passive; lab phone R5CY249SW4K still absent - filmed protocol waits for it.

## PHONE RULES (v2 — after scripted taps disturbed the user mid-use)
- R5CYA0GF6FP (user's phone): PASSIVE ONLY. No input injection ever. Installs OK. Screenshots only if The Void is resumed.
- R5CY249SW4K (lab phone): all driving + scrcpy recording to E:/measure/run-<tick>.mp4.
- Research list to apply: C:/the void/void-main/reports/RN video wall jank fixes.md (1-10 safe batch first; 11-17 one at a time behind their measurement gates).

## Measurement protocol reminders
- Phone must be foreground-checked before ANY tap/swipe/screenshot (dumpsys mResumedActivity).
- Sparkle check = two screenshots ~1s apart; identical dot positions = frozen = defect.
- Fill check = count tiles with real picture vs tiles in view; logcat `[fill]` lines + `js thread stalled`.
- Local builds impossible (C: ~700MB free, D: read-only). CI only: `gh workflow run android-aab.yml --ref main -f profile=preview`.

## Measured history
- 2026-10-02 21:05 (build before sparkle fix): JS stalls 1.3–1.9s on loader:render; player:create 0.3–1.7s; [fill] 0/2 gave up; user saw 3/8 tiles after 2 min, frozen sparkles, 10s-late loader, 10s-late globe touch.
