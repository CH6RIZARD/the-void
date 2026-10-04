# NATIVE PERF LOOP — state

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
