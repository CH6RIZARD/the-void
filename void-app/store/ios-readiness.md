# iOS App Store readiness: The Void

Status as of 2026-09-16. There is no Apple Developer account yet, so nothing here has been built or submitted.
Scope: `void-app/` (Expo WebView shell + local module `modules/expo-void-sensing`), and the web UI it loads (`void2-final.html`, copied to `assets/void.html` by `scripts/sync-ui.js`, or loaded remotely from `VOID_HTML_URL`).

> **Ownership.** `app.json`, `app.config.js`, `eas.json`, `package.json` and `modules/` belong to the SDK 57 upgrade. Nothing in this doc has been applied to them. Every snippet below is for the coordinator to merge. `App.tsx`, `src/` and `void2-final.html` changes are also listed for the coordinator.

---

## 0. Blockers ranked by rejection risk

| # | Risk | Guideline | What is wrong (evidence) | Fix |
|---|------|-----------|---------------------------|-----|
| 1 | **Certain** | 5.1.1(v) | No way to delete an account in the app. Settings only has SIGN OUT (`void2-final.html` ~l.1497). Anonymous sign-in also creates a real Supabase user (`signInAnon`, ~l.3800). | §4 item 1 |
| 2 | **Certain** | 1.2 | UGC (posts, replies, bios, follows go to Supabase `/rest/v1/posts`, `profiles`, `follows`) with no way to report, no way to block users, no terms acceptance and no contact info. The only filter is a local keyword mute (`voidMute`, ~l.2652). | §4 item 2 |
| 3 | **Certain** | 5.1.1(i) / App Store Connect | No privacy policy or terms anywhere in the app or HTML. App Store Connect needs a privacy policy URL, and the app should link to it too. | §4 item 3 |
| 4 | **High** | 2.1 / 4.8 | Google sign-in runs a Supabase `/auth/v1/authorize` redirect *inside WKWebView* (`oauthUrl`, ~l.3618). Google blocks embedded webviews (`403 disallowed_useragent`), so the GOOGLE button will fail in review. The APPLE button uses the same web redirect. It satisfies 4.8 on paper, but it is fragile and the redirect goes to `file://…` when the bundled fallback is loaded. | §1.6 + §4 item 4 |
| 5 | **High** | 5.2.3 / 5.2.2 + YouTube API ToS | Hides YouTube's player chrome on purpose (veil, ~l.4626-4745) and plays audio from an **invisible second "shadow" player** (~l.4653, 4745). Also plays many third-party live TV HLS streams (~l.2089). | §2.6 |
| 6 | **High** | 2.1 completeness | DMs are labelled `DEMO MESSAGES`/`MOCK · NOT ENCRYPTED` (~l.8553, 8599). Composer media is "local-only for now" (~l.8403). Reviewers reject demo or placeholder features. | §2.8 |
| 7 | **Medium** | 4.2 | Mostly a WebView wrapper. The native value is all opt-in, so a reviewer who declines consent only sees web content. | §2.4 |
| 8 | **Medium** | 5.1.2(vi) / 1.4.1 | The front camera derives attention/expression that is used to rank the feed, and there is a camera pulse estimate. Apple limits using camera/face data for "use-based data mining", and it looks hard at health measurements made with device sensors. | §2.5 |
| 9 | **Medium** | 2.1 | `NSMicrophoneUsageDescription` is missing, so voice recording in the composer (`getUserMedia({audio:true})`, ~l.8299) fails. It can also crash on some iOS versions when the plist key is missing. | §1.3 |
| 10 | **Low-Med** | 2.5.2 / 5.1.1 | The UI can be swapped remotely (`VOID_HTML_URL`, App.tsx). This is allowed for web content. But a remote change must not add features, data collection or purchases that would make the reviewed build, privacy label or privacy manifest untrue. | Process rule, §2.9 |
| 11 | **Low** | 2.3.7 / name | "The Void" may already be taken as an App Store name, and `com.thevoid.app` may already be registered by someone else. Neither can be checked without an account. | §1.1 |

---

## 1. app.json for App Store review (Expo SDK 57)

Merge these into `expo` in `app.json`. The existing keys (`scheme`, `bundleIdentifier`, camera and Bluetooth strings, `ITSAppUsesNonExemptEncryption`) are already correct and are kept.

### 1.1 Identity, version, build number

```json
{
  "expo": {
    "name": "The Void",
    "scheme": "thevoid",
    "version": "1.0.0",
    "ios": {
      "bundleIdentifier": "com.thevoid.app",
      "supportsTablet": false
    }
  }
}
```

- **bundleIdentifier `com.thevoid.app`**: nothing else in the repo uses it except Android `package` (same string, which is fine and normal). Uniqueness across Apple can only be checked when you register the App ID. If Apple says it is taken, use `com.<yourteamhandle>.thevoid`. Change it before the first build: it cannot be renamed after an App Store Connect record exists. Keep Android's `package` separate so Play is not affected.
- **Do not set `ios.buildNumber`.** `eas.json` already has `cli.appVersionSource: "remote"` and `build.production.autoIncrement: true`, so EAS stores and increments the build number on its servers. A `buildNumber` in app.json would be ignored and cause confusion. The first remote value is set on the first build; to seed it, run `eas build:version:set -p ios`.
- **`version`**: 0.1.0 is accepted, but a first public release is normally `1.0.0`. Bump it by hand for each store release. The build number is automatic.
- **`supportsTablet: false`: keep it.** The UI is a portrait phone layout (`orientation: portrait`) and there are no iPad screenshots. Note that iPhone-only apps still run on iPad in compatibility mode and reviewers sometimes test there, so check that the app launches and is usable on an iPad simulator.

### 1.2 Deployment target
`expo-build-properties` currently pins `ios.deploymentTarget: "15.1"`, and the podspec says `:ios => '15.1'`. **SDK 57's minimum iOS is higher than 15.1.** Set both to the minimum in SDK 57's release notes, or remove the pin and use the SDK default. A pin below the SDK minimum breaks pod install. Also: since April 2026 App Store uploads must be built with the iOS 26 SDK / Xcode 26. EAS's default image for SDK 57 meets this, so don't pin an older `image` in eas.json.

### 1.3 Info.plist usage strings (only for capabilities actually used)

| Key | Used by | Needed? |
|---|---|---|
| `NSCameraUsageDescription` | module front camera (Vision/rPPG), rear fingertip PPG; also the "Take Photo" option in the WebView file picker | Yes (present) |
| `NSBluetoothAlwaysUsageDescription` | `BleHeartRate.swift` (CBCentralManager, created lazily only when pairing) | Yes (present) |
| `NSMicrophoneUsageDescription` | web composer voice notes, `getUserMedia({audio:true})` in WKWebView | **Yes (missing)** |
| `NSPhotoLibraryUsageDescription` | `<input type=file accept="image/*,video/*">` (composer, thread). WKWebView uses PHPicker, which does not strictly need this, but some iOS paths and reviewers expect it. Harmless. | Add |
| `NSPhotoLibraryAddUsageDescription` | nothing saves to Photos | No |
| `NSMotionUsageDescription` | `MotionCapture.swift` uses raw `deviceMotion` only, not CMMotionActivity | No |
| `NSLocationWhenInUseUsageDescription` | no geolocation API used | No |
| HealthKit keys | not used; the plugin deletes them | No |
| `NSLocalNetworkUsageDescription` | only dev-client builds (added automatically) | No for production |
| `UIBackgroundModes` | **none**: no background audio, no BLE background | Do not add |

```json
"ios": {
  "infoPlist": {
    "NSCameraUsageDescription": "Only if you turn on body signals: the front camera estimates attention, expression and pulse on your device while the feed is open, and the rear camera with the flash takes an optional 30-second fingertip calm reading. Frames are processed in memory, never stored or uploaded. This is an estimate, not a medical device. The camera is also used if you choose to take a photo for a post.",
    "NSBluetoothAlwaysUsageDescription": "Only if you choose to pair one: The Void connects to a Bluetooth heart-rate strap or watch to read heart rate on your device. Readings never leave your phone.",
    "NSMicrophoneUsageDescription": "Only when you tap record in the composer: The Void records a voice note to attach to your post. Nothing is recorded at any other time.",
    "NSPhotoLibraryUsageDescription": "Only when you choose to attach one: pick photos or videos from your library to add to a post or reply. The Void does not browse your library.",
    "ITSAppUsesNonExemptEncryption": false
  }
}
```

The camera string gets an extra sentence about photos because the WebView file picker can open the camera. Also add the same sentence to `CAMERA_COPY` in `modules/expo-void-sensing/app.plugin.js`. Because it uses `||=`, app.json wins, but keep them in sync.

**Also check (coordinator):** `android.blockedPermissions` contains `RECORD_AUDIO`, so voice notes are broken on Android too. Either remove it from the blocked list and add a mic permission, or hide the record button in native builds.

**WebView prop (App.tsx):** add `mediaCapturePermissionGrantType="prompt"` to the `<WebView>` (react-native-webview ≥13.x, iOS 15+) so that WKWebView media-capture prompts behave predictably.

### 1.4 ITSAppUsesNonExemptEncryption
`false` is correct. The app uses only HTTPS/TLS from the OS and Apple's Keychain/CryptoKit for local data protection (`VoidKeychain.swift`, `BaselineStore.swift`). Both are exempt. It is already set in app.json and in the plugin. With this key, App Store Connect skips the export-compliance question on every build.

### 1.5 Privacy manifest (`ios.privacyManifests`)

Required-reason APIs found:

| Category | Reason | Source |
|---|---|---|
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` (app's own defaults) | React Native core, Expo modules; **module**: `BleHeartRate.swift` l.82/97/102, `PrivacyGate.swift` l.21-55, `VoidKeychain.swift` l.56 |
| `NSPrivacyAccessedAPICategorySystemBootTime` | `35F9.1` (measure elapsed time) | React Native core; **module**: `MotionCapture.swift` l.101 `ProcessInfo.processInfo.systemUptime` |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `C617.1` (timestamps of files in app container) | React Native core / expo-asset / expo-file-system. The module itself reads no file timestamps. |
| `NSPrivacyAccessedAPICategoryDiskSpace` | `E174.1` (check space before writing) | Expo / RN dependencies (expo-file-system, asset caching). The module does not query disk space. |

The module uses no `activeInputModes` (keyboards) and no other required-reason API. Keychain, CoreBluetooth, AVFoundation and Vision are not required-reason APIs. Most pods (RN, Expo, react-native-webview) ship their own `PrivacyInfo.xcprivacy`, but the app-level manifest must still list what the app's own code uses. Declaring the union is the safe choice.

**Collected data** ("collected" = sent off the device). Derived from the code:
- Supabase auth: email (only for email sign-up), user ID (all users, including anonymous).
- Profile: handle, display name, bio (`profiles`).
- Posts, replies, reactions, follows (`posts`, `reactions`, `follows`).
- **Not collected:** camera frames, affect state, pulse/HRV, BLE heart rate, motion, touch kinematics. All of it stays on the device (`__VOID_AFFECT__` only sets a JS variable used for local ranking, and the module has no networking). Feed seen-sets and the interest model are in localStorage only. Composer media is not uploaded yet (~l.8403). Once it is, add `NSPrivacyCollectedDataTypePhotosorVideos` and `NSPrivacyCollectedDataTypeAudioData`.
- Voice notes: not uploaded today. Add `AudioData` when they are.

```json
"ios": {
  "privacyManifests": {
    "NSPrivacyTracking": false,
    "NSPrivacyTrackingDomains": [],
    "NSPrivacyAccessedAPITypes": [
      { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults",  "NSPrivacyAccessedAPITypeReasons": ["CA92.1"] },
      { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategorySystemBootTime", "NSPrivacyAccessedAPITypeReasons": ["35F9.1"] },
      { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryFileTimestamp",  "NSPrivacyAccessedAPITypeReasons": ["C617.1"] },
      { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryDiskSpace",      "NSPrivacyAccessedAPITypeReasons": ["E174.1"] }
    ],
    "NSPrivacyCollectedDataTypes": [
      { "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeEmailAddress",     "NSPrivacyCollectedDataTypeLinked": true, "NSPrivacyCollectedDataTypeTracking": false, "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
      { "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeName",             "NSPrivacyCollectedDataTypeLinked": true, "NSPrivacyCollectedDataTypeTracking": false, "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
      { "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeUserID",           "NSPrivacyCollectedDataTypeLinked": true, "NSPrivacyCollectedDataTypeTracking": false, "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] },
      { "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeOtherUserContent", "NSPrivacyCollectedDataTypeLinked": true, "NSPrivacyCollectedDataTypeTracking": false, "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] }
    ]
  }
}
```

`Name` is included because the sign-in screen asks for a display name (`si-name`), which may be a real name. Keep it out only if that field is explicitly just a pseudonym.

### 1.6 URL scheme, OAuth redirect, Sign in with Apple entitlement

- `"scheme": "thevoid"` is already set, so `thevoid://` works after prebuild. No `CFBundleURLTypes` edit is needed.
- **Associated domains are not needed** for OAuth with a custom scheme. Add them only if you want universal links (`https://<your-domain>/…` opening the app), and then only once the domain serves `apple-app-site-association`:
  ```json
  "ios": { "associatedDomains": ["applinks:YOUR-DOMAIN"] }
  ```
- **Sign in with Apple entitlement** (needed for native Apple sign-in, see §4 item 4):
  ```json
  "ios": { "usesAppleSignIn": true }
  ```
  and add the plugin `"expo-apple-authentication"` (+ dependency `expo-apple-authentication` and `expo-web-browser`, versions matching SDK 57 via `npx expo install`).
- **Supabase dashboard** → Authentication → URL Configuration → Redirect URLs: add `thevoid://auth-callback`. Providers → Apple: set the Services ID / bundle id `com.thevoid.app` as an authorized client ID (needed for native `id_token` sign-in).

---

## 2. App Review Guideline risks and mitigations

### 2.1 4.8 Sign in with Apple
- **Status:** an APPLE button exists (`oauthSignIn('apple')`, ~l.1293) next to GOOGLE, and anonymous sign-in exists. That meets the rule on paper.
- **Problem:** both run as a full-page redirect *inside the WKWebView*. Google refuses embedded webviews, so the Google button is broken (rejected under 2.1). The Apple web flow in a WebView works poorly, and when the bundled `file://` fallback is loaded, `redirect_to` is a file URL that Supabase will reject.
- **Mitigation:** in native builds, route OAuth through native code (§4 item 4): Apple uses `expo-apple-authentication` (native sheet), then Supabase `grant_type=id_token`. Google uses `expo-web-browser` `openAuthSessionAsync` (ASWebAuthenticationSession) with `redirect_to=thevoid://auth-callback`. Show the Apple button at least as prominently as Google (same size, placed first).

### 2.2 5.1.1(v) Account deletion
- **Status:** missing. Only SIGN OUT exists.
- **Mitigation:** add a "Delete account" row under Sign out in Settings. It opens a confirmation and calls a Supabase Edge Function `delete-account`, which uses the service role to delete `posts/reactions/follows/profiles` for `auth.uid()` and then `auth.admin.deleteUser`. After that, clear localStorage and sign out. It must actually delete; deactivation or "email us" is not enough. For users who signed in with Apple, also revoke the Apple token (`https://appleid.apple.com/auth/revoke`) inside that function. It must also work for anonymous accounts.

### 2.3 1.2 User-generated content
Apple requires all four: filtering, reporting with a timely response, blocking abusive users, and published contact info. Third-party aggregated content (Reddit/Bluesky/Mastodon/Lemmy/GDELT items in the feed) is treated as UGC too.
- **Status:** there is a local keyword mute and NSFW label filtering of reels (`REEL_BLOCK_LABELS`, ~l.3326). There is no report, no user block, no terms/EULA, and no contact.
- **Mitigation:**
  1. A "…" menu on every post, reply, profile and aggregated item with **Report** (inserts into a `reports` table: reporter, target type/id, reason) and **Block @user**. Block hides that author's content right away on the device and on the server (a `blocks` table plus an RLS/filter in the feed query), and also hides the item for the reporter.
  2. A server-side word filter on `posts` inserts (trigger or Edge Function), in addition to the local mute.
  3. Terms of Use with a "no tolerance for objectionable content or abusive users" clause, accepted on the sign-in screen (checkbox or "By continuing you agree…" with a link) before posting.
  4. A support/contact email in Settings and in the App Store listing. Commit to acting on reports within 24h and say so in the review notes.

### 2.4 4.2 Minimum functionality (WebView wrapper)
- **Native value that already exists:** the on-device sensing pipeline (`expo-void-sensing`: Vision face landmarks, camera rPPG, rear-camera fingertip PPG, CoreMotion, BLE Heart Rate Service, Keychain-backed consent ledger), a native consent screen (`src/ConsentScreen.tsx`), a kill switch, and an offline bundled UI fallback.
- **Weakness:** all of it is opt-in. A reviewer who taps "no" sees a web feed.
- **Add (cheap, high signal):** `expo-haptics` on reactions/pull-to-refresh via the bridge; native share sheet (`Share` from react-native) for posts; native Apple/Google auth (§4 item 4); optionally push notifications for replies (the `SETTINGS.notify` toggle already exists in the web UI, so make it real or remove it). In **App Review notes**, explain step by step how to see the native features: enable body signals, the calm reading, BLE pairing (say that no strap is needed to see the scan UI).

### 2.5 5.1.1 / 5.1.2(vi) / 1.4.1 Camera, face and pulse data
- **Rules:** health measurements made with device sensors get extra scrutiny (1.4.1). Data from camera/face mapping may not be used for "use-based data mining", marketing or ads (5.1.2(vi)).
- **Mitigation:**
  - Everywhere (consent screen, calm reading UI, store description) use wording like: "Pulse and calm readings are wellness estimates, not a medical device, and not for diagnosis or treatment." The Info.plist copy already says "estimate, not a medical device". Never say "stress detection", "heart health", "HRV diagnosis" or anything similar.
  - No HealthKit (already none; the plugin strips health keys). Do not claim HealthKit in metadata.
  - Review notes: say that affect/attention is computed and quantized on device, DP-noised, never transmitted, used only to adjust the user's own feed at their request, not used for ads/analytics, and can be turned off with the kill switch at any time. This is accurate (no networking in the module; `__VOID_AFFECT__` is local).
  - Ask for camera permission only after the user opts in on the consent screen. `SensingController.swift` l.173-177 already requests only on start.

### 2.6 5.2.2 / 5.2.3 + YouTube API Terms: embeds and hidden chrome (honest flag)
- **What the app does:** YouTube iframes with `controls`/branding minimized. A "veil" hides the frame while YouTube's title, pause glyph, progress bar and logo are visible (~l.4626-4745, 4936). Sound comes from **an invisible second YouTube player** of the same video (~l.4653, 4745). It also plays many third-party live TV HLS streams (~l.2089).
- **Why this is a real risk:** YouTube API Services Developer Policies forbid hiding, obscuring or overlaying player elements or branding, playing in a hidden player, and separating audio from video. This breaks YouTube's terms no matter what Apple says, and YouTube can revoke API access or send takedowns. Apple 5.2.3 says apps must not include the ability to separate or save audio/video from YouTube-type third-party sources without authorization, and a rights holder's complaint leads to removal. Live TV streams without redistribution rights fall under 5.2.2.
- **Mitigation (native build, recommended):** behind `window.__VOID_NATIVE__`:
  1. Remove the shadow player. Play sound from the visible player itself (tap-to-unmute through the IFrame API on the visible frame).
  2. Stop veiling YouTube's chrome. Let its title bar and logo show (at least 200×200 px, not covered).
  3. Keep only official broadcaster streams that allow embedding. Drop the scraped HLS list or limit it to streams with public embed terms.
  If the hidden-chrome UX is essential, the only compliant path is non-YouTube sources you have rights to.

### 2.7 Background audio
No `UIBackgroundModes`. Audio stops when the app is backgrounded, so there is nothing to justify. **Do not add `audio`**: background YouTube playback is a common rejection and a YouTube ToS breach. `App.tsx` already stops the camera on background.

### 2.8 "NOT ENCRYPTED" DMs label
- The label is honest and not a guideline problem by itself. Don't imply E2E anywhere else.
- **The problem is that DMs are a demo:** `DEMO MESSAGES · STORED ON THIS DEVICE · NOT ENCRYPTED`, `MOCK · NOT ENCRYPTED`. Reviewers reject placeholder or demo features (2.1). **Mitigation:** hide the Messages entry when `window.__VOID_NATIVE__`, or ship real server-backed DMs. Real DMs would need report/block (1.2) and must be added to the privacy label/manifest. Do the same for composer media, which is "local-only for now": either upload it or make it clear it is a local preview.

### 2.9 Remote UI updates (2.5.2)
Loading the UI from `VOID_HTML_URL` is allowed as web content. Rule: remote updates must not add in-app purchases or digital sales (3.1.1), new data collection that isn't in the privacy label or manifest, or features that change the app's primary purpose. The build under review must work with the same remote file that production users get.

---

## 3. Once the Apple Developer account exists

### 3.1 eas.json `submit.production.ios` (coordinator merges)
```json
"submit": {
  "production": {
    "ios": {
      "appleId": "you@example.com",
      "ascAppId": "1234567890",
      "appleTeamId": "ABCDE12345"
    }
  }
}
```
- `appleId`: the Apple Account email that owns or is admin on the developer account.
- `ascAppId`: numeric **Apple ID** of the app, found in App Store Connect → the app → App Information → General → Apple ID.
- `appleTeamId`: 10-char Team ID, found in developer.apple.com → Account → Membership details.
- Optional for CI instead of `appleId` + 2FA: an App Store Connect API key (`ascApiKeyPath`, `ascApiKeyIssuerId`, `ascApiKeyId`). Never commit the `.p8` file.

### 3.2 Steps
1. **Enrol** at developer.apple.com/programs ($99/yr). Individual enrolment is fastest; an Organization needs a D-U-N-S number and shows the company as seller. Wait for approval (hours to about 2 days).
2. **App ID:** Certificates, Identifiers & Profiles → Identifiers → + → App IDs → App → Bundle ID explicit `com.thevoid.app`. Enable the capability **Sign In with Apple**. (Associated Domains only if you use universal links; no Push unless you add push.) EAS can also create this automatically on the first build.
3. **App Store Connect record:** Apps → + → New App: iOS; name "The Void" (pick another if taken); primary language; bundle id `com.thevoid.app`; SKU `thevoid-ios`; Full Access. Copy the Apple ID into `ascAppId`.
4. **Credentials:** `npx eas-cli credentials -p ios` → log in with the Apple account → let EAS generate and manage the Distribution Certificate and App Store provisioning profile. No manual certs.
5. **Build:** `npm run build:ios` (runs sync:ui, then `eas build -p ios --profile production`; the build number auto-increments remotely).
6. **Submit:** `npm run submit:ios` (`eas submit -p ios --latest`).
7. **TestFlight internal testing:** App Store Connect → TestFlight → Internal Testing → create a group, add up to 100 team members. Builds are available once processing finishes (no beta review for internal testers). Test: sign in with Apple, Google, anonymous; delete account; report/block; camera consent + calm reading; BLE scan; voice note (mic prompt); file picker; offline launch (airplane mode → bundled UI).
8. **App Privacy label** (§3.3), **age rating** (§3.4), **screenshots** (§3.5), privacy policy URL, support URL, description, keywords, review notes with a demo account (email/password on a pre-seeded Supabase account) and the native-feature walkthrough (§2.4, §2.5).
9. Submit for review.

### 3.3 App Privacy "nutrition label" answers (App Store Connect → App Privacy)
"Do you or your third-party partners collect data from this app?" → **Yes**.

| Data type | Collected? | Linked to user | Tracking | Purposes |
|---|---|---|---|---|
| Contact Info → Email Address | Yes (email sign-up / OAuth email) | Yes | No | App Functionality |
| Contact Info → Name | Yes (display name) | Yes | No | App Functionality |
| Contact Info → Phone, Physical Address, Other | No | | | |
| Health & Fitness → Health, Fitness | **No**: processed on device only, never transmitted | | | |
| Financial Info | No | | | |
| Location → Precise / Coarse | No (client sends none). *Check the Supabase `posts` trigger: if the server infers location from IP or a client value, answer Coarse Location = Yes, linked, App Functionality.* | | | |
| Sensitive Info | No | | | |
| Contacts | No | | | |
| User Content → Emails or Text Messages | No (DMs are local demo; Yes once real DMs ship) | | | |
| User Content → Photos or Videos | No today (local-only); Yes once uploads ship | | | |
| User Content → Audio Data | No today; Yes once voice notes upload | | | |
| User Content → Customer Support | No (Yes if an in-app support form is added) | | | |
| User Content → Other User Content | Yes (posts, replies, bio, reactions, follows; reports once added) | Yes | No | App Functionality |
| Browsing History | No | | | |
| Search History | No (search is not sent to your backend; *verify*) | | | |
| Identifiers → User ID | Yes (Supabase user id) | Yes | No | App Functionality |
| Identifiers → Device ID | No | | | |
| Purchases | No | | | |
| Usage Data → Product Interaction, Advertising, Other | No (seen-set and interest model are localStorage only) | | | |
| Diagnostics → Crash, Performance, Other | No (no Sentry/analytics SDK). Yes if one is added. | | | |
| Other Data | No | | | |

Third parties: YouTube embeds and Google Translate (`translate.googleapis.com`, which receives post text the user asks to translate) run on Google's side. Apple asks about data collected by "third-party partners" integrated into your app. The conservative answer is to keep the above and describe both services in the privacy policy. If YouTube's own cookies make this uncertain, you can add Usage Data → Product Interaction (not linked, not tracking, App Functionality). **Tracking: No** for everything, so no ATT prompt is needed.

### 3.4 Age rating questionnaire (Apple's 2025+ questionnaire; result: 4+/9+/13+/16+/18+)
- In-app controls: Parental Controls **No**; Age Assurance **No**.
- Capabilities: Unrestricted Web Access **No** (the WebView loads only the app UI; *verify that outbound article links open in Safari or an in-app browser and not as free browsing; if users can navigate to any site in-app, answer Yes*). User-Generated Content **Yes**. Messaging and Chat **Yes** if DMs ship, **No** if hidden. Advertising **No**.
- Mature themes: Profanity or Crude Humor **Infrequent/Mild** (UGC and aggregated posts); Horror/Fear Themes **None**; Alcohol, Tobacco, or Drug Use or References **Infrequent/Mild**; Mature or Suggestive Themes **Infrequent/Mild**.
- Medical or wellness: Medical or Treatment Information **None**; Health or Wellness Topics **Yes** (pulse/calm estimate).
- Sexuality or nudity: Sexual Content or Nudity **None** (NSFW filtered); Graphic Sexual Content and Nudity **None**.
- Violence: Cartoon or Fantasy Violence **None**; Realistic Violence **Infrequent/Mild** (news and disaster feed; there is a `graphic` label filter); Prolonged Graphic or Sadistic Realistic Violence **None**; Guns or Other Weapons **Infrequent/Mild**.
- Chance-based: Simulated Gambling **None**; Contests **None**; Loot boxes **No**.
- Expected result: **16+**. If moderation is thin at launch, pick **18+** yourself; it reduces 1.2 scrutiny. Answer honestly: a mismatch found in review is a rejection.

### 3.5 Screenshots
- **Required:** iPhone **6.9"** display: 1320×2868 or 1290×2796 portrait (iPhone 16/17 Pro Max simulator). Apple scales these down for smaller iPhones.
- **6.5"** (1284×2778 or 1242×2688) is only required if you don't provide 6.9". Uploading both gives a better look on older Pro Max/Plus devices. 6.7" (1290×2796) shots are accepted in the 6.9" slot.
- 3 to 10 screenshots, PNG/JPEG, no alpha, no status-bar mockups showing non-Apple devices.
- No iPad screenshots (`supportsTablet: false`).
- Don't show YouTube or broadcaster logos or third-party content you don't have rights to in the screenshots. Don't show "DEMO"/"MOCK" UI. Don't show heart-rate numbers with medical framing. `store/screenshots/` already exists for these.

---

## 4. Do now, before the Apple account exists (all coordinator-owned; nothing here was edited)

1. **Account deletion:** `void2-final.html` Settings section (~l.1495, after "Sign out") + new function next to `signOut()` (~l.3806); new Supabase Edge Function `delete-account`. See §2.2.
2. **UGC safety:** `void2-final.html` post/reply/profile renderers: a "…" menu with Report/Block; `VoidAPI` (~l.1700-1760) gets `report()` and `block()`; feed queries exclude blocked authors; Supabase migrations for `reports` and `blocks` + RLS; terms acceptance on the sign-in screen (~l.1274-1293); contact email in Settings. See §2.3.
3. **Privacy policy + Terms pages:** host them (e.g. next to `VOID_HTML_URL`), link from the sign-in screen and Settings in `void2-final.html`, and put the URLs in App Store Connect. The policy must describe on-device sensing, what goes to Supabase, YouTube/Google Translate, retention, deletion.
4. **Native OAuth:** `App.tsx` + `void2-final.html` `oauthSignIn` (~l.3786). Sketch:
   ```ts
   // App.tsx: add imports (deps via `npx expo install expo-apple-authentication expo-web-browser expo-crypto`)
   import * as AppleAuthentication from "expo-apple-authentication";
   import * as WebBrowser from "expo-web-browser";
   import * as Crypto from "expo-crypto";

   // in onMessage switch:
   case "oauth": {
     const SUPA = msg.supabaseUrl as string, KEY = msg.anonKey as string;
     if (msg.provider === "apple") {
       const raw = Crypto.randomUUID();
       const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
       const cred = await AppleAuthentication.signInAsync({
         requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
         nonce: hashed,
       });
       const r = await fetch(`${SUPA}/auth/v1/token?grant_type=id_token`, {
         method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
         body: JSON.stringify({ provider: "apple", id_token: cred.identityToken, nonce: raw }),
       });
       inject("__VOID_AUTH__", await r.json());
     } else {
       const redirect = "thevoid://auth-callback";
       const res = await WebBrowser.openAuthSessionAsync(
         `${SUPA}/auth/v1/authorize?provider=${encodeURIComponent(msg.provider)}&redirect_to=${encodeURIComponent(redirect)}`, redirect);
       if (res.type === "success") {
         const p = new URLSearchParams(res.url.split("#")[1] || "");
         inject("__VOID_AUTH__", { access_token: p.get("access_token"), refresh_token: p.get("refresh_token"),
           expires_in: Number(p.get("expires_in")), token_type: p.get("token_type") });
       }
     }
     break;
   }
   ```
   (`onMessage` must become `async`, or wrap this in an async IIFE with try/catch that injects an error on cancel.)
   ```js
   // void2-final.html: oauthSignIn(): before location.href=…
   if(window.__VOID_NATIVE__&&window.__voidPost){ window.__voidPost({type:'oauth',provider,supabaseUrl:SUPABASE_URL,anonKey:SUPABASE_ANON_KEY}); return; }
   // and define once:
   window.__VOID_AUTH__=function(d){ if(d&&d.access_token){ VoidAuth.save(d); /* then the same post-sign-in path as the web redirect */ } else siError('SIGN-IN CANCELLED'); };
   ```
   On iOS, render Apple's official button style (black/white, "Sign in with Apple") at least as prominent as Google.
5. **YouTube compliance in native builds:** `void2-final.html` ~l.4626-4940: when `window.__VOID_NATIVE__`, turn off `ytVeil` and the shadow player and unmute the visible player; review the HLS list at ~l.2089. See §2.6.
6. **Hide demo features in native builds:** DMs (~l.1576, 8553, 8599) and clearly-local composer media (~l.8403). See §2.8.
7. **Microphone and photos:** add `NSMicrophoneUsageDescription` and `NSPhotoLibraryUsageDescription` (§1.3) to `app.json`; reconcile Android `blockedPermissions: RECORD_AUDIO`; add `mediaCapturePermissionGrantType="prompt"` to the WebView in `App.tsx`.
8. **Privacy manifest:** add `ios.privacyManifests` (§1.5) to `app.json`.
9. **Deployment target:** raise `expo-build-properties` `ios.deploymentTarget` in `app.json` and `s.platforms` in `modules/expo-void-sensing/ios/ExpoVoidSensing.podspec` to SDK 57's minimum (§1.2).
10. **Wellness wording:** check `src/ConsentScreen.tsx` (mentions estimate/medical around l.33-131) and the calm-reading UI in `void2-final.html` for "not a medical device; not for diagnosis or treatment" and no diagnostic claims (§2.5).
11. **Native value:** add `expo-haptics` and the native share sheet through the bridge in `App.tsx`. Make the `SETTINGS.notify` toggle real (push) or remove it (§2.4).
12. **`version` → `1.0.0`** in `app.json` before the first store build (§1.1).
13. **Review notes draft + demo account:** create a seeded Supabase test user and write the walkthrough (§2.4/§2.5) in `store/` alongside the listing copy.
