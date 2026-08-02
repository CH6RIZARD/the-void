# The Void — mobile app (Expo, iOS + Android/Samsung)

## Content proxy

The real-content feed needs a reachable `void-proxy` deployment. Set its public
HTTPS URL before starting or building the app:

```powershell
$env:VOID_PROXY_BASE = 'https://your-void-proxy.example'
npm start
```

For EAS builds, define `VOID_PROXY_BASE` in the build environment. `localhost`
does not work on a physical phone because it points at the phone, not the
computer running the proxy.

A native shell that ships the existing Void web UI **unchanged** (loaded in a WebView)
plus an on-device biometric affect pipeline exposed through the `expo-void-sensing`
native module. Built for **EAS cloud builds** — no local Mac required.

## Architecture

```
App.tsx ── WebView(assets/void.html)         ← existing UI, zero rework
   │  bridge (postMessage / injectJavaScript)
   ▼
expo-void-sensing (native module)            ← the ONLY JS↔native boundary
   ├─ ios/     vendors void-rank/ios/VoidSensing (Swift: CoreMotion/ARKit/HealthKit/CoreML)
   └─ android/ Kotlin: SensorManager / CameraX PPG / Health Connect / TFLite
   emits ONLY quantized AffectState (int8 z-scores) — raw sensor data never crosses.
```
Contract: `modules/expo-void-sensing/index.ts`. Invariants: repo `void-rank/CLAUDE.md`.

> Canonical sensing package = **`void-rank/ios/VoidSensing`** (the V3-plan Epic-1
> package the iOS adapter compiles against, per the podspec). The older
> `The Void/VoidSignalRanker` package is superseded — do not wire the app to it.

## Prerequisites you must provide (cannot be automated)

| Gate | What you do |
|---|---|
| Expo/EAS | `npm i -g eas-cli && eas login`; set `extra.eas.projectId` in `app.json` (`eas init`) |
| Apple | Apple Developer Program ($99/yr); fill `submit.production.ios` in `eas.json` |
| Google Play | Play Console ($25); Play service-account JSON → `eas.json` |
| Samsung | Samsung Seller Portal account; upload the **same Android AAB** manually (no eas target) |
| **Legal [HUMAN GATE]** | Lawyer sign-off on the consent copy in `src/ConsentScreen.tsx` (BIPA/GDPR Art.9/EU AI Act/Apple 5.1.3) **before** submitting |
| **Affect model** | The Core ML/TFLite affect model is untrained — `getAffectState()` returns `null` (cold-start) until trained on data (federated, post-launch). The app ships and personalizes on behavioral signals until then. |

## Build & submit

```bash
npm install
npm run typecheck                      # verifies the TS spine

eas init                               # once — creates the EAS project id
eas build -p ios --profile production      # → .ipa (cloud, no Mac)
eas build -p android --profile production  # → .aab (Play + Samsung)

eas submit -p ios --latest             # App Store Connect (needs eas.json ios block)
eas submit -p android --latest         # Play internal track
# Samsung: download the AAB from the EAS build page → upload in Seller Portal.
```

Dev loop: `eas build -p ios|android --profile development` (dev client), then `npm start`.

## Status
- Spine (this scaffold): app/EAS/module config, JS↔native contract, WebView bridge,
  consent flow — authored & TS-checkable here.
- `modules/expo-void-sensing/ios` + `/android`: native bodies (wrap the Swift / Kotlin
  stack). Authored without a device toolchain → **compile in Xcode / Android Studio /
  EAS**; expect minor first-build fixes.
- Apple 4.2 note: the live-video + affect features (not a bare webview) are what carry
  it past minimum-functionality review.
