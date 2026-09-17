# features/auth: the identity gate

Port of `#signin` plus submitSignIn / signInAnon / submitEmailAuth / oauthSignIn / signOut (void2-final.html, lines 835-859 and 3760-3880).

- `SignInScreen` is the default export for `/sign-in`.
- `coreBridge.ts`: `ensureCore()` configures `src/core` once. It uses an AsyncStorage-hydrated memory store with write-through. It also joins the core `VoidAuth` session to supabase-js, so there is one session and one refresher (supabase-js). Every supabase-js auth event is mirrored into `VoidAuth.save`, and sessions created by core REST calls are pushed back with `setSession`. If A configures the core at boot, set `globalThis.__VOID_CORE_CONFIGURED__ = true` first.
- `useTermsGate()` / `TermsSheet`: the VMod terms sheet shown before the first write (used by the composer, chat and settings).

## Deviations
- **Handle bug fix.** The DB requires `^[a-z0-9_]{3,20}$`. The web allowed `.` and 2-character handles. `handleError()` applies `validateHandle` and then the DB rule. Anonymous handles are `@void_xxxxxx`. The handle max length is 20, not 24.
- Profiles are written with the stripped handle, with no `@`. Web and core `signInAnon`/`submitEmailAuth` upserted `@handle`, which always failed the check.
- A handle collision shows `HANDLE TAKEN · TRY ANOTHER`. The web failed silently.
- Google uses `expo-web-browser openAuthSessionAsync(VoidAuth.oauthUrl(...), 'thevoid://auth-callback')` → `sessionFromOAuthRedirect`. As on the web it is a plain `/authorize`: the OAuth identity becomes the session and the anonymous account is not merged. The handle and name typed on the gate are applied afterwards (`void_pending_profile`). Real anonymous→OAuth linking would need GoTrue manual linking (`/user/identities/authorize`) to be enabled.
- Apple on iOS uses the native sheet, then `/auth/v1/token?grant_type=id_token` with a SHA-256 nonce. On other platforms Apple goes through web OAuth. `authorizationCode` is stored under `void_apple_authorization_code`, and `provider_refresh_token` (if returned) under `void_apple_refresh_token`. The delete-account function accepts only refresh/access tokens, so it must exchange the code server-side (TODO(backend)).
- An email sign-up that needs confirmation returns `CHECK YOUR EMAIL TO CONFIRM, THEN SIGN IN`.
