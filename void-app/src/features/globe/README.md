# Globe tab + live wall (native port)

Owner: Agent C. Covers `src/features/globe/` and `src/features/live/`.
Source of truth: `void2-final.html` (initGlobe/animate, setGlobeMode, the LIVE CONNECTION ENGINE,
GLOBE WORLD-WALL, TAP-FOR-SOUND, ytVeil/ytShadow) and `design_handoff_void_patch3/README.md` §5.
Nothing here has run on a device yet. It was written against the expo-video, expo-gl and
react-native-webview APIs for SDK 57 and checked only for syntax (the TypeScript parser).
The first type check will be A's EAS preview build.

## Wiring (Agent A)

```tsx
// app/_layout.tsx: once, above every surface that plays audio
import { AudioOwnerProvider } from '../src/features/live';
<GestureHandlerRootView style={{flex:1}}><AudioOwnerProvider>…</AudioOwnerProvider></GestureHandlerRootView>

// app/(tabs)/globe.tsx
export { default } from '../../src/features/globe/GlobeScreen';   // prop: bottomInset (nav pill), default 58
```
Tapping a country calls `router.push('/nation/<ISO>')`, using `Country.iso` as stored (upper case).

## Dependencies these files import
`three`, `expo-gl`, `expo-asset`, `expo-video`, `react-native-webview`, `react-native-reanimated`,
`react-native-gesture-handler`, `expo-haptics`, `expo-blur`, `expo-router`, **`react-native-svg`**
(speaker badge, search/close icons), **`@react-native-async-storage/async-storage`** (`void_globe_mode`,
`v_grid3`). The last two are not on the brief's list, so please add them.

## Core contract (Agent B), read only through `src/features/live/core.ts`
| export | signature |
|---|---|
| `streams.wallSlots` | `() => { name: string; src: StreamSource; kind?: 'life'\|'news' }[]` (3 life : 7 news) |
| `streams.wallCascadeFor` | `(name: string, first: StreamSource \| null) => StreamSource[]` (≤3) |
| `streams.streamKey` | `(src) => string` (falls back to the web formula) |
| `streams.liveVidFor` | `(src) => string \| null \| undefined` (undefined = not confirmed live, so the source is refused) |
| `streams.markBadStream` / `isBadStream` | optional; otherwise `badStreams: Set<string>`; otherwise a local set |
| `streams.rememberStream` | optional (session "used" memory that `wallSlots` sinks) |
| `data.C` | `{ n, iso, lat, lon }[]` |
If B's names differ, change `core.ts` only.

Shared UI (Agent A) is also read defensively: `ui/SparkleLoader` (`SparkleLoader` or default, props `{label?, style?}`,
fills its parent), `ui/Toast` (`voidToast` / `showToast` / `toast` / default fn / `.show`), `theme/tokens.useTheme()`
(`colors.{bg,card,border,glow,gold,white,dim,muted,red,navDim}`, `fonts.{mono,sans}`; falls back to the VOID palette
and `SyneMono_400Regular` / `Syne_400Regular`).

## Component tree
```
GlobeScreen                          #screen-globe (dual mode)
├─ GestureDetector(Pan)              initGlobeSwipe (22% commit, horizontal only)
│  ├─ Animated.View  ReelsView       #globe-reels-view  (PLACEHOLDER slot: props {active})
│  └─ Animated.View                  #globe-map-view
│     ├─ GlobeCanvas                 #globe-canvas-wrap  h = clamp(240, 42vh, 320)
│     │  ├─ GestureDetector(Manual) → GLView → globeScene (three.js)
│     │  ├─ #gtip tap label · #globe-search-icon · .globe-hint-line
│     │  └─ GlobeSearch              #globe-search-modal
│     └─ LiveWall                    #globe-live-grid (ScrollView, not virtualized)
│        ├─ header                   .gl-grid-label (LiveDot + LIVE FEEDS + hairline)
│        └─ WallTile ×N              .gl-tile (absolute; order = connection order)
│           ├─ StreamTile            attemptSource (one source) → Hls/YouTube/Mjpeg/Iframe player
│           ├─ TileLoader            sparkleTile '● CONNECTING' / '● RETRYING' / '● NO SIGNAL'
│           └─ TileLabel             '● COUNTRY · LABEL'
└─ GlobeModeToggle                   .gmode-toggle
AudioOwnerProvider (app root)        _audioCell + the hidden YouTube shadow WebView
```

## Web → native mapping
| web | native |
|---|---|
| `initGlobe` scene, lights, materials, sprites | `globe/globeScene.ts` `createGlobeScene` |
| `animate` (dt, idle governor, inertia, zoom easing, marker pulse) | `globeScene.frame` |
| touchstart/move/end, pinch, tap (<12px, <280ms) | `GlobeCanvas` `Gesture.Manual` |
| `handleHover` + `#gtip` | `globeScene.hover` + tap label in `GlobeCanvas` |
| `mkTex`, `_fallbackEarth`, `TextureLoader` | `globe/textures.ts` |
| `openCountry` | `router.push('/nation/<iso>')` |
| `openGlobeSearch/searchGlobe/closeGlobeSearch` | `globe/GlobeSearch.tsx` |
| `setGlobeMode`, `void_globe_mode`, toast | `GlobeScreen.setMode`, `persist.ts` |
| `setGlobeOffset/clearGlobeOffset/initGlobeSwipe` | `GlobeScreen` reanimated pan |
| `buildGlobeGrid`, `loadWallBatch`, `wallFillCount`, `wallSentinelNear` | `live/LiveWall.tsx` |
| `spawnWallTile`/`connectWallCell`/`tagWallCell` | `LiveWall.WallTile` + `live/useStreamCascade.ts` |
| `healWallCell`, `wallHealVisible`, watchdog `setInterval(2500)` | `LiveWall` watchdog + `WallEntry.heal` |
| `attemptSource` | `live/StreamTile.tsx` (+ `refuseInstantly` in `useStreamCascade.ts`) |
| `claimLiveKey/releaseLiveKey`, `CONNECT_TIMEOUT`, `EMBEDDABLE_IFRAME`, `IFRAME_PLAYER_URL`, `YT_DEAD_CODES`, `liveUrl`, YT_CLEAN | `live/constants.ts` |
| `ytVeil` | `StreamTile › YouTubePlayer.veil` |
| `ytShadowStart/ytShadowStop`, 5s fallback | `live/AudioOwner.tsx` |
| `toggleStreamAudio/streamSetAudio/silenceOtherMedia/releaseStreamAudio` | `AudioOwner.toggleStream/claimAudio/releaseStream` |
| `liveNudgePlay`, `liveWakeVisible`, visibilitychange/pageshow | `StreamTileHandle.nudge`, `LiveWall` AppState effect |
| `.audio-on` ring + `::after` speaker | `TileChrome.AudioRing` |
| `tileLabel`, `.strip-live-dot`, `sparkleTile`, `.yt-hold` | `TileChrome.tsx` |

## Assumptions and deviations (where 1:1 wasn't possible)
1. **Off-air test-bars detection (`frameVerdict`, `checkTileSignal`) is skipped.** expo-video gives no access to
   decoded pixels. `generateThumbnailsAsync` returns a native image ref with no pixel data, and it can't read live
   HLS on iOS. Bars or slate feeds will count as connected. The YouTube dead-code marking (100/101/150/153) still works.
2. **Lighting and colour on three ≥ r155.** The web runs three r128. To produce the same pixels, colour
   management is turned off, output stays linear, light intensities are multiplied by π, and the rim point light
   uses decay 0 × 0.933 to match r128's linear cutoff at the globe's distance. On three < r155 the original numbers
   are used as-is. This is written against three's docs, not checked side by side on a device.
3. **MSAA.** iOS uses `GLView msaaSamples={4}`. expo-gl on Android has no multisampling, so edges there are
   aliased. `precision: 'highp'` is kept.
4. **Resolution.** GLView renders at full device DPR (the web capped it at 2×). Point, sprite and marker sizes
   match in CSS px. The ~30fps idle governor is kept.
5. **60fps target.** The render loop runs on the JS thread (three.js can't run in a worklet). Heavy WebView
   message traffic from the wall competes with it. Each YouTube tile posts one info message per second.
6. **Hover.** A touch screen has no hover. As in mobile web (emulated mouse events), a tap lights the marker,
   shows `#gtip` at the finger (+14,+10) and opens the nation. The label clears on the next touch.
7. **Memory guard (native only).** The web never pauses or unmounts wall tiles. Here:
   - HLS tiles more than `PARK_SCREENS`=3 viewports away are paused, and so are all HLS tiles while the wall is
     hidden. They resume in place with no remount.
   - YouTube tiles keep playing muted.
   - When more than `MAX_MOUNTED_WEBVIEWS`=18 YouTube/iframe players are mounted, the farthest ones beyond
     `EVICT_SCREENS`=5 are unmounted. They reconnect to the same source first once within 3 screens.
   - Tiles on screen or nearby are never touched.
8. **MJPEG.** RN `Image` can't decode multipart MJPEG, so the URL is re-fetched as a snapshot every 1s, with a
   cache-buster and no blank frames between.
9. **YouTube embed.** Each tile is its own WebView with the exact web embed `src`. It loads under
   `baseUrl https://thevoid.app/` (`YT_ORIGIN`) to satisfy YouTube's origin/Referer check. The IFrame API
   attaches to that iframe. WebViews have pointerEvents none, so taps land on the tile.
10. **Shadow audio.** The shadow is a hidden WebView at 1% opacity, kept on screen, because some OS versions
    won't play media in a fully transparent or off-window view.
11. **Grid layout.** Absolute positioning, 16:9 tiles, gap 6, padding 10. There is no FlatList: recycling would
    remount players. `grid3` comes from AsyncStorage `v_grid3`. The web mobile build hardcodes 2-wide.
12. **Label gradient.** It uses RN 0.86 `experimental_backgroundImage` (New Architecture). If a platform
    ignores it, the gold text still sits over the video.
13. **WebGL1 guard.** three ≥ r163 rejects WebGL1. `WebGLRenderingContext` is hidden while the renderer is
    constructed, because expo-gl's context can pass that check. Devices without GLES3 aren't supported by modern three.
