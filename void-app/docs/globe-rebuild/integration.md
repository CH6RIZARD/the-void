# Globe renderer integration surface

All paths under `C:/the void/void-main/void-app/src/features/globe/` unless noted.

## 1. The scene contract (`globeScene.ts` → consumed by `GlobeCanvas.tsx`)

`createGlobeScene(gl: any /* ExpoWebGLRenderingContext */, countries: Country[], viewW: number, viewH: number): GlobeScene` — called synchronously inside `onContextCreate` (GlobeCanvas.tsx:115) with `countries()` from `../live/core` and the current layout size in **view (dp) pixels**. May throw; a throw triggers `retryGl()`.

```ts
interface GlobeInput {
  drag: boolean;   // true while a finger is down; set by the JS loop from dragSV
  tRotX: number;   // target rotation X (radians), clamped to [-1.3, 1.3] by the CALLER
  tRotY: number;   // target rotation Y (radians), unbounded; scene adds idle drift
  rVelX: number;   // last per-event velocity, written each frame WHILE dragging
  rVelY: number;
  tZoom: number;   // target camera z, clamped to [1.5, 4] by the CALLER; starts 2.9
}

interface GlobeScene {
  input: GlobeInput;                 // a MUTABLE object the JS loop writes into every frame
  frame(ts: number): boolean;        // advance one frame; false = idle governor skipped (no draw)
  hit(x: number, y: number): Country | null;    // pick only, no highlight — EXPORTED BUT UNUSED by GlobeCanvas
  hover(x: number, y: number): Country | null;  // pick + set aHot highlight; null clears nothing (keeps -1 only via clearHover)
  clearHover(): void;                // clears the highlighted marker
  resize(bufferW, bufferH, viewW, viewH): void; // UNUSED by GlobeCanvas today (remounts on size change via key? — no: size changes are not handled; only rotation would need it). Must still exist to satisfy the type.
  dispose(): void;                   // idempotent teardown; sets disposed so a late texture resolve is dropped
}
```

Semantics as actually used by GlobeCanvas:

- **`input` is the only steering channel.** The JS raf loop reads-and-zeroes the reanimated shared values each frame and folds them into `input`: `tRotY += accY`, `tRotX = clamp(tRotX + accX, -1.3, 1.3)`, `tZoom = clamp(tZoom + accZoom, 1.5, 4)`, `drag = dragSV===1`, and while dragging `rVelX/rVelY = velX/velY` (for release inertia). **Clamping lives in the caller, easing/inertia/idle-drift live in the scene** (`frame`: idle auto-rotate `tRotY += 0.0015*dt`, velocity decay `0.92^dt`, ease `1-(1-k)^dt` with k=0.18 rot / 0.15 zoom, marker pulse `pt += 0.034*dt`, dt normalised to 60fps and clamped [0.2, 3]).
- **`frame(ts)`** gets `requestAnimationFrame`'s timestamp (`ts || Date.now()`). Returns `true` only when it actually rendered (`renderer.render` + `gl.endFrameEXP()`); returns `false` when the ~30fps idle governor skipped (not busy && <28ms since last draw). "Busy" = dragging, |rVel|>1e-4, or |tZoom−zoom|>1e-3. A `true` return drives `noteGlHealthy()` (resets the retry budget) and the one-time `markInteractive({surface:'globe'})` TTI mark. A **throw** from `frame` kills the loop and calls `retryGl()`.
- **`hover(x, y)`** — tap-to-open path. Coordinates are **view-space dp** from the gesture (`pt.x/pt.y`). Picking is NOT a raycast: screen-space nearest front-facing marker within 16pt. For each of the ~199 marker positions (lat/lon → unit-sphere ×1.02): apply `globe.matrixWorld`, reject far side (`normal · toCamera < 0.05`), project through the camera, map NDC→view px with the stored `vw/vh`, keep the closest within `16²` px². `hover` additionally writes the `aHot` attribute (hovered marker renders bigger/brighter). GlobeCanvas uses the return value to show the `#gtip` label at `(x+14, y+10)` and call `onOpenCountry(c)` — `c.n` is the display name, `c.iso` routes to `/nation/${iso}`.
- **`clearHover()`** — called on every `onTouchesDown` (JS side), together with `setTip(null)`.
- **`hit(x,y)`** exists in the interface but GlobeCanvas never calls it (no mouse hover on native). The rebuilt renderer can drop it or keep it one-line.
- **`resize`** is never called by GlobeCanvas (sizes are captured in `size.current` at context-create; a width/height change does not currently resize the scene). Keep the method for type parity, but it is dead in practice.
- **`dispose()`** — called from the unmount cleanup (`scene.current?.dispose()`). Must be safe after a failed/partial build and must gate late async texture arrival.

Scene-internal facts a rebuild must reproduce for look parity (the user's hard requirement): clear color `0x04020c` alpha 1 (the GLView is `opaque` — see below); camera fov 46, z start 2.9; two star Points fields (3000 @0.04 `0x0d0835`, 400 @0.07 `0x1e1270`) drawn without depth; AmbientLight `0x0a0620`×3, DirectionalLight `0xd4a84c`×1.8 at (5,2,4), PointLight `0x5b21d4` rim at (−4,−2,−5) (π-compensated on three≥r155, ColorManagement disabled, linear output — the whole file header documents r128 parity); sphere 72 segments, MeshPhongMaterial with the night map as **both `map` and `emissiveMap`** (emissive 0xffffff × 0.85, specular 0x3a1e90, shininess 18); atmosphere = BackSide shell r1.06, opacity 0.12, with an **analytic ray/sphere discard** replacing the depth test (Helio P35 has no working depth buffer — nothing may rely on depth); markers = ONE `THREE.Points` draw with per-vertex `aIdx/aHot`, shader pulse `s = 0.05 + 0.01*sin(pt + i*0.3)` (hot: 0.08, opacity 1 vs 0.85), facing-based fade `smoothstep(0, .15, n·toCam)` instead of depth; raster capped at **1.6× density** (`RASTER_CAP`, re-applied in resize); `renderer.setPixelRatio(1)` with sizes in buffer px; `antialias:false`, `precision:'highp'`; expo-gl shims (pixelStorei whitelist, fake canvas, WebGLRenderingContext hidden during the three constructor on ≥r163). Texture flow: `earthPixelsCached()` warm path → DataTexture at build, else `fallbackEarthTexture()` now + async `loadEarthTexture(gl, renderer, rawPixelStorei)` swap into both `map` and `emissiveMap` (dropped if `disposed`).

## 2. Gesture shared values (2026-10-03 rewrite, GlobeCanvas.tsx:129–266)

Declared in GlobeCanvas, written by **UI-thread worklets** on a `Gesture.Manual()`:

- `accX`, `accY` — accumulated pending rotation deltas (radians): `+= d{y,x} * 0.007` per move event (note the axis swap: finger dx→accY, dy→accX).
- `accZoom` — accumulated pinch delta: `+= (prevDist − dist) * 0.005`.
- `velX`, `velY` — last per-event velocity (`d * 0.007`), read only while dragging, feeds release inertia.
- `dragSV` — 1 finger-down / 0 up or cancelled.
- `tg` — worklet-private gesture state `{px,py,sx,sy,st,pinch,tap}` (prev point, start point, start time, pinch distance, tap candidacy). A tap = `tap===1 && |move|<12dp && <280ms`, dispatched via `runOnJS(onTapJS)(pt.x, pt.y)`.

The JS raf loop **consumes by read-and-zero**: `const d = acc.value; if (d!==0){ acc.value = 0; input.t* += d }` — gesture-exact across JS stalls, nothing lost or replayed. The manual gesture `mgr.activate()`s on touch-down so the REELS⇄GLOBE panel swipe (which `.requireExternalGestureToFail(globeGesture)` on it in GlobeScreen) never starts on the globe. `gestureRef` is `.withRef()`'d for that linkage. `onTouchStartJS` also fires `onTouching(true)` (wall stand-down) + `setTip(null)` + `clearHover()`; drag end flips `onTouching(false)` from the JS loop when `dragSV` goes 0.

**Worklet-renderer note:** these six shared values are exactly the boundary a worklet renderer needs — the UI thread already owns the input; today only the *consumption* (and the render) is on JS. The read-and-zero + clamp + inertia logic above is the complete set of per-frame JS the rebuild must move or keep equivalent.

## 3. Retry / rebuild flow (GlobeCanvas.tsx:67–122, 162–167)

- `glAttempt` state keys the `<GLView key={glAttempt} ... msaaSamples={0} />` — bumping it mounts a **fresh GLView** (fresh context).
- `retryGl()` — at most 3 attempts **per outage** (not per session), backoff `400ms × attempt`. Called when: (a) `onContextCreate` receives an unusable context (`!gl`, no `createTexture`, or `__voidMissingContext` — see the guard in `app/_layout.tsx`), (b) `createGlobeScene` throws, (c) `scene.frame()` throws mid-loop (loop sets `alive=false` first).
- `noteGlHealthy()` — zeroes `glRetries` on any frame that actually drew; 3 failures **in a row** still give up.
- `refreshNonce` (pull-to-refresh / tab re-tap, from GlobeScreen's `globeNonce`) resets `glRetries=0` and bumps `glAttempt` — an explicit refresh always gets a full budget.
- There is deliberately **no static-map fallback**: while rebuilding, the panel stays dark (`#04020c`). GlobeSearch still opens every nation regardless of GL health.
- `opaque` was a custom prop patched into expo-gl, and it never did anything: GLView.js spreads unknown props onto its wrapper View, and CI linked expo-gl as a prebuilt AAR that ignored the patched sources. Removed in 20c1e39. `patches/expo-gl` now re-arms the TextureView after every swap, so every rendered globe frame is shown, and package.json `expo.autolinking.android.buildFromSource: ["expo-gl"]` makes that patch compile.

## 4. sceneReady gating and loop lifecycle

- `onContextCreate` → `createGlobeScene` success → `scene.current = s; setSceneReady(true)`.
- The raf-loop effect runs only when **all** of `sceneReady && scene.current && running && appActive` hold (deps: `[sceneReady, running, appActive, noteGlHealthy]`); otherwise the loop is torn down (cancelAnimationFrame) — the globe holds its last frame, nothing disposed.
- `running` prop (from GlobeScreen) = `globeVisible && !wallScrolling` where `globeVisible = focused && appActive && mode === 'globe'`. `wallScrolling` is a self-expiring latch (900ms deadline refreshed by scroll events — momentum-end is unreliable). `appActive` is tracked **in both components** via AppState.
- GlobeScreen extras that gate mounting: the whole screen gets `display:'none'` (View.GONE releases the GL surface) when unfocused; `GlobeCanvas` only mounts after GLOBE mode has been seen once (`globeSeen`, else a same-height `#04020c` placeholder); `bundledEarthPixelsAsync()` is pre-warmed by the **screen** (outlives every canvas) so GLView remounts can't lose the decode; TTI is marked via `useObserve().markInteractive({params:{surface:'globe'}})` on the first drawn frame.
- Unmount cleanup: cancel raf, `scene.current?.dispose()`, null it.

## 5. onOpenCountry / tap picking

Gesture (UI thread) qualifies the tap → `runOnJS(onTapJS)(x, y)` → `scene.hover(x, y)` (screen-space nearest-marker pick described in §1 — **no raycast against the sphere mesh; markers only**) → if non-null: `setTip({x:x+14, y:y+10, name:c.n})` (the `#gtip` label, cleared on next touch) and `openRef.current(c)` → GlobeScreen's `openCountry` → `router.push('/nation/' + c.iso)`. The rebuilt renderer must expose an equivalent pick taking **view-dp coords** and returning a `Country` (needs `n` and `iso` at minimum), plus the hot-marker highlight side effect.

## 6. Other consumers — what must keep working if globeScene.ts stays only for them

`createGlobeScene` has **exactly one consumer**: `GlobeCanvas.tsx`. There is **no nation mini-globe** anywhere in `void-app/src`.

- `onboarding/OnboardGlobe.tsx` — explicitly "Deliberately NOT the app's globeScene: no textures, no stars, no raycasting" (its own three.js scene with the same expo-gl shims). `onboarding/GlobeIntro.tsx` renders it; `onboarding/globeBuild.ts` supports it. **Zero coupling to globeScene.ts** — unaffected by the swap, but it shares the expo-gl shim *pattern*, and it clears to alpha 0 (the expo-gl swap patch leaves a view's opacity as it was).
- `textures.ts` is shared infrastructure the rebuild will also want: `markerTexture(hot)`, `fallbackEarthTexture()`, `loadEarthTexture(gl, renderer, rawPixelStorei)`, `earthPixelsCached()`, `bundledEarthPixelsAsync()` (pre-warmed by GlobeScreen — keep that call). `earthPixels.ts`/`earthTexture.ts` back it.
- `index.ts` exports `GlobeScreen`, `GlobeCanvas`, `useGlobeHeight`, `ReelsView` — globeScene is **not** exported; the interface swap is fully internal to the globe feature.
- Consequence: if the main globe moves to a worklet renderer, `globeScene.ts` has **no remaining consumer** and can be deleted outright rather than kept — unless the new renderer keeps it as the fallback path behind the same `GlobeScene` interface.

## Key files
- `C:/the void/void-main/void-app/src/features/globe/GlobeCanvas.tsx`
- `C:/the void/void-main/void-app/src/features/globe/globeScene.ts`
- `C:/the void/void-main/void-app/src/features/globe/GlobeScreen.tsx`
- `C:/the void/void-main/void-app/src/features/globe/textures.ts`
- `C:/the void/void-main/void-app/src/features/onboarding/OnboardGlobe.tsx` (independent, untouched)
- `C:/the void/void-main/void-app/patches/expo-gl` (re-arms the TextureView after every swap; built from source via package.json)