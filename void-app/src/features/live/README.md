# Live engine (globe wall, nation hero, search LIVE NOW)

| file | what |
|---|---|
| `StreamTile.tsx` | one source attempt (`attemptSource`): HLS via expo-video, YouTube in an isolated WebView, mjpeg snapshots, iframe cams |
| `useStreamCascade.ts` | walks a source chain one attempt at a time, with instant refusals and the one-stream-one-place claim |
| `LiveWall.tsx` | the globe wall, with parking and heal |
| `AudioOwner.tsx` | a single owner of audible sound across surfaces |
| `frameSample.ts` | captures a 32×18 frame for the colour-bar and slate check (below) |
| `TileChrome.tsx`, `constants.ts`, `core.ts`, `ytHtml.ts`, `liveTheme.ts` | chrome, timings, core bridge, YouTube player HTML |

## Colour-bar / slate detection (web `frameVerdict` + `checkTileSignal`)

An off-air broadcaster still serves a valid HLS stream of SMPTE bars or a flat "no signal" slate. The
player reports PLAYING, so only the pixels show that the channel is dead. The web drew the `<video>`
into a 32×18 canvas. Natively:

1. **Surface.** HLS `VideoView`s render with `surfaceType="textureView"`. Android can read pixels back from
   a TextureView, but not from a SurfaceView. The VideoView is wrapped in a `collapsable={false}` View
   (`shotRef`) that holds only the video, so the loader and labels are never captured.
2. **Capture** (`frameSample.sampleFrame`) uses `react-native-view-shot` 5.1.0 (the SDK 57 pin):
   `captureRef(view, {width:32, height:18, result:'base64'})`.
   - **Both platforms use `format:'png'`**, which is 1 to 3 KB of base64. Android `format:'raw'` (direct
     RGBA) is implemented in `decodeRaw` but turned off (`USE_RAW_ANDROID = false`). view-shot 5.1.0
     sizes the raw buffer from the unscaled view (`total = w*h*4` in `ViewShot.java`), so a 32×18
     request still sends `viewW·viewH·4` bytes. For a full-width hero that is about 3.5 MB of base64
     every 6s, and only the first 2304 bytes are pixels. PNG is far cheaper.
   - The PNG is decoded in pure JS: base64, then
     `fflate.unzlibSync` (the new dependency, fflate ^0.8.3, has no deps), then the PNG filters 0 to 4
     (8-bit grey, RGB, grey+alpha and RGBA, non-interlaced). @2x/@3x output is nearest-sampled down to
     32×18.
   - Any error, a missing native module, an unmounted view, or an unsupported PNG returns **null, which
     means unknown and never counts as a failure**.
3. **Connect-time judge.** `FRAME_JUDGE_DELAY` (700ms) after the first PLAYING, one frame is judged with
   `frameVerdict(rgba, 32, 18)`. A `'bars'` verdict runs `markBadStream(source)` and then
   `finish(false)`, so the cascade moves on and the stream is refused for the session. Anything else
   (ok, slate, unknown) succeeds, as it did before. This matches the web, where only bars fail at
   connect. The judge is skipped (counted as unknown) while the app is backgrounded.
4. **Mid-stream.** Every ~6.1s, a tile runs a check when all of these hold: the tile has succeeded, it is
   **on screen** (`parked` is false), the app is `active`, and the player is playing. Each tile has its
   own `createSignalChecker()`: bars mean the stream is dead now, and a slate must repeat on 3 checks
   (an `ok` resets the count). A dead stream triggers `markBadStream(source)` and then `onNeedsHeal()`:
   - the globe wall sets `entry.needsHeal` (its heal loop reconnects);
   - the nation hero calls `hero.needsHeal(key)`;
   - search LIVE NOW re-walks its chain (`useLiveSlot.heal`), so the bad stream is skipped.
   Each tile triggers a heal at most once. A capture is never started while the previous one is still
   running.
5. **Cost.** One 32×18 capture per visible HLS tile every 6s. The Android raw path does not encode a PNG.
   YouTube, mjpeg and iframe tiles are never sampled.

### Limitations
- **iOS:** AVPlayerLayer content often snapshots as black through `drawViewHierarchyInRect`. Black is
  judged `ok`, so on iOS the check is usually a silent no-op and never a false failure.
- **Android raw is off** because of the view-shot 5.1.0 buffer sizing above. Once view-shot
  sizes the buffer from the scaled bitmap, set `USE_RAW_ANDROID = true`. If its payload is not opaque
  RGBA or ARGB, it falls back to PNG for the session.
- **Unrendered TextureView:** one that has not produced a frame yet captures as transparent or black,
  which is judged `ok`.
- Not verified on a device (EAS compile only).
