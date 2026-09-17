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

Native React Native app (Expo SDK 57, RN 0.86, expo-router). It is a port of the
single-file web app `../void2-final.html`, which stays the design and behaviour source of
truth. There is no WebView shell any more. `react-native-webview` is used ONLY for YouTube
player tiles. On-device body signals come from the `expo-void-sensing` local module.
Built with **EAS cloud builds**. No local Mac or node_modules is required.

## Architecture

```
app/                         expo-router routes
  _layout.tsx                fonts + theme gate, providers, modal stack
  (tabs)/_layout.tsx         5 tabs + custom floating pill tab bar (src/nav/BottomNav)
  (tabs)/void|globe|search|messages|profile.tsx
  nation/[iso].tsx  thread/[id].tsx  reels.tsx  composer.tsx  settings.tsx  sign-in.tsx
  auth-callback.tsx          thevoid://auth-callback (OAuth PKCE return)
src/theme/                   tokens.ts: VOID / DARK / LIGHT CSS variables, ThemeProvider (void_theme)
src/ui/                      VText, Card, Backdrop, Pill, Sheet, Toast, Icon (VICON set),
                             SparkleLoader + ImageOrbitLoader (hard-locked), VoidImage
src/nav/                     BottomNav, route constants, nav geometry, DM badge store
src/lib/                     supabase client, auth (anonymous-first), storage, sensing provider
src/core/                    pure logic ported from the web (Agent B)
src/features/                globe, live wall, and further screens
modules/expo-void-sensing    CameraX + ML Kit face / rPPG / fingertip PPG / BLE HR; emits only quantized AffectState
```
Build history and fixes: `BUILD_LOG_NATIVE.md`. Sensing module: `BUILD_LOG_SENSING.md`.

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
eas build -p android --profile preview     # → installable .apk

eas submit -p ios --latest             # App Store Connect (needs eas.json ios block)
eas submit -p android --latest         # Play internal track
# Samsung: download the AAB from the EAS build page → upload in Seller Portal.
```

Dev loop: `eas build -p ios|android --profile development` (dev client), then `npm start`.

## Status
See `BUILD_LOG_NATIVE.md`.
