# Cursor agent change log (for Claude)

Cloud agent: `bc-8374f7e1-4036-4c1b-a104-add28de96e03`

Re-apply these in order. Do not revert earlier Cursor changes when implementing later ones.

## Cursor change #1 — Error 153 / missing Referer

- Symptom: tiles connected (`iframe` load / `attemptSource` true) but painted nothing.
- Cause: YouTube `PLAYABILITY_ERROR_CODE_EMBEDDER_IDENTITY_MISSING_REFERRER` (Error 153). Without Referer, `VIDEO_ID` stayed literal `"live_stream"`.
- Fix: `<meta name="referrer" content="strict-origin-when-cross-origin">`, iframe `referrerpolicy`, `origin=` + `enablejsapi=1` on embed URLs.

## Cursor change #2 — Hold loading until PLAYING

- Symptom: after #1, tiles showed YouTube origin watermark / player chrome while still not watchable; loading overlay cleared too early on `ready` / soft-load.
- Fix:
  - Sparkle overlay `z-index:3` above iframe; iframe starts `opacity:0`.
  - `attemptSource` succeeds only on YT `playerState === 1` (`playing` / `playing-time`).
  - Do **not** succeed on bare `load`, `onReady`, or buffering.
  - Nudge `playVideo` / `mute` via postMessage; reveal iframe + remove overlay only after PLAYING.
  - Optional known live `vid` on `LIVE_CHANNELS` for more reliable embeds.
- Verify: open `cursor2-play-proof.html` — must show green **PASS Cursor #2**. Harness uses `fake-yt-player.html` (same-origin YT postMessage stand-in) because datacenter IPs often hit YouTube bot walls; production WebViews use real YouTube with Cursor #1+#2.
