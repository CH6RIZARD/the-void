# NATIVE PERF LOOP — state

Updated: 2026-10-03 ~02:00 (by the main session, kicking off the loop)

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
