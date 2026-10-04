# expo-gl worklet rendering — exact API contract (Expo SDK 57)

**Verified versions** (from `https://unpkg.com/expo@57.0.23/bundledNativeModules.json`): `expo-gl@~57.0.2`, `react-native-reanimated@4.5.1`, `react-native-worklets@0.10.1`. All code below read from `expo/expo` branch `sdk-57`, `packages/expo-gl`, and `software-mansion/react-native-reanimated` tag `4.5.1`.

---

## 1. Setting up a worklet render loop

Two pieces: the prop, and `runOnUI` from reanimated. There is **no expo-gl hook** — you start the loop yourself with `runOnUI` + `requestAnimationFrame` inside the worklet.

**Prop** (`src/GLView.types.ts`):
```ts
export type GLViewProps = {
  onContextCreate(gl: ExpoWebGLRenderingContext): void;
  msaaSamples?: number;              // iOS only; default 4
  /** Enables support for interacting with a `gl` object from code running on
   *  the Reanimated worklet thread. @default false */
  enableExperimentalWorkletSupport?: boolean;
  nativeRef_EXPERIMENTAL?(callback: ComponentOrHandle | null): void;
} & ViewProps;
```

**Context accessor** — use the **standalone export**, not the class static (`src/GLView.tsx`):
```ts
export function getWorkletContext(contextId: number): ExpoWebGLRenderingContext | undefined {
  'worklet';
  return workletContextManager.getContext(contextId);   // reads global.__EXGLContexts[String(contextId)]
}
```
The class static is dead under reanimated 3+/4 — do not use it:
```ts
/** This method doesn't work inside of the worklets with new reanimated versions.
 *  @deprecated Use `getWorkletContext` from the global scope instead. */
static getWorkletContext: (contextId: number) => ExpoWebGLRenderingContext | undefined = ...
```
(Expo's own v57 docs page still shows `GLView.getWorkletContext` in the example — that is the stale pattern from issues expo/expo#23969 / #24176; the canonical SDK 57 example app uses the standalone import.)

**Canonical loop shape** — straight from `apps/native-component-list/src/screens/GL/GLReanimatedExample.tsx` (sdk-57):
```tsx
import { ExpoWebGLRenderingContext, GLView, getWorkletContext } from 'expo-gl';
import { runOnUI, useSharedValue } from 'react-native-reanimated';

// started from onContextCreate(gl) on the JS thread:
runOnUI((glCtxId: number) => {
  'worklet';
  const workletGl = getWorkletContext(glCtxId)!;   // defined: see ordering guarantee below
  const ctx = onInit(workletGl);                   // 'worklet' fn: shaders, buffers, textures
  const renderer = () => {
    'worklet';
    if (canceled.value) return;                    // teardown via a shared value
    onRender(workletGl, ctx);                      // 'worklet' fn: per-frame draws
    rafId.value = requestAnimationFrame(renderer); // rAF exists on the UI runtime; setTimeout does NOT
  };
  renderer();
})(gl.contextId);

<GLView style={{flex:1}} enableExperimentalWorkletSupport onContextCreate={onContextCreate} />
```
Every function the loop calls must carry `'worklet'` (or be auto-workletized by the babel plugin). Teardown: set a shared value flag (`canceled.value = true`) in the effect cleanup; `cancelAnimationFrame` from JS does not reach the UI runtime's rAF id reliably — the example uses the flag for the UI path.

**Ordering guarantee**: on Android, `GLContext.initialize()` runs `EXGLContextPrepareWorklet(mEXGLCtxId)` on the UI queue thread and only **then** fires `completionCallback` → `onSurfaceCreate` → your `onContextCreate` (`android/.../GLContext.java`). iOS equivalently passes `enableExperimentalWorkletSupport` into `glContext.prepare(withRuntimePointer:...)` before `maybeCallSurfaceCreated()` (`ios/GLView.swift` L77-85). So by the time `onContextCreate` fires, `getWorkletContext(gl.contextId)` is defined inside worklets.

## 2. Which GL calls work from the worklet, and how the context gets there

How the context reaches the worklet (`common/EXGLNativeContext.cpp`):
```cpp
void EXGLContext::prepareWorkletContext() {
  if (maybeWorkletRuntime == nullptr) return;
  jsi::Runtime &runtime = *this->maybeWorkletRuntime;
  createWebGLRenderer(runtime, this, initialGlesContext,
      runtime.global().getPropertyAsObject(runtime, "global"));
  tryRegisterOnJSRuntimeDestroy(runtime);
}
```
i.e. expo-gl installs a **second, full JSI WebGL2 wrapper object** (same `contextId`, same native EXGL context, same object-id map) into the reanimated UI runtime's `global.__EXGLContexts`. The UI-runtime pointer is discovered at `prepareContext` time by reading `global._WORKLET_RUNTIME` from the RN runtime — an ArrayBuffer of `sizeof(void*)` holding a `jsi::Runtime*` (`maybeResolveWorkletContext`, `EXGLNativeContext.cpp`). Reanimated 4.5.1 still installs exactly that: `RNRuntimeDecorator.cpp` L13-20 writes `&uiRuntime` into an 8-byte ArrayBuffer and sets `rnRuntime.global()._WORKLET_RUNTIME`. **Contract intact on reanimated 4.5.1 / worklets 0.10.1 / new arch.** (`globalThis._WORKLET_RUNTIME` truthiness on the JS side is also the canonical feature-detect, per the example app.)

**All** WebGL1/2 methods the wrapper implements work identically from the worklet — the method table is the same `EXWebGLMethods.def` install; calls are queued (`addToNextBatch`) and executed on the GL thread. The unimplemented-methods list (docs v57): `getFramebufferAttachmentParameter, getRenderbufferParameter, compressedTex*`, `getTexParameter, getUniform, getVertexAttrib*, getBufferSubData, getInternalformatParameter, renderbufferStorageMultisample, fenceSync/isSync/deleteSync/clientWaitSync`, etc.

**Concurrency caveat**: `addToNextBatch` pushes to `nextBatch` with **no mutex** (only `endNextBatch`/`flush` lock `backlogMutex`, `EXGLNativeContext.cpp/.h`). Both runtime wrappers feed the *same* `nextBatch`. Do not drive the same context from the JS thread and the worklet concurrently — hand ownership to the worklet after `onContextCreate` and keep JS-side GL quiet while the loop runs.

## 3. Texture upload from the worklet — `texImage2D({ localUri })`

Yes, it works **from the worklet**, and it is the documented pattern. `common/EXGLImageUtils.cpp` `loadImage` reads exactly one property off the pixels object: `localUri` (string). Requirements: URI must start with `file://` (`strncmp(localUri.c_str(), "file://", 7)`); decode is stb_image with `STBI_ONLY_JPEG` + `STBI_ONLY_PNG` — **JPEG/PNG only, no http(s), no asset:// / content://**. The decode runs synchronously on the calling thread; only the `glTexImage2D` upload is batched to the GL thread (`EXWebGLMethodsTextures.cpp`).

The split the docs mandate: *downloading/resolving* the asset must happen on the JS thread (expo-asset needs native modules unavailable to worklets); the resulting plain object crosses into the worklet. Exact canonical shape (GLReanimatedExample.tsx):
```tsx
const [assets] = useAssets([require('./expo-icon.png')]);
const asset = useSharedValue<Asset | undefined>(undefined);
useEffect(() => {
  if (assets) {
    // Objects with a prototype are not supported in worklets.
    asset.value = { ...assets[0] } as Asset;   // spread strips the prototype; keeps .localUri
  }
}, [assets]);

// inside the worklet init:
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, asset.value! as any); // 6-arg form
```
`ArrayBufferView` pixels also work from the worklet (copied via `rawTypedArray`, flipped if `UNPACK_FLIP_Y_WEBGL`).

**JS-created texture usable from the worklet loop: yes.** Both wrappers address the same native EXGL context; object handles are context-global ids in `EXGLContext::objects` mapped on the GL thread (`createObject/mapObject/lookupObject`). A `WebGLTexture` created on the JS thread is valid in worklet draw calls — but it is a host-backed JSI object from the RN runtime, so you cannot *pass the handle object itself* through `runOnUI` captures (worklets clone, and host objects/prototypes don't clone). Practical rule: **create everything you'll use in the loop inside the worklet** (the canonical example creates shaders, buffers and textures in a `'worklet'` init function), or do JS-side setup only for things you never reference from the worklet.

## 4. Per-frame values from Reanimated shared values

Nothing special is needed: the loop *is* a worklet on the UI runtime, so `sharedValue.value` reads are direct, synchronous, zero-copy. From the canonical example's render worklet:
```ts
gl.uniform2fv(rotationLocation, [
  (translation.x.value * 2) / gl.drawingBufferWidth,
  (translation.y.value * 2) / gl.drawingBufferHeight,
]);
```
Writes from JS (`sv.value = x`) or from gesture worklets propagate normally; the next rAF tick sees them. Use shared values for control flags too (`canceled`, `rafId` in the example). Plain captured variables are frozen clones at `runOnUI` call time — anything that changes per frame must be a shared value.

## 5. `endFrameEXP` semantics in worklets

Identical to JS — the implementation is runtime-agnostic (`common/EXWebGLMethodsDraw.cpp` L844):
```cpp
NATIVE_METHOD(endFrameEXP) {
  CTX();
  ctx->addToNextBatch([=] { ctx->needsRedraw = true; });
  ctx->endNextBatch();        // moves nextBatch onto the backlog (mutex-guarded)
  ctx->flushOnGLThread();     // wakes the GL thread, which runs flush() = replays the batch
  return nullptr;
}
```
It marks the frame ready (`needsRedraw` gates the Android swap / iOS blit — "blit framebuffers if endFrameEXP was called", `ios/GLView.swift`), seals the batch, and kicks the GL thread. Until you call it, queued GL ops may never execute — **call it exactly once per rAF tick, from the worklet, as the last call**. `flushEXP()` is only a blocking no-op for timing measurements (`addBlockingToNextBatch([&]{})`). Types (`GLView.types.ts`): `contextId: number; endFrameEXP(): void; flushEXP(): void;` on `ExpoWebGLRenderingContext extends WebGL2RenderingContext`.

## 6. Known issues / limits

- **Stale API in docs**: `GLView.getWorkletContext` (static) throws/undefined inside worklets since reanimated 3 (expo/expo#23969, #24176, both closed) — the fix is the standalone `getWorkletContext` import; the deprecation note is in GLView.tsx itself. Expo's docs example hasn't been updated.
- **Reanimated must initialize first**: `maybeResolveWorkletContext` runs once at surface prepare; `createWorkletContextManager` (`src/GLWorkletContextManager.ts`) does `require('react-native-reanimated')` in a try/catch and notes a Metro `inlineRequires` interaction — reanimated "needs to be imported before any workletized code is created". With SDK 57 defaults (reanimated in the babel preset, imported at app root) this is satisfied. If reanimated is absent, `getContext` throws `'Worklet runtime is not available'`.
- Docs-stated worklet limits (v57 gl-view.mdx): no Three.js/Pixi.js inside the worklet; only `'worklet'` functions; rendering loop must use `requestAnimationFrame` (`setTimeout` unsupported); assets load on main thread and cross as plain objects.
- Worklet cloning: objects with prototypes don't cross `runOnUI` — spread-clone assets (comment in the canonical example).
- Unsynchronized `nextBatch` adds across the two runtimes (section 2) — serialize ownership.
- Unmount: `componentWillUnmount` → `unregisterGLContext` also `runOnUI`-deletes `global.__EXGLContexts[id]` on the UI runtime (`GLWorkletContextManager.ts`); stop your rAF loop via a shared-value flag or you'll render into a dead context id (`getWorkletContext` returns `undefined` after unregister — guard if the loop can outlive the view).
- History for confidence on this device class: worklet support shipped 11.1.0 (PR #15296), Android crash fixed by packaging the runtime pointer in an ArrayBuffer (11.3.0, PR #17194 — exactly the `_WORKLET_RUNTIME` mechanism above), context-creation moved to UI thread + explicit opt-in prop in 13.0.0 (PRs #22613, #22634). Latest expo-gl is 57.0.2 (2026-07-15); no open worklet issues found on expo/expo as of 2026-10-03.

**Citations**: expo/expo@sdk-57 `packages/expo-gl/src/{GLView.tsx, GLView.types.ts, GLWorkletContextManager.ts, index.ts}`, `common/{EXGLNativeContext.cpp/.h, EXGLNativeApi.cpp, EXWebGLRenderer.cpp, EXWebGLMethodsDraw.cpp, EXWebGLMethodsTextures.cpp, EXGLImageUtils.cpp, EXWebGLMethods.def}`, `android/src/main/java/expo/modules/gl/{GLView.kt, GLContext.java}`, `android/src/main/cpp/EXGLJniApi.cpp`, `ios/GLView.swift`, `CHANGELOG.md`; `apps/native-component-list/src/screens/GL/GLReanimatedExample.tsx`; expo docs `versions/v57.0.0/sdk/gl-view.mdx`; software-mansion/react-native-reanimated@4.5.1 `Common/cpp/reanimated/RuntimeDecorators/RNRuntimeDecorator.cpp`; unpkg `expo@57.0.23/bundledNativeModules.json`.