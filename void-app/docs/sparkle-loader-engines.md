# Sparkle loader — engine history (reference)

The LOOK never changes (memory: `sparkle-loader-look-is-locked`): 14 gold 2×2
dots, random left 0–100% / bottom 0–40px, the web's `pfloat` float-and-fade,
per-dot 2.5–6.5s durations with 0–6s negative delays (all mid-flight from the
first frame, simultaneous start, distinct phases), pause holds in place. The
engines below are three ways of driving those same pixels.

| Engine | Mechanism | Why it was replaced |
|---|---|---|
| 1. RN Animated (original port) | One Animated.Value + 3 interpolations + native-driver loop **per dot**, built in render | ~24s of blocked JS in 75s after globe-tab open, stalls to 2.6s (`loader:*` breadcrumbs) — commit cost of ~90 graphs per wall batch |
| 2. Reanimated 4 CSS animations | One CSS-animation style **per dot view**, stepped by the UI thread | Dots animated but stepped ~200 views/frame on a loaded UI thread → visibly jerky ("sparkles stick still more than they animate"); batch-mount still stalled JS 1.1–1.4s |
| 3. Skia Atlas (current) | **One GPU draw per loader**: a worklet reads one accumulated clock and writes all 14 transforms + alphas into `useRSXformBuffer`/`useColorBuffer` | — |

Verbatim sources, extracted from git (do not retype; extract again with
`git show <commit>:void-app/src/ui/SparkleLoader.tsx`):

- **Engine 2 full file:** [`sparkle-loader-engine2-css.tsx.txt`](./sparkle-loader-engine2-css.tsx.txt)
  (= `git show 37a341b:void-app/src/ui/SparkleLoader.tsx`)
- Engine 2 introduced: commit `0db07d1`; born-running fix: `1fe3442`;
  mountDots viewport gating: `37a341b`.
- Engine 1 last version: `git show 13d6ee2:void-app/src/ui/SparkleLoader.tsx`.

Engine-3 invariants carried over: born running (particles from first mounted
frame, no JS-clock gating), `animate=false` = terminal NO SIGNAL hold,
`mountDots` geometry gating for off-viewport wall tiles, accumulated clock so
pause/resume keeps phase (CSS `animation-play-state` semantics).
