# Reels: the immersive viewer engine (native port)

Source of truth: `void2-final.html`: `vwFill`, `vwItemHtml`, `vwObserve`, `vwAttach`, `vwWarm`,
`vwRelease`, `vwPlay`, `vwPause`, `vwClearLoad`, `vwFire`, `vwReact`, `vwLess`, `vwShare`, `vwFollow`,
`react`, `repost`, `fillGlobeReels`, `stopGlobeReels`, `openReel`, `openNationReel`, `closeReel`,
`vwAudioPill` / `au*`, and the VMod `vwItemHtml` wrapper (⋯ menu, graphic veil, author sheet). The CSS
comes from `.vw-*`, `.greel-*`, `#reel-overlay` / `.reel-*`, `.au-*` and `.vmod-*`, using the
`pointer:coarse` values. The design reference is patch3 §5 (ref 4d) and §6.C.
Nothing here has run on a device. The files were checked only with the TypeScript parser, because
node_modules is not installed.

## Files
| file | what |
|---|---|
| `ReelsView.tsx` | **default + named export** `ReelsView` `{active, nation?, postId?, overlay?, onClose?}` |
| `ReelItem.tsx` | one card: cover, media, scan, rail, info row, spine, bolt burst, graphic veil |
| `ReelVideo.tsx` | expo-video player per card (attach / warm / play / pause / clear the loader) |
| `ReelAudioPill.tsx` | `.au-pill` for `style:'audio'` cards |
| `ReelModSheet.tsx` | ⋯ menu, author sheet, report, block/hide, mute a keyword (UI over `core/api/moderation`) |
| `reelStore.ts` | `postReactions`, `toggleBolt`/`toggleRepost`/`toggleFollow` (optimistic + rollback), queue seeding |
| `ModIcons.tsx` | the moderation glyphs `more / flag / block / mute / eyeOff` |
| `useSafeClaimAudio.ts` | `useClaimAudio()` that returns null when there is no `AudioOwnerProvider` |

## Wiring
```tsx
// Globe tab, REELS mode. GlobeScreen currently imports the placeholder at
// src/features/globe/ReelsView.tsx; point it here (or re-export from there):
import ReelsView from '../reels/ReelsView';
<ReelsView active={reelsVisible} />                      // inline: sub-caption, rail at 110px

// app/reels.tsx  (/reels?nation=JP&post=<id>)
const { nation, post } = useLocalSearchParams<{ nation?: string; post?: string }>();
const focused = useIsFocused();
<ReelsView active={focused} nation={nation} postId={post} />   // overlay chrome, rail at 130px
```
- `nation` accepts an ISO code or a country name. The pool is posts whose `_region` / `iso` match the
  resolved code or whose `country` matches the name. `openNationReel` then takes the start post (`post`
  or the pool's first), the next 5 from the pool, and `vwFill(4, true)`.
- `postId` without `nation` is `openReel(postId)`. The tapped video is seeded first. If the pool is thin
  (`reelPosts.length < 8`), the view awaits `pullReelPage()` and then appends `vwFill(5)`.
- With neither, the view is `fillGlobeReels()`: `vwReset()` then `vwFill(6, true)`. If nothing comes
  back it shows `PULLING SIGNAL…` and fills on the next `onPostsChanged('reels'|'feed')`. The cards are
  kept when the view goes inactive and becomes active again, as on the web, which only re-observes them.
- `overlay` defaults to `!!nation || !!postId`. The back button calls `onClose` or `router.back()`.

## Engine behaviour (web parity)
- **Paging:** one full-height card per page (`snapToInterval=h`, `disableIntervalMomentum`), with a
  viewability threshold of 50% (`IntersectionObserver threshold .5`).
- **Card in view:** the counter shows `n / ∞`, `vwBump(tags, .3)` records dwell, the spine fills over
  6s, and the video plays.
- **Buffering window:** a player is mounted for every card within 2 of the current one. The next two
  cards buffer without playing (commit 1577dfb), and a card further away is released and shows its
  `poster` (`_img`).
- **Loader:** the sparkle loader stays over a video until `readyToPlay` or `playing`, and also clears on
  `error`, so a loader never spins forever. Once cleared it stays cleared for that card.
- **Infinite queue:** when fewer than 3 cards remain below, `vwFill(4, true)` appends 4 more. `vwFill`
  only admits video, respects the lanes and tops up `pullReelPage()` itself, and the REEL_BLOCK gates
  apply inside `pullReelPage`. If the pool is dry, the next `reels` event appends.
- **Rail:** bolt (gold, count = score + your flip) runs `react(fire)` + `vwBump(1.5)`. Reply opens
  `/thread/<id>`. Repost moves `p.reposts`. Share goes to the share sheet and then `VoidAPI.share`. LESS
  (dim) runs `vwBump(-2.5)` and scrolls to the next card. Bolt, repost and follow are optimistic through
  `VoidAPI` with the `SIGNAL LOST · RETRY` rollback toast, and add light haptics.
- **Double tap:** anywhere on the media, double tap does `vwFire` and shows the 84px bolt burst (.7s).
- **Info row:** the avatar and name open the author sheet (`VMod.author`). FOLLOW / FOLLOWING is
  mirrored on every card by the same author. ⋯ appears when `!p._user`. The caption is clamped to 3
  lines, and MORE / LESS appears after 150 chars (open = 48% of the window, scrollable). Meta shows
  `COUNTRY · ago · SWIPE ↑`. No tag chips (patch3 §9).
- **Moderation:** hidden posts are filtered out when a card is admitted and after every report, block or
  mute (`sweep`). Graphic posts get the veil and blur when `graphicVeilOn()`, and the first tap on the
  media reveals them.
- **Dark surface:** the view stays dark in every theme. Only `--gold` (MORE), `--nav-dim` (sub-caption)
  and `--muted` (empty text) follow `useTheme`, as the web's `var()`s do.

## Deviations (documented)
- **Tap for sound:** a single tap on a video toggles its sound. The web reel is always muted, because
  browser autoplay policy forbids anything else. Sound goes through `useClaimAudio()`: it takes the one
  audio slot (the live wall's audible tile goes quiet), is dropped when another source claims the slot,
  and is released when the view goes inactive. Double tap still bolts, so single taps wait out the 250ms
  double-tap window.
- **Share:** the web copies `location#pid` to the clipboard. Native opens the OS share sheet with
  `https://void-app-d35c.pages.dev/#<pid>` (`SHARE_BASE` in `reelStore.ts`; this is an assumption,
  change it if the deep-link host differs). No `showPtrFlash`.
- **Audio pill:** it runs the web's 100ms progress ticker, but not `speechSynthesis` read-aloud, because
  no TTS module is installed. Starting it claims the audio slot.
- **`postReactions`:** app-wide on the web, but lives in `reelStore.ts` here because no shared native
  store existed. Feed and thread should import `postReactions` / `toggleBolt` / `toggleRepost` from here,
  or this should re-export theirs, so a bolt on a reel shows on the feed card.
- **Scan lines:** they use `repeating-linear-gradient` through `experimental_backgroundImage`. If RN
  ignores it, the lines are simply absent (they are 1.2% white). The burst glow uses `filter:
  drop-shadow`, which may not render on iOS.
- **Safe area:** the overlay chrome adds `insets.top` (90 + top, padding 16 + top).
- **Graphic blur:** it uses `expo-blur` (intensity 100, dark) plus a 50% black layer to approximate
  `blur(32px) brightness(.5)`.
- **No LIVE streams in the queue:** patch3 §5 says live streams are eligible alongside posts, but the
  shipped web `vwFill` is video posts only, and the code is the source of truth.
- **Nation pool order:** patch3 §6.C describes the nation pool as "ranked by vwScore", but
  `openNationReel` in the web code takes pool order. The code is followed.

## Needs from other agents
- **Agent C / globe:** `GlobeScreen.tsx` must render this `ReelsView` instead of
  `globe/ReelsView.tsx`, the placeholder.
- **Agent A:** wire `app/reels.tsx` as above, and mount `AudioOwnerProvider`. `useSafeClaimAudio`
  degrades to no slot arbitration without it.
- The thread route must resolve reel ids with `findPost(id)`, which covers `reelPosts`.
