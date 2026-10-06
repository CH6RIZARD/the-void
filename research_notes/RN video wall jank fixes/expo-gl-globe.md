# Three.js interactive globe on expo-gl (RN 0.86 / Expo SDK 57, Android, MediaTek + Mali)

Scope: instant fully-textured first paint, low-latency touch rotation, minimal steady-state cost while live video plays elsewhere. Stack constraint: keep three.js on expo-gl.

## Q1: Texture readiness — fully textured globe on first paint

### Takeaway
Decode happens natively: expo-gl's `texImage2D` accepts `{ localUri }` (a file:// URI) and decodes the image on the native side, so the right pattern is `Asset.loadAsync()` BEFORE mounting/using the context, then build the texture, force its GPU upload, render one frame, and only then call `gl.endFrameEXP()` — the TextureView shows nothing until the first `endFrameEXP()`, so gating the first `endFrameEXP()` on texture upload eliminates the untextured flash entirely. Avoid `new TextureLoader().load(...)` (expo-three), which is explicitly "immediately ready but loads asynchronously" — that is the texture-pop-in.

### Cited Findings
- expo-gl `texImage2D()`: "The pixels argument must be null, an ArrayBuffer with pixel data, or an object of the form { localUri } where localUri is the file:// URI of an image"; "An Asset object is used once .downloadAsync() has been called on it (and completed) to fetch the resource." — [Expo GLView docs v57](https://docs.expo.dev/versions/v57.0.0/sdk/gl-view.md)
- `gl.endFrameEXP()` "notifies the context that the current frame is ready to present. This is similar to a 'swap buffers' API call" — nothing is presented until it is called. — [Expo GLView docs v57](https://docs.expo.dev/versions/v57.0.0/sdk/gl-view.md)
- expo-three: `new TextureLoader().load(require('./img.png'))` — "This texture will be immediately ready but it'll load asynchronously" (i.e. the mesh renders untextured first); the synchronous-complete alternative is `await ExpoTHREE.loadAsync(require('./img.png'))`, and assets should be resolved via `Asset.loadAsync(require(...))` to a `localUri` first. — [expo-three README](https://github.com/expo/expo-three)
- expo-three README: "Loading assets before the initial render helps prevent performance bottlenecks during rendering cycles." — [expo-three README](https://github.com/expo/expo-three)
- Three.js textures "start uploading when the camera 'sees' them, which creates runtime performance issues"; pre-emptive GPU upload (drei's `useTexture` does this on web via `renderer.initTexture`) avoids the first-visible-frame upload stall. — [three.js discourse: useLoader/preload practice](https://discourse.threejs.org/t/good-practice-with-useloader-textureloader-for-web-performance-preload/57757)
- GPU-vendor guidance: upload textures during initialization, not mid-frame, and do a warm-up draw (draw obscured/off-screen triangles with the texture bound) to force the actual upload and "avoid the cost and potential stutters when they are uploaded on first use." — [Imagination performance recommendations: uploading textures](https://docs.imgtec.com/performance-guides/performance-recommendations/html/topics/texture-uploading.html); same timing advice in [Android AGI texture bandwidth docs](https://developer.android.com/agi/sys-trace/texture-memory-bw?hl=en)
- Texture sizing: use power-of-two textures to avoid runtime resizing (2048x1024 is POT per-dimension, fine), or set `minFilter = THREE.LinearFilter`; compress/downsize source images (webp, 2k not 4k). — [three.js manual: textures](https://threejs.org/manual/pages/textures.html); [three.js discourse: TextureLoader in ReactNative](https://discourse.threejs.org/t/textureloader-not-loading-textures-in-reactnative/27333)
- Known Android gotcha: a texture that fails via JPG has worked after converting to PNG in expo-three setups. — [Expo forums: texture not loading correctly](https://forums.expo.dev/t/expo-three-js-texture-not-loading-correctly/32528)

### Inferences
- Concrete onContextCreate flow for zero-pop first paint: (1) `Asset.loadAsync(require('earth.jpg'))` at app start (before the GLView screen mounts); (2) in `onContextCreate`, create renderer/scene, `const tex = await ExpoTHREE.loadAsync(asset)` (resolves from the already-downloaded localUri, so it's fast); (3) force upload with `renderer.initTexture(tex)` (three.js WebGLRenderer API for pre-upload) or by rendering one frame; (4) render the real frame; (5) only now start the rAF loop / call `endFrameEXP()`. Because the TextureView presents nothing until the first `endFrameEXP()`, the first visible frame is fully textured by construction.
- `createImageBitmap` should be assumed unavailable: Hermes/RN provide no DOM; expo-gl's native `{ localUri }` decode path in `texImage2D` is the replacement for it (the native module decodes the bitmap off the JS thread). Do not plan around ImageBitmap or OffscreenCanvas.
- `texSubImage2D` staging is unnecessary here: one 2048x1024 RGBA upload is ~8 MB, a one-time init cost; the win comes from doing it before first present, not from chunking it.
- expo-image prefetch helps only the file cache (disk), not the GL texture; GPU residency only happens via texImage2D in this context, so "prefetch to GPU" via expo-image is not a thing for expo-gl.

### Gaps
- No authoritative source found stating `createImageBitmap` is absent in Hermes (searches returned only generic Hermes Web-API limitations); treat as inference from RN having no DOM.
- Couldn't verify `renderer.initTexture()` behavior specifically on expo-gl (vs web); the safe portable variant is rendering one warm-up frame before the first `endFrameEXP()`.

## Q2: Compressed textures (KTX2/Basis, ETC2) on expo-gl

### Takeaway
Dead end on this stack: `compressedTexImage2D()` is in expo-gl's documented list of unimplemented WebGL methods, so KTX2/Basis/ETC2 textures cannot be uploaded at all, regardless of three.js loader support. Spend the effort on a smaller JPEG/WebP source and mipmaps instead.

### Cited Findings
- Expo GLView docs list ~15 unimplemented methods including `compressedTexImage2D()`, `fenceSync()`, `getUniform()`, `getTexParameter()`; also "the current implementations of the methods don't perform type or bounds checking on their arguments." — [Expo GLView docs v57](https://docs.expo.dev/versions/v57.0.0/sdk/gl-view.md)
- Sept 2025 report: KTX2 textures fail in Expo RN (expo-gl + expo-three) while PNG works; expo-three explicitly handles only `['jpeg','jpg','gif','png']`; missing pieces are CompressedTexture support (ETC2/ASTC/BCn), the WASM transcoder, and worker infrastructure; manual KTX2Loader+GLTFLoader integration was attempted without seamless success. — [three.js discourse: KTX2 not loading in Expo](https://discourse.threejs.org/t/ktx2-texture-not-loading-in-expo-three-js-react-native/87148)
- KTX2Loader requires the Basis transcoder (`basis_transcoder.js` + `.wasm`) and transcodes to GPU formats at load time. — [three.js KTX2Loader docs](https://threejs.org/docs/pages/KTX2Loader.html)

### Inferences
- The theoretical Mali win (ETC2 = 4-8x less texture memory and bandwidth, near-instant upload) is real but unreachable through expo-gl today; the practical equivalent is: keep the source 2048x1024 (or drop to 1024x512 on this GPU tier — at globe sizes on a phone screen the visible mip level is far below 2048 anyway), generate mipmaps once at init, and consider `THREE.RGBFormat`/no-alpha to cut memory.
- A targeted library addition for KTX2 is NOT "fine" here despite the constraint allowing it — the blocker is the expo-gl native layer, not JS.

### Gaps
- No data found on whether Expo plans to implement `compressedTexImage2D` (no tracked issue found in searches).

## Q3: Touch latency — driving rotation from gestures

### Takeaway
Three.js cannot run inside the expo-gl worklet context (documented limitation), so a pure UI-thread render path means abandoning three.js for the globe. The realistic pattern on this stack: react-native-gesture-handler `Gesture.Pan` (events delivered on UI thread) writing to Reanimated shared values, read each frame by the JS render loop — this removes PanResponder's JS-thread event latency, but frame production still depends on the JS thread, so the companion fix is cutting JS-thread work (Q4/Q5) and keeping the loop on-demand.

### Cited Findings
- `enableExperimentalWorkletSupport` (default false): "Enables support for interacting with a gl object from code running on the Reanimated worklet thread"; pattern is `runOnUI((contextId) => { 'worklet'; const gl = GLView.getWorkletContext(contextId); ... })(gl.contextId)`. Documented limitations: "Third-party libraries like Pixi.js or Three.js won't work inside the worklet"; assets must be loaded on the main thread and passed by reference; the render loop inside the worklet uses `requestAnimationFrame`. — [Expo GLView docs v57](https://docs.expo.dev/versions/v57.0.0/sdk/gl-view.md)
- Reanimated worklets/animations run on the UI thread and "stay smooth even when the JS thread is busy"; shared values (`useSharedValue`) are the mechanism for passing gesture state across threads. — [Expo tutorial: gestures](https://docs.expo.dev/tutorial/gestures/); [Reanimated docs](https://docs.swmansion.com/react-native-reanimated/docs/3.x/)
- "When the JavaScript thread blocks ... more JavaScript, more React, and a higher chance of blocking the JavaScript thread" — Expo's own guidance is to move interaction off the JS thread. — [Expo blog: best practices for reducing lag](https://expo.dev/blog/best-practices-for-reducing-lag-in-expo-apps)
- Community alternative: `@hashiprobr/expo-three-view` wraps expo-three with built-in one-finger orbit/rotate controls and auto-resizing (JS-thread based). — [npm: @hashiprobr/expo-three-view](https://www.npmjs.org/package/@hashiprobr/expo-three-view)

### Inferences
- Architecture that fits the constraints: Pan gesture (gesture-handler) -> `onUpdate` worklet writes `rotationY.value`/`velocity.value` (shared values) -> JS rAF loop reads them (`rotationY.value` is readable from JS) and sets `globe.rotation.y` before `renderer.render`. Input sampling is then UI-thread; only frame production is JS-bound. PanResponder would add JS-thread queuing latency on top — avoid it.
- The "max decoupling" option the docs actually support is a worklet render loop with raw WebGL (no three.js): a textured sphere is ~1 VBO + 1 shader + 1 texture, feasible as hand-written GL in a worklet, with the texture uploaded from the main thread first. This fully survives JS stalls but is a partial rewrite of the globe — note it as the escalation path if JS-thread load can't be tamed, not the first move.
- Worklet support maturity: the prop is literally named "experimental", three.js is excluded by design, and no production case studies were found; treat as fallback, not foundation.
- Because gesture state lives in shared values, momentum/inertia can run as a Reanimated `withDecay` on the shared value — the globe then keeps tracking physics even if a JS frame is dropped, and catches up on the next rendered frame instead of accumulating stale PanResponder events.

### Gaps
- Found no published example of a three.js app on expo-gl achieving UI-thread-independent rendering; no benchmark comparing gesture-handler-fed vs PanResponder-fed expo-gl latency.
- Did not locate the complete worklet example the Expo docs reference in the expo/expo repo (docs link to it; path not confirmed).

## Q4: Render loop discipline, framebuffer config, DPR, antialias on Mali

### Takeaway
Render on demand (only while the finger is down or decay is still moving), keep the GLView opaque, and lean on mipmaps for quality; on Mali, 4x MSAA is nearly free bandwidth-wise due to tile memory, but for a textured sphere mipmapping matters more. The drawing buffer size is set by the view, so resolution scaling means rendering the GLView at a smaller layout size (or to a smaller FBO) rather than a DPR knob.

### Cited Findings
- Three.js official on-demand rendering: render once at start, then only on change events (controls `change`, data arriving, resize); guard with a `renderRequested` flag + `requestAnimationFrame` to avoid loops; with damping, keep calling `controls.update()`/re-render until motion rests. "Rendering continuously is a waste of device power." — [three.js manual: rendering on demand](https://threejs.org/manual/en/rendering-on-demand.html)
- expo-gl's Android GLView is `class GLView(context, appContext) : TextureView(context), SurfaceTextureListener` with `isOpaque = false` set in the initializer (transparent by default — an opaque override is a real win since blending is otherwise forced). GL work is queued to a dedicated GL thread: `fun runOnGLThread(r: Runnable?) { glContext.runAsync(r) }`. — [expo-gl GLView.kt source](https://github.com/expo/expo/blob/main/packages/expo-gl/android/src/main/java/expo/modules/gl/GLView.kt)
- TextureView "combines a view with a SurfaceTexture" and is composited through the UI renderer, unlike SurfaceView, which gets a separate compositor surface/overlay; GLSurfaceView renders on a dedicated thread "to decouple rendering performance from the UI thread." — [Android graphics architecture](https://source.android.com/docs/core/graphics/architecture)
- Mali is tile-based (16x16 tiles); MSAA samples fit in on-chip tile memory, so 4x/8x/16x MSAA costs little external bandwidth ("free" in bandwidth terms); Mali-400-era marketing: "4x multisampling with virtually no performance drop". — [ARM: The Mali GPU, an abstract machine part 2](https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/the-mali-gpu-an-abstract-machine-part-2---tile-based-rendering); [Mali-400 MP, Wikipedia](https://en.wikipedia.org/wiki/Mali-400_MP)
- Mipmapping for 3D content reduces memory bandwidth, improves texture cache efficiency AND image quality on mobile GPUs; texture bandwidth is a first-order cost tracked by dedicated Mali counters. — [Android AGI: texture memory bandwidth](https://developer.android.com/agi/sys-trace/texture-memory-bw?hl=en)
- `msaaSamples` prop is iOS-only (default 4) in expo-gl; no Android equivalent documented. — [Expo GLView docs v57](https://docs.expo.dev/versions/v57.0.0/sdk/gl-view.md)
- Standard expo-three sizing is `renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight)` — the buffer size comes from the native view. — [expo-three README](https://github.com/expo/expo-three)
- Baseline expectation check: a 100-cube three.js demo on expo-gl Android ran ~26 fps while the same scene was smooth in a WebView on the same phone — expo-gl Android has real per-frame overhead; budget accordingly. — [Expo forums: expo-gl really poor performance](https://forums.expo.dev/t/expo-gl-really-poor-performance-how-to-improve/46540)

### Inferences
- On-demand loop for the globe: render only when (a) pan active, (b) `withDecay` still changing the shared value beyond epsilon, or (c) an explicit invalidate (texture swap). Idle globe = zero GPU cost, which is exactly what you want while video decoders are working. Auto-rotate "idle spin" should be throttled (e.g. 30 fps cap via timestamp check in rAF) or dropped while videos are on-screen.
- Since Android has no msaaSamples knob and three.js's `antialias` constructor flag has no effect on an externally-created context's framebuffer, don't chase MSAA on Android expo-gl; a sphere's silhouette aliasing at phone size is minor, and mipmapped texture filtering handles the interior.
- Resolution scaling without a DPR API: style the GLView at ~70% of target size and scale it up with a `transform: [{scale}]` (TextureView contents scale with the view), or render the scene into a half-res FBO and blit a fullscreen quad. First option is a 2-line change; measure fill-rate savings on the Mali clone before keeping it.
- TextureView cost is structural: every presented GL frame is also re-composited by the UI renderer (extra GPU pass + memory vs SurfaceView). expo-gl offers no SurfaceView mode, so the mitigation is fewer presented frames (on-demand rendering), not a different backing.

### Gaps
- No documented expo-gl API for drawing-buffer scale/DPR on Android (docs don't mention one; GLView.kt review via fetch didn't surface one) — the layout-size trick is community practice, not documented.
- No published Mali-specific numbers for expo-gl frame overhead; the 26 fps forum report is anecdotal and old.

## Q5: GL canvas + many video decoders on MediaTek/Mali

### Takeaway
Decoder instance limits and shared-GPU composition are the two contention channels: some chipsets allow only one or a few parallel hardware decode pipelines, and every TextureView (video or GL) frame costs a GPU composition pass. Cap simultaneous decoders hard, release players aggressively, and prefer SurfaceView-backed video so video frames bypass the GPU compositor that the globe needs.

### Cited Findings
- "Some devices impose a limit on the number of instances of codec that can be instantiated at once"; some mobile/TV hardware "can only handle one active video decode pipeline at a time"; depending on chipset, decoders may exist but be unable to run in parallel, or the display pipeline may expose only one hardware video surface. — [Bitmovin: single-decoder device limitations](https://developer.bitmovin.com/playback/docs/understanding-single-decoder-device-limitations)
- MediaCodec decode can stall from buffer starvation: "since the pictures are not displayed, the output buffers are not released, causing the decoder to become blocked" — undisplayed/off-screen players holding output buffers choke the pipeline. — [VLC devel: Android MediaCodec direct rendering](https://mailman.videolan.org/pipermail/vlc-devel/2013-November/095382.html)
- Android guidance: release unused media players immediately; "there might be side effects with some decoders if there are multiple active (initialized) mediaplayers." — [B4X forum citing Android docs](https://www.b4x.com/android/forum/threads/playing-multiple-simultaneous-videos-on-the-same-activity.94397/latest)
- Observed Mali-G31 (same GPU family/class as the target devices) symptoms under decode pressure: "video with lags and strange green frames" with MediaCodec on Android TV boxes. — [FFmpeg trac #11676](https://trac.ffmpeg.org/ticket/11676)
- SurfaceView gets its own compositor surface (overlay path, no GPU re-composition); TextureView content must be drawn through the UI renderer. — [Android graphics architecture](https://source.android.com/docs/core/graphics/architecture)
- Mali texture/memory bandwidth is the scarce shared resource; AGI exposes "Texture read beats from external memory" counters to diagnose it. — [Android AGI: texture bandwidth](https://developer.android.com/agi/sys-trace/texture-memory-bw?hl=en)

### Inferences
- Symptom signature of GPU scheduler saturation on this class of device: GL frame time becomes bimodal/spiky while JS frame time looks fine, video shows green/corrupt frames or stalls, and both get worse together — because decoder output (SurfaceTexture updates), video composition, and the GL canvas all contend for the same small Mali and memory bus. The globe's cheapest contribution is to not present frames when idle (Q4).
- When the globe IS visible and spinning, every video TextureView update + the GLView update are separate GPU composition jobs per vsync; keeping total simultaneous decoders at 2-3 max on these MediaTek clones (they already crash/oversubscribe per the project's prior findings) and pausing off-screen players (releasing, not just pausing, per the buffer-starvation mechanism above) is the dominant fix.
- No evidence was found of EGL-context-level conflict between expo-gl and MediaCodec (they use separate EGL surfaces); the contention is GPU time + memory bandwidth + decoder instances, not EGL correctness.

### Gaps
- No MediaTek-published numbers on concurrent decoder instance limits per chipset (vendor docs not public); must be measured per device (`MediaCodecList`/`CodecCapabilities.getMaxSupportedInstances()` reports it at runtime — API exists but no fetched doc citation here).
- No engineering post found from Mapbox/maps vendors specifically about GL + many video decoders coexisting; that combination appears under-documented.

## Q6: expo-gl known issues — TextureView, frame pacing, JS stalls, GL thread survival

### Takeaway
The GL thread is native and survives JS stalls — commands are queued to it via `glContext.runAsync` — but on the normal (non-worklet) path, new frames are only produced when JS runs rAF callbacks and calls `endFrameEXP()`, so a blocked JS thread freezes the globe (it does not go black; the TextureView keeps its last presented frame). `onContextCreate` itself fires from native but your handler runs on JS, so a busy JS thread delays initial texture load and first paint — another reason to preload assets before mount.

### Cited Findings
- GLView (Android) = TextureView subclass; `isOpaque = false` by default; GL operations queued to a separate GL context thread (`runOnGLThread` -> `glContext.runAsync`); surface init is deferred until non-zero dimensions arrive (`onSurfaceTextureSizeChanged`). — [expo-gl GLView.kt](https://github.com/expo/expo/blob/main/packages/expo-gl/android/src/main/java/expo/modules/gl/GLView.kt)
- Presentation is explicit: `endFrameEXP()` = swap buffers; there is also `flushEXP()`. — [Expo GLView docs v57](https://docs.expo.dev/versions/v57.0.0/sdk/gl-view.md)
- Documented limitations: breaks under remote debugging ("GLView requires synchronous native calls that are not supported in Chrome"); ~15 unimplemented methods (`compressedTexImage2D`, `fenceSync`, `getUniform`, `getFramebufferAttachmentParameter`, `getTexParameter`, ...); no argument type/bounds checking; older Android devices may lack WebGL2 features. — [Expo GLView docs v57](https://docs.expo.dev/versions/v57.0.0/sdk/gl-view.md)
- Worklet path exists precisely to decouple from JS: render loop via rAF inside the worklet on the Reanimated UI-thread runtime, with `GLView.getWorkletContext(contextId)` — but without three.js (see Q3). — [Expo GLView docs v57](https://docs.expo.dev/versions/v57.0.0/sdk/gl-view.md)
- Frame-rate ceiling evidence on Android expo-gl: 100-cube three.js scene at ~26 fps vs smooth WebView on the same device. — [Expo forums](https://forums.expo.dev/t/expo-gl-really-poor-performance-how-to-improve/46540)
- Headless contexts: `GLView.createContextAsync()` is "slightly faster than usual context as it doesn't swap framebuffers" — useful for offline texture work, not for the visible globe. — [Expo GLView docs v57](https://docs.expo.dev/versions/v57.0.0/sdk/gl-view.md)

### Inferences
- Frame pacing: there is no native-driven vsync render callback in expo-gl's JS path — pacing is whatever RN's JS rAF gives you, so JS GC pauses and bridge/TurboModule work from the video feed directly show up as globe hitches. On-demand rendering shrinks the window in which a hitch is visible (idle globe never hitches).
- Practical priority order for this app: (1) preload + gate first `endFrameEXP()` on texture upload (kills pop-in, free); (2) gesture-handler + shared values + on-demand render with decay (kills most perceived latency, small diff); (3) opaque GLView (done) + mipmaps + possibly 1024x512 texture + smaller-layout upscale (steady-state cost); (4) decoder cap/release discipline on the wall (biggest systemic win); (5) only if still inadequate: raw-GL globe in a worklet (rewrite-lite, experimental API).

### Gaps
- No GitHub issue found that definitively documents expo-gl behavior during multi-second JS stalls (e.g., whether queued GL commands still flush); the "last frame persists" behavior is inferred from TextureView semantics + explicit endFrameEXP presentation model.
- Frame pacing internals (how GLContext schedules swap on the GL thread relative to choreographer vsync) were not confirmed from source; only GLView.kt was reviewed, not GLContext.
