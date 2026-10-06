# THE VOID — Onboarding + Auth handoff

Source of truth for the UI: `Void Jump In.dc.html` (flow shell), `Void Card Gate.dc.html` (screen 3), `void-globe.js` (WebGL globe). The UI is final; this document covers wiring.

## Flow

1. **Jump in** — marquee of live callouts. CTA → screen 2. "ALREADY HAVE A CARD · SIGN IN" → screen 3 in LOGIN mode.
2. **The Globe** — decorative WebGL globe, drag to turn. CTA → screen 3.
3. **The Signal Card** — account creation / login. See auth below.
4. **Ignite the feed** — interest picks. Shown ONLY to new accounts (incl. anonymous). Skipped on login.
5. **Lit** — 1.6 s confirmation → hand off to the app shell.

Progress dots: 4 steps; screen 5 shares the 4th dot.

## Auth gating (important)

The "SIGNAL ACQUIRED" / "CARD FOUND" success state and everything after it (Ignite, Lit, the app) must render **only after the backend approves the credential**. In the mockup `onEnter(via)` fires immediately; in production:

```
submit → show pending state on the CTA (disable, keep copy) →
  await auth call →
    ok   → play success state (⬡ + gold bar 1.6 s) → route
    fail → keep the card on screen, print error in the red mono line
```

Routing after approval: `via === 'login'` → app home (feed restored from account). `via ∈ {anon, apple, google, email}` → Ignite (screen 4) → Lit → app home.

## Modes on the card

### NEW USER (`mode = create`)
Handle on the card is the identity; one of three providers anchors it. No handle-only password route.

- Blank handle → **ENTER BLANK** → anonymous device account (local id, no PII). `via = 'anon'`.
- Handle + **APPLE** → Sign in with Apple; on success create account `{handle, provider:'apple', providerId}`. Handle uniqueness check must happen before the provider popup (surface `HANDLE TAKEN` in the error line).
- Handle + **GOOGLE** → same with Google.
- Handle + **EMAIL** → step 1 email → step 2 password + confirm (≥8, must match) → **ISSUE THE CARD** → create `{handle, email, passwordHash}`. Send verification email async; do not block entry.
- Handle rules: 2–20 chars, `[a-zA-Z0-9_.]`. Validated client-side; server re-validates + uniqueness.

### LOGIN (`mode = login`)
Four independent routes. Only route 1 uses the card.

1. **Handle + password on the card**: type handle → "ENTER PASSWORD" swaps the card line to a password field → typing lifts the globe → tap globe (or ⏎) submits `{handle, password}`. "ENTER USERNAME" swaps back. Errors: `TYPE YOUR HANDLE ON THE CARD`, `ENTER YOUR PASSWORD`, server: `WRONG HANDLE OR PASSWORD`.
2. **APPLE** → provider sign-in, look up account by providerId. No handle needed.
3. **GOOGLE** → same.
4. **EMAIL** → inline email + password + SIGN IN. No handle needed.

Unknown provider/email account on login → error `NO CARD FOUND · TRY NEW USER` (do not auto-create).

## Data captured by Ignite

`topics: string[]` (from SIGNAL chips), `places: string[]` (city names from PLACES chips; map to nation ISO in the P list). Zero picks → "SHOW ME EVERYTHING" → empty arrays, feed unseeded. Persist to the account (or device record for anon).

## Component contract

`<dc-import name="Void Card Gate" step-label="3 OF 4" on-enter="{{ fn }}">` — `onEnter(via)` where `via ∈ 'anon' | 'apple' | 'google' | 'email' | 'login'`. Replace the immediate `finish()` in `Void Card Gate.dc.html` with the awaited auth call described above.

## Live sources

Screen 1 tiles and Ignite places use the app's own live-cam list (YouTube ids in `void2-final.html`); thumbnails from `i.ytimg.com`. Streams can be offline — fall back to the sparkle loader as the app does.
