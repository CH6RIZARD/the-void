# expo-void-sensing — build log

## Status (2026-09-13)

**A real compile is still pending.** The machine these changes were written on has no
Java/Android SDK (and too little disk to install one), so neither
`npx expo prebuild --clean -p android && cd android && ./gradlew :expo-void-sensing:compileReleaseKotlin assembleRelease`
nor `npm install` was run. The first real compile will be the EAS `preview` build
(`eas build -p android --profile preview`). Paste its full Gradle log below under
"Compile logs" so errors are never "UNKNOWN" again, and fix from there.

Target toolchain: Expo SDK 51 (expo-modules-core ~1.12, Kotlin ~1.9.23, AGP 8,
compileSdk 34), CameraX 1.3.4, ML Kit face-detection 16.1.7 (bundled),
kotlinx-coroutines 1.7.3, androidx.security-crypto 1.1.0-alpha06.

## Workstream B1/B2/B4 — what changed

### Build / config (B1)
- Module moved back to `void-app/modules/expo-void-sensing` (autolinked again).
- `modules/expo-void-sensing/android/build.gradle`
  - `lintOptions {}` → `lint {}` (AGP 8).
  - Added explicit `androidx.core:core-ktx:1.12.0`, `androidx.lifecycle:lifecycle-runtime-ktx:2.7.0`,
    `androidx.annotation:annotation-experimental:1.4.0`.
  - Added `com.google.mlkit:face-detection:16.1.7` (bundled model, no Play Services download).
  - Kept CameraX core/camera2/lifecycle 1.3.4, coroutines, security-crypto.
  - **Removed** `androidx.health.connect:connect-client` and `org.tensorflow:tensorflow-lite`.
  - minSdk fallback 26 → 24.
- `android/.../capture/HealthBridge.kt` **deleted**; no Health Connect references remain.
- Module `AndroidManifest.xml`: CAMERA; `BLUETOOTH_SCAN` (`usesPermissionFlags="neverForLocation"`);
  `BLUETOOTH_CONNECT`; legacy `BLUETOOTH`/`BLUETOOTH_ADMIN` with `maxSdkVersion=30`;
  camera / camera.front / camera.flash / bluetooth_le features `required=false`.
  Removed BODY_SENSORS and health.* permissions.
- `modules/expo-void-sensing/app.plugin.js`: adds CAMERA + BLUETOOTH_SCAN (neverForLocation) +
  BLUETOOTH_CONNECT, strips ACTIVITY_RECOGNITION / BODY_SENSORS / health.* if present, marks camera
  and BLE features optional, sets NSCameraUsageDescription / NSBluetoothAlwaysUsageDescription,
  deletes NSHealthShare/UpdateUsageDescription.
- `void-app/app.json`: permissions now CAMERA, BLUETOOTH_SCAN, BLUETOOTH_CONNECT
  (ACTIVITY_RECOGNITION and health.READ_HEART_RATE removed; RECORD_AUDIO still blocked).
  iOS: removed NSHealthShareUsageDescription and NSFaceIDUsageDescription (nothing uses
  LocalAuthentication); added NSBluetoothAlwaysUsageDescription; rewrote NSCameraUsageDescription
  and the expo-camera `cameraPermission` to cover the front-camera on-device attention/expression/
  pulse estimate and the rear-camera calm reading. NSMotionUsageDescription kept for now — the iOS
  agent should remove it if the Swift side uses only raw CMMotionManager.
  Added the `expo-build-properties` plugin: android minSdk 24 / compileSdk 34 / targetSdk 34,
  ios deploymentTarget 15.1.
- `void-app/package.json`: added `expo-build-properties ~0.12.0` (run `npm install` / EAS installs it).
- `void-app/app.config.js`: comment no longer describes the module as disabled.
- `tsconfig.json`: no change needed (it never referenced native-modules-disabled).
- `README.md`: architecture line no longer lists Health Connect / TFLite.

### Android affect pipeline (B2)
- `affect/AffectState.kt`: `AffectWindow` gains optional `face` (blink z, gaze-on-screen fraction,
  smile prob/z, quality), `heart` (hr z, hrv z, source confidence), `touch` (speed/jitter/reversal z,
  events) and `context` (proximity near, low light, headphones). `HeuristicAffectEstimator` is a
  confidence-weighted mean over whatever evidence is present; confidence = coverage × motion penalty,
  capped at 0.7.
- `affect/AffectModel.kt`: `TFLiteAffectEstimator` now delegates to the heuristic (no TFLite).
- New `capture/FaceCapture.kt`: CameraX front camera ImageAnalysis ~640×480 (ResolutionSelector),
  KEEP_ONLY_LATEST, ~10 fps (5 fps under 20 % battery), ML Kit FAST + classification + contours.
  Blink rate (eye-open < 0.3 transitions, per minute over 60 s), gaze-on-screen (|yaw|,|pitch| < 20°
  over 10 s), smoothed smile prob, forehead + cheek ROI mean G from Y/U/V planes (rotation-mapped).
  Frames closed immediately, never stored.
- New `capture/RPPGCapture.kt`: ring buffer of (t, G), resample to 10 Hz, shared band-pass + DFT,
  45–180 bpm, quality from SNR; only when MotionGate says still and a face is present.
- `capture/PPGCapture.kt`: added `PulseDsp` (resample, sample rate, normalized band-pass + DFT
  estimate) shared by rPPG and the calm reading.
- `capture/PPGCameraSource.kt`: background analysis executor, unbinds only its own use case (no
  `unbindAll`, so it cannot kill face capture), torch off on stop, wall-clock timestamps.
- New `capture/CalmReading.kt`: 30 s session, progress every 1 s over the trailing 10 s, final
  estimate over 3–30 s (fallback: median of valid windows). Result stored in
  `BaselineStore.setCalibration`, which also learns an rPPG bpm offset from rPPG readings in the
  following 10 min.
- New `capture/BleHeartRate.kt`: LE scan filtered on 0x180D (15 s), GATT connect, CCCD 0x2902 notify on
  0x2A37, flags parsing (uint8/uint16 bpm, energy-expended skip, RR in 1/1024 s), RMSSD over the last
  30 RR intervals. Runtime-permission checked before every call; errors reported as status events.
- New `capture/ContextCapture.kt`: proximity + light (SensorManager), headphones (AudioManager),
  battery %, charging, hour, session length.
- Heart-rate source priority in `tick()`: BLE (conf 0.95) > live calm reading (0.85) > calm reading
  < 10 min old (0.8 → 0.2, z only) > face rPPG (0.5 × quality).
- `pipeline/Attribution.kt`: new `ImpressionTracker`; `markImpression` feeds it and emitted
  AffectState carries `impressionId` when the lag-aligned window overlaps (and is not dropped).
- `pipeline/BaselineStore.kt`: warm at 30 samples, no minimum days; `warmupFactor = min(1, n/200)`
  scales emitted confidence; persistence throttled to every 30 s (+ flush on stop).
- `privacy/PrivacyGate.kt`: local DP on the quantized int8 output: clip each value to ±4 around the
  previously released value (sensitivity 8 ≈ 0.25σ), Laplace scale 8/ε with ε = 1.0 per emit, daily
  ε ledger (20 000/day, resets at local midnight). Consent + kill-switch gates kept. Emits every 2 s.
- `privacy/ConsentManager.kt`: tiers `motion | touch | face | ppg | ble`. `affectConsent` = any of
  face/ppg/ble OR (motion AND touch). Persisted `hasChosen`; `nonBiometricFeed` false until the user
  picks "Not now". `setTiers` (exact set), `grant`, `revoke`, `chooseNonBiometric`.
- `ExpoVoidSensingModule.kt`: registers everything below; face capture only while
  `running && feedVisible && foreground && consented(face) && CAMERA granted && no calm reading`;
  stops on `OnActivityEntersBackground`. Logs `VoidSensing` tag (`adb logcat -s VoidSensing`).
- `capture/MotionCapture.kt`: `start()` is idempotent.

Runtime permissions: native code only **checks** (ContextCompat.checkSelfPermission). The prompts are
shown from JS via React Native `PermissionsAndroid` inside `index.ts` (`requestConsent`,
`startCalmReading`, `scanHeartRateDevices`, `connectHeartRate`). The Expo `appContext.permissions`
API was not used because its exact Kotlin signature in 1.12 could not be verified offline.

### JS (index.ts) + app (B4)
- `index.ts`: types `SensorTier`, `ConsentState` (+`hasChosen`), `AffectState` (+`impressionId?`),
  `CalmReading`, `BleDevice`, `BleStatus`, `ContextState`, `TouchSample`. Functions: `requestConsent`,
  `revokeConsent`, `chooseNonBiometric`, `getConsent`, `setKillSwitch`, `isKillSwitchEnabled`, `start`,
  `stop`, `getAffectState`, `markImpression`, `recordTouch`, `startCalmReading`, `stopCalmReading`,
  `scanHeartRateDevices`, `connectHeartRate`, `disconnectHeartRate`, `setFeedVisible`, `getContext`,
  `ensurePermissions`, listeners `addAffectListener`, `addCalmReadingListener`, `addBleDeviceListener`,
  `addBleStatusListener`. The no-op stub has every native function; functions missing from an older
  native build (e.g. iOS before B3 lands) fall back safely.
- `src/ConsentScreen.tsx`: rewritten. Toggles: "How you hold and scroll" (motion+touch, default on),
  front camera face/pulse estimate, fingertip calm reading, Bluetooth strap. Plain copy: on-device,
  never stored/sent, only rounded noise-added scores reach the feed, not for ads, estimate not a
  medical device, how to turn off. Buttons: "Turn on body signals" / "Not now".
- `App.tsx`: consent overlay on first launch until `hasChosen` (and on `openConsent`), rendered over
  the WebView so reopening it does not reload the feed. Starts the pipeline while
  `affectConsent && killSwitchEnabled`. `setFeedVisible(false)` whenever AppState leaves `active`.

## WebView message contract

Web → native: `window.ReactNativeWebView.postMessage(JSON.stringify(msg))`
(the page also gets `window.__voidPost(msg)` injected before load, and `window.__VOID_NATIVE__ = true`).

| `msg` | Effect | Reply |
|---|---|---|
| `{type:'impression', impressionId, itemId}` | Marks the primary visible post (unchanged) | — |
| `{type:'getAffect'}` | — | `__VOID_AFFECT__(AffectState \| null)` |
| `{type:'getConsent'}` | — | `__VOID_CONSENT__(ConsentPayload)` |
| `{type:'setKillSwitch', on:boolean}` | `on:true` = body signals allowed, `on:false` = stop all capture and emits (persisted) | `__VOID_CONSENT__(ConsentPayload)` |
| `{type:'startCalmReading'}` | Asks camera permission, starts 30 s fingertip reading (needs `ppg` tier) | stream of `__VOID_CALM__(CalmReading)` |
| `{type:'stopCalmReading'}` | Aborts the reading | `__VOID_CALM__({done:true, bpm:null, …, error:'stopped'})` |
| `{type:'recordTouch', samples:[{x,y,t,phase,pressure?}]}` | Touch kinematics, batched ~1/s. `x`,`y` normalized 0..1 to the viewport, `t` ms (`performance.now()`), `phase` `'start'\|'move'\|'end'`. Max 300 per batch; only positions, never content | — |
| `{type:'feedVisible', visible:boolean}` | Front-camera face sensing runs only while `true` (and consented, app foreground) | — |
| `{type:'bleScan'}` | Asks Bluetooth permission, scans 15 s for 0x180D devices (needs `ble` tier) | `__VOID_BLE__` device + status events |
| `{type:'bleConnect', id}` | Connects to a scanned device id | `__VOID_BLE__` status events |
| `{type:'bleDisconnect'}` | Disconnects the strap | `__VOID_BLE__({type:'status', status:'disconnected', …})` |
| `{type:'openConsent'}` | Shows the native consent screen over the feed | `__VOID_CONSENT__(ConsentPayload)` when the user chooses |

Native → web: `window.<hook> && window.<hook>(json)` via `injectJavaScript`.

| Hook | Payload |
|---|---|
| `window.__VOID_AFFECT__(s)` | `{valenceZ, arousalZ, attentionZ, confidence, sourceMask, windowEndMs, dpApplied, impressionId?}` — int8 z-scores (÷32 ≈ σ, range ±4σ), confidence 0..100, sourceMask bits 1=camera PPG (fingertip or face rPPG), 2=face, 4=motion, 8=touch, 16=BLE strap. Pushed every ~2 s while sensing runs; `null` only as a reply to `getAffect` when nothing is available |
| `window.__VOID_CONSENT__(c)` | `{affectConsent, perTier:{motion,touch,face,ppg,ble}, nonBiometricFeed, hasChosen, killSwitchEnabled, native}` — `native:false` means the build has no sensing module (show "not available") |
| `window.__VOID_CALM__(r)` | `{bpm:number\|null, hrv:number\|null, progress:0..1, done:boolean, quality:0..1, error?:string}`. ~1 event/s; last one has `done:true`. `error` values include `'calm reading not enabled'`, `'camera permission not granted'`, `'camera permission denied'`, `'body signals are switched off'`, `'stopped'`, `'interrupted'`, `'calm reading unavailable'` |
| `window.__VOID_BLE__(e)` | `{type:'device', id, name:string\|null, rssi}` or `{type:'status', status:'scanning'\|'scanDone'\|'connecting'\|'connected'\|'disconnected'\|'error', id:string\|null, message:string\|null}` — never contains heart-rate values |

## Compile risks I could not verify (check these first in the EAS log)

1. **expo-modules-core 1.12 Kotlin API**: `Module.sendEvent(String, Map<String, Any?>)` overload;
   `appContext.currentActivity`; `OnActivityEntersBackground` / `OnActivityEntersForeground` DSL;
   `Function(...)` taking `List<TouchSampleRecord>` (Record in a List); returning `Map<String, Any?>`
   (with null values) and `Map?` from sync `Function`s; zero-arg `AsyncFunction("start") { … }`.
2. **ExpoModulesCorePlugin.gradle** in SDK 51 exposing `applyKotlinExpoModulesCorePlugin()`,
   `useCoreDependencies()`, `useExpoPublishing()` (same as the SDK 51 module template), and applying
   `kotlin-android` twice being harmless.
3. **`@androidx.annotation.OptIn(markerClass = [ExperimentalGetImage::class])`** in FaceCapture — named
   array form should work for both the Java and Kotlin versions of the annotation; if not, delete the
   annotation (it is lint-only).
4. **CameraX 1.3.4**: `ResolutionSelector` / `ResolutionStrategy(Size, FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)`
   and `ImageAnalysis.Builder.setResolutionSelector`; `ProcessCameraProvider.unbind(useCase)`.
5. **ML Kit**: `Task.addOnCompleteListener(Executor, listener)`; `Face.leftEyeOpenProbability` etc.
   being `Float?`; `FaceDetector.close()`.
6. **Bluetooth on compileSdk 34**: overriding both `onCharacteristicChanged` variants (one deprecated)
   and calling `BluetoothGatt.writeDescriptor(desc, ByteArray)` (API 33) / deprecated
   `BluetoothGattDescriptor.setValue` + `writeDescriptor(desc)` behind an SDK check. Kotlin nullability
   of the override parameters (`@NonNull` in API 33+) was assumed non-null.
7. **`synchronized` returning a value** (`fun f(): T = synchronized(lock) { … }`) and non-local
   `return` from inside `synchronized` in Unit functions — standard, but used widely.
8. **Manifest merge**: app manifest (from app.json + plugin) and module manifest both declare
   BLUETOOTH_SCAN; the plugin sets `usesPermissionFlags` on the app entry to avoid a merge conflict.
9. **`expo-build-properties ~0.12.0`** version for SDK 51 (not installed locally; `npx expo install
   expo-build-properties` will correct the range if needed).
10. TypeScript was not type-checked (`tsc` not installed): `PermissionsAndroid.requestMultiple`
    typing in `index.ts`, and `App.tsx` / `ConsentScreen.tsx` changes.

Behavioural (not compile) caveats: BLE scanning on Android ≤ 11 needs location permission, which the
app deliberately does not request, so scans may find nothing there. The heuristic estimator is not a
validated model. rPPG from a phone front camera is noisy; its confidence is kept low.

## Compile logs

_(paste the EAS / Gradle output here)_
