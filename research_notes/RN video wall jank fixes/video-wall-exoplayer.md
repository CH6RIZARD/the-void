# Video wall of simultaneous ExoPlayer tiles on low-end Android (expo-video / media3)

Scope: 6-10 visible live-HLS tiles in a scrolling grid, Expo SDK 57 / RN 0.86 new arch, expo-video (media3-based), weak MediaTek SoC (4-8 HW decoders, weak GPU).

## Q1. SurfaceView vs TextureView for many simultaneous small tiles; what expo-video uses

### Takeaway
expo-video renders through media3 `PlayerView` and exposes a per-view `surfaceType` prop (`'surfaceView'` default, `'textureView'`) that must not change at runtime. Google's guidance is SurfaceView for power/frame-timing; TextureView only when SurfaceView misbehaves (overlap, pre-API-24 animation). For a wall of 6-10 small tiles, each SurfaceView is a separate composition layer — likely exceeding the hardware composer's overlay planes on a low-end SoC — so TextureView (one GPU copy per tile, but composited inside the normal view hierarchy) is often the pragmatic choice for small muted tiles, while SurfaceView stays right for the single full-screen player.

### Cited Findings
- expo-video `VideoView` has Android-only `surfaceType`: `'surfaceView'` (default) or `'textureView'`; "SurfaceView provides lower power consumption and better performance"; TextureView is the documented fix "when two VideoView components overlap with contentFit='cover'"; "This prop should not be changed at runtime." — [Expo video docs](https://docs.expo.dev/versions/latest/sdk/video/)
- Internally, expo-video inflates a media3 `PlayerView` from one of two layouts (`surface_player_view` / `texture_player_view`) selected by `useTextureView`; two wrapper classes `SurfaceVideoView` and `TextureVideoView`. Surface type is fixed at view creation. — [expo-video VideoView.kt](https://github.com/expo/expo/blob/main/packages/expo-video/android/src/main/java/expo/modules/video/VideoView.kt)
- Google media3 guidance: SurfaceView has "significantly lower power consumption," "more accurate frame timing," HDR and DRM support; "TextureView should be used only if SurfaceView does not meet your needs," e.g. smooth animation/scrolling of the video surface prior to Android 7.0 (API 24). SurfaceView wasn't synchronized with view animations before API 24 (lag, black flashes when animated). — [media3 surface docs](https://developer.android.com/media/media3/ui/surface)
- From Android 14, `PlayerView` uses `SurfaceView.setSurfaceLifecycle(SURFACE_LIFECYCLE_FOLLOWS_ATTACHMENT)` specifically "to avoid delayed playback in scrolling UIs" (surface destruction delays). — [media3 surface docs](https://developer.android.com/media/media3/ui/surface)
- expo-video hides the surface view until `onRenderedFirstFrame()` fires (`shouldHideSurfaceView` flag), and the ExoPlayer black shutter can be disabled with `useExoShutter={false}` — the built-in first-frame/poster mechanism. — [expo-video VideoView.kt](https://github.com/expo/expo/blob/main/packages/expo-video/android/src/main/java/expo/modules/video/VideoView.kt); [Expo video docs](https://docs.expo.dev/versions/latest/sdk/video/)
- An expo-video TikTok-style feed on Android reported "random flicker while swiping between videos, some videos briefly flashing during transition" — the characteristic SurfaceView-in-scrolling-UI artifact. — [Cursor forum thread](https://forum.cursor.com/t/need-architectural-review-android-expo-video-flicker-in-tiktok-style-feed/164359)

### Inferences
- On Android 7.0+ SurfaceView scroll-syncs correctly in the common case, but 6-10 simultaneous SurfaceViews each demand a hardware-composer overlay plane; low-end SoCs have few planes, and overflow forces SurfaceFlinger into GPU (client) composition — on a weak Mali/PowerVR GPU that can cost more than TextureView's per-tile copy. (Inference from AOSP HWC architecture; no fetched source — see Gaps.)
- Practical split for the void wall: `surfaceType="textureView"` for grid tiles (small, muted, scrolling, overlapping rounded corners/overlays), `surfaceType="surfaceView"` for the expanded/full-screen player. Since the prop can't change at runtime, use two different `VideoView` instances and swap which one holds the player (`changeVideoView` handles handoff).
- expo-video's first-frame hiding means a poster `<Image>` under the tile + `useExoShutter={false}` gives clean poster→video swaps with no black flash.

### Gaps
- No fetched primary source quantifying HWC overlay-plane counts on MediaTek low-end SoCs or the exact SurfaceView count that triggers client composition; verify empirically with `adb shell dumpsys SurfaceFlinger` (look for "Client composition") while the wall is on screen.

## Q2. How TikTok/Instagram/Pinterest/Reddit-style apps run video feeds on low-end Android

### Takeaway
Production feeds do not create/destroy players per cell. They keep a small fixed pool of pre-built ExoPlayers (Reddit: pool = 2×prefetch+2), recycle players on view recycle instead of releasing, pre-warm (prepare + decode first segment) before the item is visible, and pool by codec format to avoid decoder re-init. Google has since productized the pattern as `PlayerPool`/`rememberPooledPlayer` in media3.

### Cited Findings
- Reddit: "prewarming… not only loads the video data, but also starts preparing it for playback by decoding the first segment and storing it in memory" — calling `prepare()` before the item enters the viewport. Results: +19% videos started <250 ms, +16% <500 ms, +11% overall watch time. — [Taking ExoPlayer Further: Reddit's performance techniques](https://proandroiddev.com/taking-exoplayer-further-reddits-performance-techniques-f426fdafb471)
- Reddit feed pooling: pool size = (prefetch count n × 2) + 2 player instances; when a ViewHolder recycles, its player is "immediately detached and returned back to the player pool instead of being destroyed" and reused for the next item. — [same article](https://proandroiddev.com/taking-exoplayer-further-reddits-performance-techniques-f426fdafb471)
- Pinterest: (1) warm the network at app start with a dummy HTTP HEAD so the connection is reused for future video requests; (2) pre-set aspect ratio via `AspectRatioFrameLayout.setAspectRatio()` to avoid layout work; (3) pool players keyed by initial decoding format, "which removed latency caused by encoder switching when players were recycled with encoders matching the media's encoding"; (4) pool sizing took "multiple iterations… to house multiple video plays while avoiding OutOfMemory (OOM) and Application Not Responding (ANR) errors." — [Pinterest: Turbocharge Android Video (The New Stack)](https://thenewstack.io/pinterest-turbocharge-android-video-with-these-simple-steps/)
- Google now ships this pattern: media3 `androidx.media3.ui.compose.lifecycle.rememberPooledPlayer` "manages ExoPlayer instances through a PlayerPool and handles player setup configuration." — [media3 reference](https://developer.android.com/reference/kotlin/androidx/media3/ui/compose/lifecycle/rememberPooledPlayer.composable)
- General Android guidance for video lists: reuse player instances instead of instantiating per cell; "each device has limited media codecs responsible for video decoding, and the app will crash after all available media codecs run out." — [Uptech: multiple videos with RecyclerView and ExoPlayer](https://www.uptech.team/blog/how-to-play-multiple-videos-using-the-recyclerview-and-exoplayer)

### Inferences
- The void wall equivalent: a fixed pool of `createVideoPlayer()` instances created once at mount (size ≈ visible tiles + 1-2 spares, capped by the decoder budget from Q4), with tiles acquiring/releasing players as they enter/leave the viewport. Never `useVideoPlayer` per tile in a long list — unmount/remount churns real decoders.
- Pinterest's codec-keyed pooling matters less for the void if every wall stream is the same codec/profile (normalize the HLS ladder to one codec — e.g. all H.264 baseline/main — so any pooled player can take any stream without decoder re-init).
- None of these apps run 6-10 *playing* decoders in a feed; they run 1-3 playing + pre-warmed idle players. A "wall" that genuinely plays 6-10 tiles at once is beyond what feed apps attempt on low-end hardware — expect to cap concurrent *playing* tiles below the visible count on the weak MediaTek phones and show posters/last-frame for the rest, rotating which tiles are live.

### Gaps
- Could not fetch TikTok/ByteDance or Instagram/Meta first-party engineering posts on Android feed video (Medium/proandroiddev returned 403; no Meta post surfaced in search). The Reddit and Pinterest posts are the best primary-adjacent sources found.

## Q3. ExoPlayer settings that cut per-instance cost (and what expo-video exposes)

### Takeaway
Per-tile cost is cut by: small forward buffers (expo-video `bufferOptions`), capping decode resolution (media3 `TrackSelectionParameters.setMaxVideoSize`/`setViewportSize` — not exposed by expo-video JS; for HLS, point tiles at the low rendition's media playlist instead of the master playlist), disabling audio decode (`setTrackTypeDisabled(C.TRACK_TYPE_AUDIO)` — also not exposed; `muted` only sets volume 0 and keeps the audio decoder running), and releasing rather than pausing off-screen players (paused players still hold codecs).

### Cited Findings
- expo-video `bufferOptions` (whole object must be set at once): `preferredForwardBufferDuration` (Android default 20 s), `minBufferForPlayback` (default 2 s, Android), `maxBufferBytes` (default 0 = automatic, Android), `prioritizeTimeOverSizeThreshold` (default false, Android). — [Expo video docs](https://docs.expo.dev/versions/latest/sdk/video/)
- expo-video maps `bufferOptions` to a custom `VideoPlayerLoadControl` (`loadControl.applyBufferOptions(value)`) set on `ExoPlayer.Builder().setLoadControl(...)`; the builder also uses `DefaultTrackSelector`, `DefaultRenderersFactory` with `forceEnableMediaCodecAsynchronousQueueing()` and `setEnableDecoderFallback(true)`. — [expo-video VideoPlayer.kt](https://github.com/expo/expo/blob/main/packages/expo-video/android/src/main/java/expo/modules/video/player/VideoPlayer.kt)
- Resolution capping in media3: `player.trackSelectionParameters.buildUpon().setMaxVideoSizeSd()` or `.setMaxVideoWidth(1280).setMaxVideoHeight(720)`, or viewport-based constraints (`setViewportSize`) that limit selection to the actual view size; constraints apply across all media items and can change during playback. — [media3 track selection](https://developer.android.com/media/media3/exoplayer/track-selection)
- Disabling a whole track type: `.setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true)` (works for video/audio/text). — [media3 track selection](https://developer.android.com/media/media3/exoplayer/track-selection)
- expo-video audio: "Audio cannot be completely disabled; the player supports muting via the `muted` property, which sets player volume to 0f, but audio tracks remain active" (audio decoder keeps running per muted tile). — [expo-video VideoPlayer.kt](https://github.com/expo/expo/blob/main/packages/expo-video/android/src/main/java/expo/modules/video/player/VideoPlayer.kt)
- expo-video `contentFit` maps directly to `playerView.resizeMode` (`toResizeMode()`); scaling is handled by media3's `AspectRatioFrameLayout`, so `contain`/`cover`/`fill` differ only in layout math, not decode cost. — [expo-video VideoView.kt](https://github.com/expo/expo/blob/main/packages/expo-video/android/src/main/java/expo/modules/video/VideoView.kt)
- Preloading pattern in expo-video: create a second player (or `replace()` a null-source player) so it "fills buffers independently"; once attached to a VideoView it starts "without additional buffering delays." — [Expo video docs](https://docs.expo.dev/versions/latest/sdk/video/)
- Mounting multiple VideoViews with the *same* VideoPlayer simultaneously does not work on Android ("platform limitation" — black screens). — [Expo video docs](https://docs.expo.dev/versions/latest/sdk/video/); [Expo blog](https://expo.dev/blog/expo-video-a-simple-powerful-way-to-play-videos-in-apps)

### Inferences
- For 6-10 live tiles on a 3-4 GB phone, set per-tile `bufferOptions` ≈ `{ preferredForwardBufferDuration: 4-6, minBufferForPlayback: 1, maxBufferBytes: 5-10 MB }` instead of the 20 s default — 10 tiles × 20 s of HLS buffer is both memory and radio churn. For live streams a short forward buffer also keeps tiles near the live edge.
- Since expo-video exposes no track-selection API from JS, the zero-patch way to cap decode cost per tile is server/URL-side: hand tile players the low-rendition **media** playlist URL directly (bypassing ABR), and only the expanded player gets the master playlist. A one-line native patch alternative: add `setViewportSize`/`setMaxVideoSize` defaults in `VideoPlayer.kt` via patch-package or a config-plugin fork.
- Disabling audio per tile needs the same native patch (`setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true)` on muted players) — worth it: it frees ~1 AAC decoder per tile and the associated audio pipeline on MediaTek. Alternative zero-patch: serve a video-only rendition for wall tiles.
- Pausing an off-screen expo-video player keeps its MediaCodec instances; only `release()` (or pool hand-back with the source replaced) frees decoders. Budget decoders by *created-and-prepared players*, not by *playing* players.

### Gaps
- expo-video JS API surface for track selection (`videoTrack`/`availableVideoTracks`) exists in recent SDKs but no evidence found that it allows *constraining* selection (max size/disable type); treat capping as not exposed without a native patch — verify against SDK 57 types.
- Exact `VideoPlayerLoadControl` defaults (beyond the documented 20 s / 2 s) not fetched; read `android/src/main/java/expo/modules/video/player/VideoPlayerLoadControl.kt` in the expo repo if exact mins/maxes matter.

## Q4. MediaTek decoder exhaustion: what happens, how to detect/limit

### Takeaway
Concurrent codec limits are declared per-codec by the OEM in `/etc/media_codecs.xml` (`<Limit name="concurrent-instances" max="N"/>`); exceeding them yields `MediaCodec.CodecException` `ERROR_INSUFFICIENT_RESOURCE` (or the resource manager reclaims a codec from a lower-priority client). Crucially, expo-video builds ExoPlayer with `setEnableDecoderFallback(true)`, so on failure it silently falls back to the software decoder — on a weak MediaTek that means several c2.android.* decoders eating the CPU rather than a visible error. Detect the budget up front with `CodecCapabilities.getMaxSupportedInstances()` and never create more prepared players than that.

### Cited Findings
- OEMs declare per-codec concurrency with `<Limit name="concurrent-instances" max="X"/>` in `media_codecs.xml`; CTS `testGetMaxSupportedInstances` enforces that the declared maximum is real. `CodecCapabilities.getMaxSupportedInstances` "returns the maximum number of supported concurrent codec instances" (API 23+). — [AOSP: OEM dependencies for media resource manager](https://source.android.com/docs/core/media/oem); [media3 EncoderUtil reference](https://developer.android.com/reference/androidx/media3/transformer/EncoderUtil)
- `MediaCodec.CodecException.ERROR_INSUFFICIENT_RESOURCE`: "a required resource was not able to be allocated"; the exception exposes `isTransient()` (retry later) and `isRecoverable()` (stop/configure/start again). — [MediaCodec.CodecException reference](https://developer.android.com/reference/android/media/MediaCodec.CodecException)
- Single/limited-decoder devices (entry-level mobiles listed among affected hardware): initializing a player beyond the limit means "the device refuses the request, which results in failed playback or a black video surface." Recommended: destroy before creating, reuse one instance via load/replace, never run more instances than the hardware supports. — [Bitmovin: single-decoder device limitations](https://developer.bitmovin.com/playback/docs/understanding-single-decoder-device-limitations)
- expo-video enables `setEnableDecoderFallback(true)` on its `DefaultRenderersFactory` — ExoPlayer will fall back to a lower-priority (software) decoder when the primary decoder fails to initialize. — [expo-video VideoPlayer.kt](https://github.com/expo/expo/blob/main/packages/expo-video/android/src/main/java/expo/modules/video/player/VideoPlayer.kt)
- Anecdotal field report of the failure mode at scale: beyond ~15-20 simultaneous players, additional players silently produce no output. — [Kodular community thread](https://community.kodular.io/t/if-we-use-more-than-15-20-players-the-sound-will-not-play-on-the-rest-of-the-players-is-it-a-bug/178278) (low-authority forum; treat as anecdote)

### Inferences
- The dangerous path on the void's MediaTek clones is not a crash but *silent software fallback*: decoder-init failure → c2.android.avc.decoder on the CPU → thermal throttle → the whole wall stutters. Watch logcat for `MediaCodecVideoRenderer`/`DecoderInitializationException` and for tiles decoding on `c2.android.*`/`OMX.google.*` instead of `OMX.MT*`/`c2.mtk.*` — that string check is the cheapest runtime detector of an exceeded budget.
- Proactive budget: at startup query `MediaCodecList` → find the hardware AVC/HEVC decoder → `getCapabilitiesForType().getMaxSupportedInstances()` → wall's max prepared players = that number minus 1-2 (reserve for the expanded player and for the OS; Android 12+ resource manager can also reclaim codecs from you for higher-priority/foreground users). In RN this needs a ~30-line native module or a one-off `adb shell` check per device class since expo-video doesn't expose it.
- Each expo-video player with an audio track consumes a *video and* an *audio* codec instance; audio instances are plentiful but not free. Count hardware video decoder instances as the budget unit.
- Resolution interacts with the count: many SoCs budget decoder sessions by total macroblock throughput, not just instance count, so 10×240p sessions may fit where 10×720p will not — capping tile rendition (Q3) directly raises the usable instance count. (Inference; no fetched source quantifies MediaTek session budgeting.)

### Gaps
- No public MediaTek documentation found for per-SoC concurrent decoder counts (the `media_codecs.xml` values differ per device; dump `/vendor/etc/media_codecs.xml` from the actual test phones via adb for ground truth).
- The counterfeit "S25"/"S22" phones may ship firmware with wrong/missing `concurrent-instances` declarations, making `getMaxSupportedInstances()` unreliable there; empirical ramp-up testing (add players until init fails or falls back) is the only trustworthy measure on clones.

## Q5. Scroll-time behavior: pause vs run, avoiding player-creation jank

### Takeaway
Never create, prepare, or release players during active scroll — expo-video constructs ExoPlayer on the main looper, and releases also land on the main dispatcher, so both are scroll jank. Pre-create the pool at idle, pause (not release) tiles leaving the viewport during fling and defer the real recycle until scroll settles. Reddit prepares players *before* visibility; Android 14's surface-lifecycle change exists precisely because SurfaceView attach/detach in scrolling UIs delays playback.

### Cited Findings
- expo-video builds its ExoPlayer with `setLooper(context.mainLooper)` — construction happens on the main thread; `release()` runs via `GlobalScope.launch` on the main dispatcher. — [expo-video VideoPlayer.kt](https://github.com/expo/expo/blob/main/packages/expo-video/android/src/main/java/expo/modules/video/player/VideoPlayer.kt)
- Any main-thread work over ~16 ms during scroll is visible jank; recommended pattern is a single reused player set / pooled instances and pausing players during scroll events. — [kotlinlang Slack archive on LazyColumn+ExoPlayer](https://slack-chats.kotlinlang.org/t/509130/i-m-still-having-issues-with-lazycolumn-and-exoplayer-with-c); [Uptech blog](https://www.uptech.team/blog/how-to-play-multiple-videos-using-the-recyclerview-and-exoplayer)
- Reddit: prewarm (prepare + first-segment decode) happens while the item is "part of a LazyColumn… but not yet visible on screen"; recycled items return players to the pool rather than destroying them. — [Reddit techniques article](https://proandroiddev.com/taking-exoplayer-further-reddits-performance-techniques-f426fdafb471)
- Android 14 `PlayerView` switched SurfaceView to `SURFACE_LIFECYCLE_FOLLOWS_ATTACHMENT` "to avoid delayed playback in scrolling UIs." — [media3 surface docs](https://developer.android.com/media/media3/ui/surface)
- expo-video attach/detach is cheap relative to creation: `attachPlayer()` calls `videoPlayer?.changeVideoView(this)`; detach fires `VideoManager.onVideoPlayerDetachedFromView` and swaps listeners. A detached player keeps running (background audio continues unless configured otherwise), enabling instant re-attach. — [expo-video VideoView.kt](https://github.com/expo/expo/blob/main/packages/expo-video/android/src/main/java/expo/modules/video/VideoView.kt); [Expo video docs](https://docs.expo.dev/versions/latest/sdk/video/)

### Cited Findings (live-HLS specific)
- expo-video preload pattern (player created with source while off-screen buffers independently) is the documented way to have a tile ready before it's visible. — [Expo video docs](https://docs.expo.dev/versions/latest/sdk/video/)

### Inferences
- Concrete scroll policy for the wall (RN): on scroll-begin, `player.pause()` tiles (cheap, main-thread-light), keep surfaces attached; on scroll-end (`onMomentumScrollEnd` + debounce), diff visible tiles vs pool assignment, `replace()` sources on pooled players for newly visible tiles, resume. Do source swaps one per frame (`InteractionManager.runAfterInteractions` / `requestAnimationFrame` queue) rather than all at once — each `replace()`+prepare costs main-thread time in expo-video.
- Keep decoding while *slow*-scrolling (tiles stay live, feels alive), but hard-pause on fling velocity above a threshold — during a fast fling nobody can see tile content, and freeing the decode/render work is what keeps the fling at 60 fps on a weak GPU.
- A detached-but-playing player (video decoder running with no surface) still burns a decoder and CPU. For tiles that scroll far off-screen, don't just detach the view — pause the player, and reclaim it to the pool. Keep "detached but running" only for the 1-row-ahead prewarm set.
- Because releases are also main-thread, shrink the pool (release players) only at true idle (screen blur, app background), never mid-scroll.

### Gaps
- No source measured expo-video `createVideoPlayer` wall-clock cost; measure on-device (expect tens of ms on low-end: ExoPlayer build + renderer/codec init). The scroll policy above assumes it's too slow for scroll-time; validate with systrace/Perfetto once.

## Q6. expo-video specifics: known issues, bufferOptions, view-detach semantics

### Takeaway
expo-video supports the pool architecture well: players are independent of views (`createVideoPlayer` + manual `release()`), `replace()` swaps sources on a live player, detach/re-attach is instant-ish (listener swap + surface rebind), and `bufferOptions` is the one real per-player memory knob. Known Android sharp edges: one player cannot feed two mounted views, overlapping SurfaceViews need `textureView`, surfaceType is create-time-only, and there is no JS access to track selection, audio-renderer disabling, or decoder info — those need native patches.

### Cited Findings
- `createVideoPlayer` instances "don't auto-release when components unmount," requiring manual `release()`; `useVideoPlayer` auto-releases on unmount. — [Expo video docs](https://docs.expo.dev/versions/latest/sdk/video/)
- "Mounting multiple VideoView components at the same time with the same VideoPlayer instance will not work due to a platform limitation" (Android; black screens). — [Expo video docs](https://docs.expo.dev/versions/latest/sdk/video/); [Expo blog](https://expo.dev/blog/expo-video-a-simple-powerful-way-to-play-videos-in-apps)
- One player ↔ many views over time is supported: `currentVideoView` tracks the active view; switching detaches the old view and attaches the new via the attach/detach lifecycle (the basis for tile→fullscreen handoff without re-prepare). — [expo-video VideoView.kt](https://github.com/expo/expo/blob/main/packages/expo-video/android/src/main/java/expo/modules/video/VideoView.kt)
- `bufferOptions` must be assigned as a whole object ("Setting individual buffer properties is not supported"). Android fields/defaults: forward buffer 20 s, min-for-playback 2 s, maxBufferBytes 0 (auto), prioritizeTimeOverSizeThreshold false. — [Expo video docs](https://docs.expo.dev/versions/latest/sdk/video/)
- `contentFit` is pure `resizeMode` mapping (no decode-side cost difference). — [expo-video VideoView.kt](https://github.com/expo/expo/blob/main/packages/expo-video/android/src/main/java/expo/modules/video/VideoView.kt)
- Known Android feed problems in the wild with expo-video: random tile flicker/flash when swiping in a TikTok-style feed (SDK 54). — [Cursor forum thread](https://forum.cursor.com/t/need-architectural-review-android-expo-video-flicker-in-tiktok-style-feed/164359)
- Older expo-av guidance (pre-expo-video) for the same class of problem: prevent invisible players from being instantiated at all (ViewPager instantiated off-screen players). — [Expo forums](https://forums.expo.dev/t/expo-av-load-encountered-an-error-the-onerrorlistener-was-called-with-what-code-1-and-extra-code-2147483648/29476)
- expo-video sets `forceEnableMediaCodecAsynchronousQueueing()` (async MediaCodec mode, better pipeline behavior) and `showNowPlayingNotification`-related multi-player fixes have landed; many-simultaneous-player support is comparatively recent and lightly documented. — [expo-video VideoPlayer.kt](https://github.com/expo/expo/blob/main/packages/expo-video/android/src/main/java/expo/modules/video/player/VideoPlayer.kt); [Expo blog](https://expo.dev/blog/expo-video-a-simple-powerful-way-to-play-videos-in-apps)

### Inferences
- Recommended architecture for the void wall, all expo-video-native:
  1. Module-level pool of N `createVideoPlayer(null)` instances (N from Q4 budget, e.g. 4-6 on the MediaTek clones), created one per frame after first paint.
  2. Each pool player gets `muted=true`, `bufferOptions={preferredForwardBufferDuration:4, minBufferForPlayback:1, maxBufferBytes:8*1024*1024}`, `showNowPlayingNotification=false`, `staysActiveInBackground=false`, source = low-rendition media-playlist URL.
  3. Tiles are `VideoView surfaceType="textureView"` + poster image underneath; a tile *acquires* a pool player when visible, `replace()`s the source, and the poster hides on `onRenderedFirstFrame`-driven state (expo-video does the surface-hiding automatically).
  4. More visible tiles than pool players → the overflow tiles keep posters (or rotate live slots round-robin every few seconds).
  5. Tap-to-expand: hand the tile's player to the fullscreen `VideoView` (`surfaceType="surfaceView"`), un-mute, and `replace()` to the master playlist for ABR.
- Native patch shortlist (patch-package on expo-video, each ~1-5 lines in `VideoPlayer.kt`): `setTrackTypeDisabled(AUDIO)` when muted; `setViewportSize`/max-video-size default; expose `getMaxSupportedInstances()`; optional `DefaultRenderersFactory` without audio renderers for wall players.

### Gaps
- No authoritative expo GitHub issue found that benchmarks many simultaneous expo-video players (search surfaced forum/Cursor anecdotes, not a canonical tracked issue); Medium-hosted deep dives (Reddit, Compose pooling articles) returned HTTP 403 so pool-size rationale beyond the search-snippet quotes could not be verified against full text.
- Whether expo-video SDK 57 ships media3's `PlayerPool`/preload-manager integration: not found in docs; assume not and pool in JS.
