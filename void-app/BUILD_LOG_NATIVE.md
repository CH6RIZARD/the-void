# Native React Native build log (Expo SDK 57)

The WebView shell (App.tsx loading `assets/void.html`) is gone. `void2-final.html` is
still the design source of truth, but the app is now native React Native with
expo-router. This log records every real EAS cloud build of the native app, with
the actual errors and the fixes.

## Toolchain (resolved from expo@57.0.23 `bundledNativeModules.json`)

| Package | Version | Why |
|---|---|---|
| expo | ~57.0.23 | SDK 57 |
| react / react-native | 19.2.3 / 0.86.3 | SDK 57 pins (RN 0.86, not 0.85) |
| expo-router | ~57.0.21 | file routes in `app/` |
| react-native-screens | ~4.26.0 | router peer |
| react-native-safe-area-context | ~5.7.0 | router peer |
| react-native-gesture-handler | ~2.32.0 | sheets, globe gestures |
| react-native-reanimated / react-native-worklets | 4.5.1 / 0.10.1 | loaders, nav, sheet |
| expo-font | ~57.0.4 | Syne / Syne Mono / DM Serif Display |
| expo-image | ~57.0.5 | `<VoidImage>` |
| expo-video | ~57.0.4 | HLS tiles, reels |
| expo-gl + three | ~57.0.2 + ^0.186.0 | globe (Agent C) |
| @supabase/supabase-js | ^2.116.0 | backend |
| react-native-url-polyfill | ^3.0.0 | URL/URLSearchParams for supabase-js |
| @react-native-async-storage/async-storage | 2.2.0 | session + theme persistence |
| expo-haptics | ~57.0.3 | |
| expo-sharing | ~57.0.20 | |
| expo-web-browser | ~57.0.3 | OAuth (never an embedded WebView) |
| expo-apple-authentication | ~57.0.2 | native Sign in with Apple |
| expo-crypto | ~57.0.3 | Apple nonce |
| expo-image-picker | ~57.0.18 | composer media |
| expo-audio | ~57.0.5 | voice notes |
| expo-blur | ~57.0.3 | nav pill (iOS) |
| expo-linear-gradient | ~57.0.2 | gold pill, highlight card |
| react-native-svg | 15.15.4 | icons, radial backdrop |
| expo-camera | ~57.0.5 | sensing module |
| react-native-webview | 13.16.1 | ONLY YouTube player tiles |
| expo-splash-screen / expo-status-bar / expo-system-ui / expo-linking / expo-constants | SDK 57 | root shell |
| expo-build-properties | ~57.0.18 | compile/target SDK 36, iOS 16.4 |
| expo-dev-client | ~57.0.19 | `development` profile |

- Android: compileSdk 36, **targetSdk 36** (Play requirement from Aug 2026), minSdk 24.
- iOS: deploymentTarget **16.4** (SDK 57 minimum: ExpoModulesCore.podspec `:ios => '16.4'`).
- `package-lock.json` deleted so EAS resolves fresh.

## Pre-flight (no local node_modules; the dev box has ~1.2 GB free)

- The config is read locally by eas-cli without plugins (`app.config.js` drops them when
  `expo/config-plugins` cannot resolve and `EAS_BUILD` is unset); the worker applies them.
- Import graph check (scratch script, Metro-style resolution from `app/**`): every relative
  import resolves and every bare import is a declared dependency.
- The sensing module (`modules/expo-void-sensing`) already compiled on SDK 57 in the earlier
  WebView build `e5584c37` (log shows `:expo-void-sensing:*` Gradle tasks, BUILD SUCCESSFUL).

## Builds

<!-- entries appended below -->

### Build 1 — `d9e82184-9c54-4c70-8fe9-d116cea63ac8` — FINISHED (preview APK)
- Scope: the full SDK 57 native dependency set, expo-router shell, theme, ui primitives,
  loaders, nav, supabase/auth, sensing provider. The globe tab and AudioOwnerProvider were
  stubbed for this build only, because `src/core` had no index files yet (C's
  `features/live/core.ts` imports them).
- Result: `BUILD SUCCESSFUL in 19m 41s`. `:app:createBundleReleaseJsAndAssets` (Metro +
  Hermes) passed. `:expo-void-sensing:compileReleaseKotlin` passed.
- APK: https://expo.dev/artifacts/eas/PITmjAMV7ycHXr7_uEonxByG_UDviFx6FdpQ1iJK56k.apk
- Warnings only (no errors): Kotlin deprecations in react-native-webview and expo-modules-core.
- `expo doctor` (non-fatal) flagged 3 issues. Fixed for build 2:
  1. `expo-modules-core` was a direct dependency. Removed it; the sensing module now imports
     `requireNativeModule` from `expo` (the type-only `EventSubscription` import is erased).
  2. `app.config.js` ignored `app.json`. It now uses the function form `({ config }) => ...`.
  3. No lock file. Not fixable without a local install. EAS installs fresh with yarn 1 (node 22).

### Build 2 — `8a9ccc4a-937c-42fc-8d0a-a6f6b92fe425` — FINISHED (preview APK)
- Scope: build 1 + B's `src/core` (the `.ts`-extension imports resolve in Metro), C's globe +
  live wall, the real `AudioOwnerProvider`, core boot (`src/lib/core.ts`), and the nation,
  search and reels routes. C's `features/live/core.ts` now imports `src/core/index.ts`.
- Result: `BUILD SUCCESSFUL in 13m 24s`. Hermes compiled the core's `\p{L}` regexes and
  `String.prototype.normalize` usage. `expo doctor` now fails only "no lock file".
- APK: https://expo.dev/artifacts/eas/BfVwJwjOdWW7V1b9cNUSsny6xrCKuqEJRYAE7NROldA.apk

### Build 3 — `9fbbb849-7a34-4ad1-80c5-082d03844183` — FINISHED (preview APK)
- Scope: every feature routed: feed (`(tabs)/void`), thread (transparent modal), messages +
  `/messages/[id]`, profile + `/u/[handle]`, settings, `/blocked`, composer, sign-in,
  nation, search, reels, globe. Added `expo-image-manipulator ~57.0.18`. The tabs layout
  starts `startDmBadgePoll()`. `<ModerationHost/>` is mounted at route level for search and nation.
- Auth integration change: the auth agent's `features/auth/coreBridge.ts` makes supabase-js the
  single token refresher and mirrors sessions into the core's VoidAuth. `src/lib/supabase.ts` is
  that client (AsyncStorage persistence, autoRefresh while foreground). `src/lib/core.ts`
  configures the core, sets `__VOID_CORE_CONFIGURED__`, awaits `ensureCore()` (capped at 3 s so
  the splash is never held on the network), then `initAuth()`. A first launch runs
  `continueAnonymously()`, which uses DB-valid `void_xxxxxx` handles. `src/lib/auth.tsx` is now
  state only (`useAuth`).
- Result: `BUILD SUCCESSFUL in 13m 45s`.
- APK: https://expo.dev/artifacts/eas/Ep549tnM0cgtV49vtJqkAfSP0tIp54IgtRrDx-YV1Co.apk

### Build 4 — `71c0b5ce-2d91-42d7-b3ee-7d47a8e3abbe` — FINISHED (preview APK, current)
- Scope: build 3 + NationScreen's FlatList now uses `viewabilityConfigCallbackPairs`, combining
  `usePostViewability('nation')` with the nation feed's own callback (RN rejects
  `onViewableItemsChanged` together with callback pairs).
- Result: `BUILD SUCCESSFUL in 13m 35s`.
- APK: https://expo.dev/artifacts/eas/FyICXkuUbnD67VjHDhscpH7aADVEDdc68W5ev6xzyeI.apk

## Open items (not compile errors)
- No `tsc` run anywhere (no node_modules on the dev box). Metro/Babel strip types, so type errors
  do not fail these builds. Run `npm run typecheck` on a machine with dependencies installed.
- Nothing has been run on a device yet. Runtime behaviour (three.js on expo-gl, YouTube
  WebViews, auth bridge) is unverified.
- No lock file (expo doctor warning).
- The search screen renders `SearchPostCard`, not `PostCard`, so it does not use `usePostViewability`.
- There is no `/photo` viewer route: image taps fall back to the thread (feed README).
- iOS was not built (no Apple account). The config is set: deploymentTarget 16.4, usesAppleSignIn, privacy manifest.
