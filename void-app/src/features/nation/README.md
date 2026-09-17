# Nation screen (native port)

Owner: nation agent. Covers `src/features/nation/`.
Source of truth: `void2-final.html`. That means `#c-overlay`, `.c-overlay-head`, `.cn-cta-head`, `.nation-hero*`, `.nh-*`,
`.nation-card*`, `.nc-*`, `.cn-feed-lbl`, `.nf-status`, `.nf-more`, and the functions `openCountry`, `renderNationCTA`,
`loadCountryLiveGrid`, `loadCountryFeed`/`nationFeedPull`/`nationBindScroll`, `closeOverlay` and `nationThreadWarmBind`.
The design spec is `design_handoff_void_patch3/README.md` §6 (7e). Where the handoff mock and the web CSS disagree
(the mock is ×1.4 scale), the web CSS wins, as §6.A says.

Nothing here has run on a device. The only check so far is the TypeScript parser (syntax).

## Wiring (Agent A)
```tsx
// app/nation/[iso].tsx
import { useLocalSearchParams } from 'expo-router';
import NationScreen from '../../src/features/nation/NationScreen';
export default function NationRoute() {
  const { iso } = useLocalSearchParams<{ iso: string }>();
  return <NationScreen iso={String(iso ?? '')} />;
}
```
- The screen needs `<AudioOwnerProvider>` from `src/features/live` above it. `app/_layout.tsx` still has a stub, and
  with the stub `useAudioOwner()` throws.
- The screen draws its own background skin, so give the route a transparent `contentStyle` (or leave it as it is).
  The skin is opaque either way.

## Files
| file | web |
|---|---|
| `NationScreen.tsx` | `#c-overlay` + `.c-body` column (FlatList), `openCountry`, `closeOverlay`, `renderNationCTA` trigger |
| `NationChrome.tsx` | `.c-overlay` skin per theme, `.c-overlay-head`, `.pulse-tag`, `.c-close`, `.cn-cta-head`, `.cn-feed-lbl`, `.nf-status` (nfPulse), `.nf-more` |
| `NationHero.tsx` | `.nation-hero`, stage, `.nh-top`/`.nh-badge`/`.nh-kind`, `.nh-cap`, `nationHeroTap` + tap-for-sound |
| `useNationHero.ts` | `loadCountryLiveGrid(c, attempt)`, including the HLS preflight, the 4s `_heroHeal` and the 8/20/45s `retryLater` |
| `NationCards.tsx` | `.nation-cards`, `mountNationCard`, `fmt` |
| `useNationFeed.ts` | `loadCountryFeed`, the `nationFeedPull` wrapper (`.nf-more`), `nationBindScroll`, `nationThreadWarmBind` |

## Contracts used
- core (`src/core/index.ts`): `C`, `regionOf`, `nationStreamSources`, `nationHeroMeta`, `_nationLive`, `noteNationLive`,
  `nationCards`, `createNationFeed`, `nationFeedPull`, `nationFeedOnScroll`, `nationFeedRetryNow`, `closeNationFeed`,
  `NationFeedUI`, `FEDI_REPLY_SOURCES`, `_remoteReplies`, `loadFediReplies`, `moderation.hidden`.
- live: `StreamTile` (`tap()`, `onSettled`, `onNeedsHeal`), `TileLoader`, `LiveDot`, `refuseInstantly`, `rememberStream`,
  `useAudioOwner().releaseStream`.
- A: `useTheme` (`name`, `colors`, `isLight`), `FONTS`, `em`, `RadialFill`, `Card variant="tile"`, `Icon name="x"`.
- feed: `PostCard` is the default export of `src/features/feed/PostCard.tsx`, with props `{ post, index, onOpenThread(id) }`.
  **It did not exist when this was written.**
- Routes: `/thread/<id>`, `/reels?nation=<ISO>[&post=<id>]`, and `/globe` as the close fallback when there is no back stack.

## Deviations (where 1:1 wasn't possible)
1. **Route, not overlay.** `openCountry` becomes `router.push('/nation/ISO')` and `closeOverlay` becomes `router.back()`.
   A different ISO remounts the view (keyed by ISO), which is the web's "everything repopulates for that ISO".
   `liveParkAll()` on open and `liveWakeVisible()` on close belong to the globe wall and are not called here.
2. **Safe area.** `.c-overlay-head` keeps its 20px top padding and adds `insets.top`, because the web page never ran
   under a status bar.
3. **Hero stream claim.** The web `attemptSource` has its `claimLiveKey` call commented out, so the hero drives
   `StreamTile` itself and skips `useStreamCascade`, which claims keys. Otherwise a stream showing on the parked globe
   wall would be refused. The instant refusals (`refuseInstantly`) still apply.
4. **Heal detection.** The web checks `stage.__needsHeal || !stage.querySelector('video,iframe')`. Native uses
   `StreamTile.onNeedsHeal`, or "no attempt mounted".
5. **Hero after the third backoff.** As in the web, when attempt 3 also fails the hero stays visible with the sparkle
   hold and does not retry again.
6. **Speaker badge position.** The web moves `.nation-hero-stage.audio-on::after` to top 12 / right 16. `StreamTile`
   draws `AudioRing` at 7/7, and that position lives in the live feature (Agent C). The ring itself uses radius 0.
7. **Hero tap.** In the web, a document capture-phase click takes the tap for sound only on a PLAYING stage.
   Native does the same: `StreamTile.tap()` runs first, and if it doesn't consume the tap, the reels open.
   The loader has no `onPress`.
8. **Loader label.** `.nation-hero .sparkle-fallback-label{display:none}`, so `TileLoader` gets no label
   (the web shows no SCANNING or CONNECTING text in the hero).
9. **`.nh-play`** is `display:none!important` in the web, so it isn't rendered.
10. **Feed scroll metrics.** `c-body` scrollTop/clientHeight/scrollHeight map to FlatList `contentOffset.y`/layout
    height/content height. The pane height for `need()` is content height minus the measured header height.
    Dealing from the pool is throttled to one per frame (rAF), as in the web. The page-two check for a short
    first page (`scrollHeight < clientHeight*2`) runs inside the 400ms timer instead of before it, because RN
    content size updates only after the appended posts lay out.
11. **Reply warming.** `pointerdown` capture becomes `onTouchStart` on each row wrapper. The IntersectionObserver
    (rootMargin 200px) becomes `onViewableItemsChanged` (1% visible). RN viewability has no margin, so warming
    starts when a row enters the viewport, not 200px before. The queue is still 3 at a time, and each post is
    warmed once. Fediverse sources call `loadFediReplies` directly, the same path `loadRemoteReplies` takes for them.
12. **Moderation.** The web's `renderPost` filtered at render time. Here `hidden()` runs over the dealt posts and
    runs again when the screen regains focus. The core has no moderation change event.
13. **`.nf-status` in the list.** The status line sits in the FlatList footer and shows only while no posts have
    rendered. "RE-SCANNING" is a Pressable that calls `nationFeedRetryNow`.
14. **Radial skin.** `radial-gradient(120% 35% at 50% 0%, …)` is drawn with A's SVG `RadialFill`. The view behind it
    is filled with the 55% stop colour, so there's no bare edge before the SVG paints. DARK is a flat `--bg`.
    `backdrop-filter:blur(18px)` is dropped because the skin is opaque.
15. **Gradients.** CSS `transparent` stops are written as the same RGB at alpha 0 (Android interpolates
    `transparent` through black).
16. **Letter-spacing** is CSS em × font size (`em()`). Sizes are px → dp 1:1.
17. **Card title** clamps to 2 lines with `numberOfLines`. RN has no `overflow-wrap:anywhere`, so long unbroken
    tokens wrap by character only where the platform does.
