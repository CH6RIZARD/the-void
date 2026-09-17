# Google Play Console checklist — The Void (com.thevoid.app) 1.0.0

Answers for each Play Console field, based on the code as of 2026-09-16. Evidence is listed next to each answer so you can re-check it when the code changes. Items that still need work are marked **TODO**.

Related: `listing.md` (store copy), `moderation-process.md` (UGC process), `ios-readiness.md` (Apple side).

Public URLs (live once `privacy.html`, `terms.html` and `account-deletion.html` are pushed to `main`; the Pages workflow stages all three):
- Privacy policy: https://void-app-d35c.pages.dev/privacy
- Terms / EULA: https://void-app-d35c.pages.dev/terms
- Account deletion: https://void-app-d35c.pages.dev/account-deletion
- Support email: daniel4chigs@gmail.com

---

## 0. No-trackers verification (evidence for the forms below)

- `void-app/package.json`: no analytics, crash-reporting, attribution, push or ad SDKs. The only network SDK is `@supabase/supabase-js`. Nothing from Firebase, Sentry, Bugsnag, AdMob, Meta, AppsFlyer, Adjust, Branch, Segment, Amplitude, Mixpanel, PostHog, OneSignal or expo-notifications.
- `modules/expo-void-sensing/android/build.gradle`: CameraX, AndroidX and **ML Kit face-detection 16.1.7 with the bundled model** (on-device; the model is not downloaded from Play Services). ML Kit may send Google anonymous diagnostics about the API itself; Google's own Data safety guidance for bundled ML Kit covers this. **TODO:** read the ML Kit "Data disclosure" page before you submit and confirm there is nothing to add.
- `void2-final.html` (web): no analytics or ad scripts. External scripts are only `hls.js` (jsDelivr) and `three.js` (cdnjs), plus Google Fonts CSS. (A grep hit for "onesignal" is part of a Kenyan TV stream hostname, `live-onesignal.royalmedia.co.ke`, not the SDK.)
- iOS `privacyManifests.NSPrivacyTracking` is `false` in `app.json`.

---

## 1. App content > Privacy policy
`https://void-app-d35c.pages.dev/privacy`

## 2. App content > Ads
**No, my app does not contain ads.** There is no ad SDK, and the YouTube embeds are third-party players, not ads we serve. YouTube can show its own ads inside an embed. Google's guidance treats this as content, not as your app containing ads. If a reviewer disagrees, switch the answer to "Yes".

## 3. App content > App access
**All or some functionality is restricted: YES**, because sensing requires opting in. No login is required, though. Instructions (paste this):

```
No credentials are needed. On first launch:
1. The "Body signals (optional)" consent screen appears. Tap "Not now" to skip, or toggle
   "Front camera" and tap "Turn on body signals" to test on-device sensing (asks for Camera).
2. On the sign-in screen tap "CONTINUE ANONYMOUSLY". This creates an anonymous account;
   posting, replying, reacting, DMs, reporting and blocking all work with it.
   (Email / Google / Apple sign-in are optional.)
3. Body signals can be reopened any time: Settings > Body signals. The fingertip reading
   (rear camera + flash, 30 s) and Bluetooth heart-rate pairing are reached from there.
4. Report / block: the "..." menu on any post, or tap an author's name.
5. Delete account: Settings > Delete account (also https://void-app-d35c.pages.dev/account-deletion).
6. Terms of use / contact: Settings > Safety.
```
Evidence: `src/features/auth/SignInScreen.tsx` (CONTINUE ANONYMOUSLY), `src/lib/sensing.tsx` (consent shown while `!hasChosen`; `openConsent()` from Settings), `src/features/settings/SettingsScreen.tsx`.

**TODO:** check the exact path to the fingertip reading and BLE pairing in the final build (the other agent is still changing native UI). Update step 3 if it has moved.

## 4. App content > Content rating (IARC questionnaire)

- Email: daniel4chigs@gmail.com
- Category: **"Social or Communication"**. The app's main interactions are UGC and messaging, and IARC rates those more strictly than "Reference, News or Educational". Choosing the category that gives the stricter rating avoids a later re-rating.

| Question (paraphrased) | Answer | Why |
|---|---|---|
| Violence / blood / gore depicted | **Yes, realistic, but not the app's own content.** Answer the "unfiltered news / UGC may contain" follow-ups with Yes | GDELT, live news streams and user posts can show war and violence. `hideGraphic` blurs tagged media by default (`src/core/api/moderation.ts`) |
| Sexual content / nudity | **No** as designed content; **Yes** to "users could post it" | Prohibited by the terms, reportable, removed |
| Profanity / crude humour | **Yes** (user-generated, unfiltered) | No profanity filter |
| Drugs, alcohol, tobacco, gambling | **No** (not featured; could appear in news) | |
| Fear / horror | **No** | |
| Users can interact or communicate (chat, DMs, posts) | **Yes** | posts, replies, DMs (`007_media_and_dms.sql`) |
| Users can share user-generated content | **Yes** | photos, video, voice notes to Supabase Storage |
| Shares the user's location with other users | **No** | no location permission |
| Digital purchases | **No** | |
| Unrestricted internet / web content | **Yes** | third-party feeds, embeds, live streams |
| Is it a web browser or search engine | **No** | |
| Content moderation in place | **Yes**: report, block, 24 h review | `006_moderation.sql`, `moderation-process.md` |

Expected result: IARC Mature 17+ / PEGI 16–18 / USK 16–18 with the "Users Interact" and "Shares Info" descriptors. If IARC gives something lower, that is fine; the target audience below (18+) still applies. Do not try to raise the rating by giving false answers.

## 5. App content > Target audience and content
- Target age groups: **18 and over only.**
- Could the app unintentionally appeal to children? **No** (news, politics, no cartoon or kid-oriented design).
- Result: the Families policy does not apply and no teacher-approved review is needed.
- Store listing: the full description already says "intended for adults".

## 6. App content > News apps
- Is your app a news app? **Yes.** It is listed in News & Magazines and its main content is news aggregation.
- Declaration fields:
  - Publisher/owner contact: daniel4chigs@gmail.com, website https://void-app-d35c.pages.dev
  - Sources: an aggregator of third-party public content (Bluesky, Mastodon, Lemmy, Reddit, GDELT, PeerTube, Internet Archive, Wikimedia Commons, public broadcaster streams). Each item links to or credits its original source.
- **TODO (Play's News policy asks for transparency about ownership and sources):** add an "About / sources" page on the website, or a section in Settings, naming the owner (a person or company), a contact address, and how stories are sourced and ranked. `privacy.html` and `terms.html` list the sources, but a short About page is the safer way to meet this requirement.
- **TODO:** confirm that each post in the native feed shows its source or author and opens the original link. Reviewers check for this.

## 7. App content > Health apps
- Does the app have health features? **Yes.** Answer honestly: the optional sensing estimates heart rate, heart-rate variability and a camera pulse.
- Categories to tick (choose the closest options in the console list): **Wellness / Stress management & relaxation** and **Activity & fitness tracking (heart rate)**. Do **not** tick medical, clinical, disease management or "medical device".
- Description to paste:
  ```
  Optional, opt-in and off by default. With the user's consent, the app estimates attention,
  a rough pulse from the front camera, heart rate and HRV from a 30-second rear-camera
  fingertip reading, or reads heart rate from a paired Bluetooth strap. Everything is
  processed in memory on the device, is never stored or uploaded, and is used only to
  personalise the news feed. It is a wellness estimate, not a medical device, and the app
  says so on the consent screen and in the privacy policy. No Health Connect, no BODY_SENSORS.
  ```
- Evidence: `app.plugin.js` blocks `BODY_SENSORS`, `ACTIVITY_RECOGNITION` and `health.READ_HEART_RATE*`; `app.json` `blockedPermissions`; `ConsentScreen.tsx` ("estimates, not a medical device").
- Health Connect declaration: **not applicable** (not used).

## 8. App content > Data safety

Top-level:
| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all user data encrypted in transit? | **Yes** (HTTPS to Supabase and the proxy; all feeds are https) |
| Do you provide a way for users to request that their data is deleted? | **Yes** |
| Account creation methods | Username/handle (anonymous), username + password (email), OAuth (Google, Apple) |
| Delete account URL | `https://void-app-d35c.pages.dev/account-deletion` |
| Can users delete some data without deleting the account? | **Yes** (delete posts, unfollow, unblock, clear local data) |
| Independent security review | No |

Data types. For all of them: **Shared = No** (Supabase, Cloudflare and the proxy host are service providers, which is not "sharing"), **Processed ephemerally = No** unless stated, **Purpose = App functionality (+ Account management where noted)**. Nothing is used for Analytics, Advertising, Fraud prevention or Personalisation by third parties.

| Category > type | Collected | Required / optional | Purpose | Evidence |
|---|---|---|---|---|
| Personal info > **Email address** | Yes | Optional (email/Google/Apple sign-in only) | App functionality, Account management | Supabase auth |
| Personal info > **Name** | Yes (display name) | Optional | App functionality | `profiles.display_name` |
| Personal info > **User IDs** | Yes (user UUID, handle) | Required (any post/DM creates an anonymous user) | App functionality, Account management | `profiles`, `auth.users` |
| Messages > **Other in-app messages** | Yes (DMs, stored server-side, not E2EE) | Optional | App functionality | `messages.body` (007) |
| Photos and videos > **Photos**, **Videos** | Yes (attached to posts) | Optional | App functionality | `post-media` bucket |
| Audio > **Voice or sound recordings** | Yes (voice notes) | Optional | App functionality | `post-media` audio mime types |
| App activity > **Other user-generated content** | Yes (posts, replies, reports, avatar) | Optional | App functionality | `posts`, `reports` |
| App activity > **Other actions** | Yes (reactions, follows, blocks) | Optional | App functionality | `reactions`, `follows`, `blocks` |
| Health and fitness > **Health info** / **Fitness info** (heart rate, HRV) | **No, not collected.** It is processed on the device only and never leaves it. Google's definition of "collected" is data transmitted off the device, so on-device-only data is not declared. | n/a | n/a | `ConsentScreen.tsx`, `modules/expo-void-sensing/index.ts` (only quantized scores cross into JS; nothing is uploaded) |
| Location | **No** | | | no location permission |
| App info & performance (crash logs, diagnostics) | **No** | | | no crash SDK |
| Device or other IDs | **No** | | | no advertising ID; the SDK does not read it |
| Web browsing, Contacts, Calendar, Financial, Files and docs | **No** | | | |

Notes and edge cases:
- **Proxy / hosting request logs (IP address):** Google exempts IP addresses and request logs kept only for the server to work and stay secure, when they are not used for anything else. Declare nothing, unless you start using the logs for analytics.
- **Translate** sends a post's text to Google Translate when the user taps Translate. This is a user-initiated transfer of *third-party* content, not user data, so nothing is declared.
- **YouTube embeds and other third-party players** collect data under their own policies. SDK or embed data that your app does not receive is not declared, but it is covered in the privacy policy.
- **TODO:** if a crash reporter, analytics or push notifications are added later, update this form *before* that release ships.

## 9. Sensitive permissions and prominent disclosure

Permissions in the manifest (`app.json` `android.permissions` + plugins): `CAMERA`, `RECORD_AUDIO`, `BLUETOOTH_SCAN` (with `neverForLocation`), `BLUETOOTH_CONNECT`. None of these is a Play "restricted permission" that needs a declaration form (those are SMS/Call log, all-files access, background location, accessibility, etc.). Reviewers still check that each one is justified and disclosed.

| Permission | Why | When requested | Disclosure shown before the OS dialog |
|---|---|---|---|
| CAMERA | (a) Optional on-device attention and pulse estimate (front camera); (b) optional 30 s fingertip reading (rear camera + flash); (c) taking a photo for a post | Only when the user turns on that sensing tier or taps "take photo" | ConsentScreen: tier title, what is measured, "asks for Camera", "Frames are processed in memory and never saved or uploaded" |
| RECORD_AUDIO | Voice notes in the composer | When the user taps record | Usage string: "Only when you tap record in the composer…" |
| BLUETOOTH_SCAN / CONNECT | Pair a BLE heart-rate strap or watch | Only when the user turns on the Bluetooth tier or starts pairing | ConsentScreen "Bluetooth heart-rate strap or watch · asks for Bluetooth" |
| Photos | Android photo picker (no READ_MEDIA_* permission needed) | On attach | n/a |

Prominent disclosure check (Play User Data policy), against `src/ConsentScreen.tsx`:
- [x] Shown in the normal flow on first launch, before any sensing permission request (`sensing.tsx`: `consentOpen = !hasChosen`)
- [x] Says what data is used (scroll/touch, camera-derived blink/gaze/smile/pulse, HR/HRV, BLE HR) and how (feed tuning on the device)
- [x] Says that nothing is stored or sent, and that it is not used for ads or sold
- [x] Needs an affirmative action ("Turn on body signals"), and "Not now" is equally visible
- [x] Explains how to turn it off (Settings > Body signals, OS settings)
- [ ] **TODO:** the "How you hold and scroll" toggle defaults to **on**, while the camera, fingertip and BLE toggles default to off. Tapping "Turn on" is still an affirmative action, but reviewers (and GDPR Art. 9) prefer every biometric-adjacent tier to default off. Consider defaulting `behaviour` to `false`.
- [ ] **TODO:** `ConsentScreen.tsx` has a `[HUMAN GATE]` asking for legal review of the wording (GDPR Art. 9, BIPA, CUBI, MHMDA). Do this before production.
- [ ] **TODO (functional):** `minSdkVersion` is 24. On Android 7–11, a BLE scan needs `ACCESS_FINE_LOCATION` plus the legacy `BLUETOOTH` / `BLUETOOTH_ADMIN` permissions, and none of them is declared, so BLE pairing will probably fail on those versions. Either raise `minSdkVersion` to 31 for the BLE tier (hide it on older versions) or add the legacy permissions with `maxSdkVersion="30"` and disclose location use. Test on an Android 11 device.

## 10. Foreground services, exact alarms, full-screen intents
None. `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and `SYSTEM_ALERT_WINDOW` are in `blockedPermissions`. Answer **No** to the foreground service declaration. **TODO:** after the first AAB upload, check App bundle explorer > Permissions for any permission added by a library.

## 11. Government apps, financial features, COVID, Data safety for kids
All **No / not applicable**.

## 12. UGC policy (reviewed with the content rating)
Play requires all of these, and all are present: terms acceptance before posting (`posts_insert` RLS + terms sheet); in-app reporting of content and users; blocking; moderation within a stated time (24 h); removal of abusive users. See `moderation-process.md`. **TODO:** someone must actually work the queue every day from the first day of closed testing.

---

## 13. Release path: internal → closed → production

### Internal testing (right away)
1. Create the app in Play Console: name "The Void", default language English, App (not game), Free, accept the declarations.
2. Testing > Internal testing > Testers: create an email list (up to 100) and add yourself.
3. Upload the first AAB **by hand** (the Play API cannot create a package name, so the first upload must go through the web UI): `eas build -p android --profile production`, download the `.aab`, then Create new release > upload.
4. Enrol in **Play App Signing** when prompted (EAS keeps the upload key).
5. Share the opt-in link (Testers tab > "Copy link"). Each tester opens it while signed in with the listed Google account, taps "Become a tester", then installs from the Play Store link on that page.
6. After that, `eas submit -p android --latest` uploads to `track: "internal"` (the current eas.json setting).

### Closed testing (the 12 testers / 14 days rule)
Personal developer accounts created after 13 Nov 2023 must run a closed test with **at least 12 testers who stay opted in for at least 14 days in a row** before they can apply for production access. (The requirement was 20 testers until Dec 2024 and is 12 now; check the current number in Console > Dashboard.) Organisation accounts are exempt.

1. Testing > Closed testing > Create track (or use "Alpha"), add countries, and promote the internal release to it.
2. Testers: an email list, or a **Google Group** (simplest: testers join the group and you add the group address once).
3. Recruit **15–20 people**, so that dropouts still leave 12 or more:
   - friends and family with Android phones (they must use the Google account that is on the list);
   - r/AndroidClosedTesting, r/TestersCommunity, and "12 testers" exchange groups (you test their app, they test yours);
   - the fediverse and Bluesky communities The Void already aggregates, which are on-topic for this app.
4. Send each tester: (a) the Google Group join link, (b) the web opt-in link `https://play.google.com/apps/testing/com.thevoid.app`, (c) the Play Store install link, and (d) a request to keep the app installed and open it a few times a week for 14 days.
5. Ship at least one update during the 14 days and act on feedback. The production application asks what you learned and changed.
6. After 14 days: Dashboard > **Apply for production** and answer the questionnaire (how you recruited testers, the feedback you got, how you decided the app was ready). Review usually takes up to about 7 days.

### Production
1. Finish every App content section above (the dashboard shows what is missing).
2. Create a production release (promote from closed testing). Use a staged rollout, for example 20%.
3. After that, change `eas.json` `submit.production.android.track` to `"production"`, or keep `"internal"` and promote in the Console.

## 14. `eas submit` service account

Docs: https://docs.expo.dev/submit/android/ and https://github.com/expo/fyi/blob/main/creating-google-service-account.md

1. Google Cloud Console: create or pick a project, enable the **Google Play Android Developer API**.
2. IAM > Service accounts > Create (for example `eas-submit`), then Keys > Add key > JSON. Download it.
3. Play Console > Users and permissions > Invite new user > the service account email. Grant app access to The Void with **Release apps to testing tracks** (plus **Release to production** if you will submit there) and **Manage testing tracks**.
4. Store the JSON **outside git** (for example `void-app/secrets/play-service-account.json`, and add `secrets/` to `.gitignore`), or upload it to EAS (`eas credentials` > Android > Google Service Account) and leave the path out.
5. `eas.json` `submit.production.android` today:
   ```json
   "android": {
     "serviceAccountKeyPath": "REPLACE_WITH_PATH_TO_PLAY_SERVICE_ACCOUNT_JSON",
     "track": "internal"
   }
   ```
   Set it to, for example:
   ```json
   "android": {
     "serviceAccountKeyPath": "./secrets/play-service-account.json",
     "track": "internal",
     "releaseStatus": "completed"
   }
   ```
   Other valid fields: `track` = `internal | alpha | beta | production` (or a custom closed track name), `releaseStatus` = `completed | draft | halted | inProgress` (use `draft` while the app is still in "draft" state on Play, otherwise the API rejects the upload), `rollout` (0–1, with `inProgress`), `changesNotSentForReview` (boolean), `applicationId`.
   - **TODO:** until the app's first release is published, Play rejects `completed` with "Only releases with status draft may be created on draft app". Use `"releaseStatus": "draft"` for the first submissions.
   - **TODO:** replace the placeholder path. Note that `SUBMIT_NOTES.md` says eas.json cannot contain comment keys.

## 15. 16 KB page size
Apps targeting Android 15+ that are submitted since 1 Nov 2025 must support 16 KB memory pages.
- `targetSdkVersion` / `compileSdkVersion` are 36 (`app.json`, expo-build-properties). SDK 57 / RN 0.86 ship 16 KB-aligned prebuilt `.so` files.
- The only extra native library, ML Kit face-detection 16.1.7, is documented in `modules/expo-void-sensing/android/build.gradle` as 0x4000-aligned (verified).
- **TODO:** after the first AAB, check Play Console > App bundle explorer > "Memory page size" (it shows a compliance warning if any `.so` is 4 KB-aligned). Or check locally: unzip the AAB and run `llvm-readelf -l lib/arm64-v8a/*.so | grep LOAD`; every alignment must be `0x4000` or larger.

## 16. Store listing graphics

| Asset | Requirement | Status |
|---|---|---|
| App icon | 512×512 PNG, 32-bit, ≤1 MB | ✅ `assets/brand/play-store-icon-512.png` (512×512, 123 KB) |
| Feature graphic | 1024×500 JPG/PNG, no alpha | ✅ `assets/brand/feature-graphic.png` (1024×500, RGB with no alpha, checked) |
| Phone screenshots | ≥2 (up to 8), 16:9 or 9:16, 320–3840 px on each side | ❌ **TODO:** `store/screenshots/` is currently **empty**. The earlier web-app screenshots are not in the folder. Web screenshots would only be a stopgap. Take real screenshots from the native APK (preview build) on a 1080×2400 device or emulator: feed, thread, globe/nation, live wall, reels, consent screen. |
| 7" / 10" tablet screenshots | Optional (required only to be featured on tablets) | skip |
| Promo video | Optional YouTube URL | skip |

Screenshot rules: show the real UI, no misleading claims, and don't show graphic violence in the first two images (it can lead to a rejection or a higher rating).

---

## Remaining TODOs (summary)
1. Push `privacy.html`, `terms.html`, `account-deletion.html` and the workflow change to `main`, then open all three URLs.
2. Set the governing law / venue in `terms.html` §12.
3. Take native phone screenshots (≥2) into `store/screenshots/`.
4. Service account JSON + `eas.json` path; use `releaseStatus: "draft"` until the first release is live.
5. Recruit 15–20 closed testers and run 14 days.
6. About/sources page for the News declaration.
7. Legal review of the consent wording; consider defaulting the scroll/touch tier to off.
8. BLE on Android 7–11 (legacy permissions / location), or hide that tier below API 31.
9. Check permissions and 16 KB compliance in App bundle explorer after the first upload.
10. Confirm the ML Kit data disclosure.
