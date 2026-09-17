# VOID feed + thread (native port)

Covers `src/features/feed/` and `src/features/thread/`. Source of truth: `void2-final.html`
(renderFeed, renderPost, refreshVoidFeed, autoHideHeader, observeVideos, setupDwellTracking,
quickTranslate, react/repost, au* audio player, carScroll, openThread/closeThread,
renderThreadComments, openReplies/renderReplies, submitComment/submitReply, the VMod block)
and `design_handoff_void_patch3/README.md` §4. CSS px are used 1:1 as dp. Nothing here has run
on a device yet: it was checked with the TypeScript parser, and its calls into `src/core` were
type-checked against core. Expo and React Native types were not available (no `node_modules`).

## Wiring (Agent A: routes and layout)

```tsx
// app/(tabs)/void.tsx
export { default } from '../../src/features/feed/VoidFeedScreen';

// app/thread/[id].tsx
export { default } from '../../src/features/thread/ThreadScreen';

// app/_layout.tsx: the thread must open OVER the launching screen (scrim + FLIP), not as a sheet
<Stack.Screen name="thread/[id]" options={{ presentation: 'transparentModal', animation: 'none',
  contentStyle: { backgroundColor: 'transparent' }, gestureEnabled: false }} />
```
`ThreadScreen` reads `/thread/<encodeURIComponent(id)>` and resolves it with
`findPost(decodeURIComponent(id))`, which also finds reel posts and off-feed search posts. It
closes itself with `router.back()` once its close animation finishes.

The real `AudioOwnerProvider` (features/live) should replace the stub in `app/_layout.tsx`.
Until it does, audio pills still play but cannot silence a live stream.

## Contracts

**`PostCard`** is the default export of `src/features/feed/PostCard.tsx` (also a named export).
```ts
interface PostCardProps {
  post: Post;
  index: number;                       // running list index: highlight on 0, fade stagger, avatar colour, audio seed
  onOpenThread?: (id: string, post: Post) => void;  // default: router.push(ROUTES.thread(id))
  surface?: 'feed' | 'nation' | 'search' | 'profile'; // key for play-on-view, default 'feed'
  style?: StyleProp<ViewStyle>;
}
```
* A hidden post (blocked author, reported, or muted keyword) renders `null`.
* Before `onOpenThread` runs, the card records its window rect, so a caller that pushes the
  thread route still gets the FLIP lift.
* Video autoplay needs visibility data. Any FlatList of cards should pass
  `viewabilityConfigCallbackPairs={usePostViewability(surface)}` (from `features/feed`).
  Without it, videos show their poster and still open the reel on tap. The same hook runs
  dwell learning (`learnDwell`) and sensing impressions.
* The ⋯ menu and author sheet render in the top-most mounted `<ModerationHost/>`.
  `VoidFeedScreen` and `ThreadScreen` each mount one. Any other screen that shows cards
  should mount one too.

**Reactions.** The only reaction store is `features/reels/reelStore.ts` (`postReactions`,
`toggleBolt`, `toggleRepost`, `useReelStoreVersion`). `feed/reactions.ts` is a thin
adapter over it, so a bolt on a reel, a feed card or the thread shows everywhere.

**Photo viewer.** There is no photo route. Whoever builds one should call
`registerPhotoOpener((postId, index) => …)`. Until then, tapping an image or a carousel
slide opens the thread.

## Files
| file | web counterpart |
|---|---|
| feed/VoidFeedScreen.tsx | #screen-void, renderFeed, trimFeedDOM, refreshVoidFeed + #ptr-flash, ensureFeedSentinel, .bio-hud + autoHideHeader, #compose-fab |
| feed/PostCard.tsx | renderPost + the VMod renderPost wrapper, .post-ref rows |
| feed/media/PostMedia.tsx | .post-media image/video, observeVideos, imgLoaded/mediaFailed, the thread OP media slot |
| feed/media/PostCarousel.tsx | .post-car strip, carScroll dots and count |
| feed/media/AudioPill.tsx + audioStore.ts | .au-pill, auToggle/auStop/auPaint/auScrub (expo-audio) |
| feed/media/GraphicVeil.tsx | .vmod-veil, the graphic filter |
| feed/videoStore.ts | shared expo-video player per post id (media continuity) |
| feed/viewability.ts | setupDwellTracking + observeVideos (FlatList viewability pairs) |
| feed/reactions.ts | adapter over reels/reelStore (react fire, repost) |
| feed/translate.ts | quickTranslate / translateThreadBody |
| feed/ModerationSheet.tsx + vmodIcons.tsx | VMod menu, cmenu, author, reportSheet, muteSheet, termsSheet/gate |
| feed/stores.ts | VMod sweep, in-view sets, FLIP hand-off (rect, lifted card) |
| feed/navigation.ts | openReel, openPhoto, openThread guard, switchTab('globe'), openCountry |
| thread/ThreadScreen.tsx | openThread/closeThread (FLIP, pop-in, scrim), OP CTA card, divider + TOP/NEW, deck, submitComment |
| thread/CommentCard.tsx | _tcCard, stack edges, tcDealIn/tcDealOut |
| thread/ReplyOverlay.tsx | #reply-overlay, openReplies/closeReplies/renderReplies, submitReply |
| thread/ComposePill.tsx | .thread-compose |
| thread/threadModel.ts | _tcTree, _tcSort, void_thread_sort, _threadAddReply behind the terms gate |
| thread/threadTheme.ts | --tc-* tokens (color-mix per theme, LIGHT overrides) |

## Deviations (and why)
1. **FLIP.** The web moved the DOM node. Native uses a measured overlay instead: the card
   records `measureInWindow`, and the thread measures its OP card and animates translate
   and scale from the card's rect over 300ms (`cubic-bezier(.32,.72,.28,1)`, peaking at
   1.02 scale at 78%). Box shadows cannot be interpolated, so the gold ring and deep
   shadow are an overlay layer whose opacity peaks at 78%, and the resting shadow fades in
   under it. Close re-measures the card. If the card is still on screen, the OP flips back
   onto it; otherwise the OP fades and drops 12px. On Android with a translucent status
   bar, window coordinates may be off by the inset. Check this on a device.
2. **Media continuity.** A native video view cannot be reparented. The feed card and the
   thread OP call `useSharedPlayer(post.id)` and get the same expo-video player, so
   position and play state carry over. While a card is lifted it unmounts its `VideoView`,
   so only one view uses the player at a time. It re-attaches on close. Audio pills are
   keyed by post id in one store, so the thread shows the same playback. A carousel in the
   thread is a new strip that starts on slide 1. The web moved the strip and kept its
   scroll position.
3. **Deal animation.** `tcDealIn` is a 460ms timing curve with the same overshooting
   bezier (.34,1.32,.64,1), not a physics spring. A card rendered part-way through the
   deal window runs a shorter deal instead of seeking into the keyframes.
4. **Graphic veil on video.** CSS blurred a playing `<video>`. Native blurs the poster
   (`blurRadius` 32 plus a 50% dark layer) and does not start the player until the viewer
   taps to reveal.
5. **Audio with no source.** The web read the post aloud with `speechSynthesis`. There is
   no TTS module in this build, so the pill runs its timer and wave silently. Scrubbing
   also seeks a live player. The web only moved the head.
6. **Pull-to-refresh.** This uses `RefreshControl` with a transparent spinner. The
   sparkle "REFRESHING" wash is `SparkleLoader` on rgba(3,1,10,.85), so its label is 7px
   instead of 9px and its 14 particles are not the web's 20.
7. **Windowing.** The FlatList virtualizes. On top of that, the data window keeps
   `FEED_WINDOW` (90, trimmed after 30 more): dropped ids leave `_rendered` and go to
   `markEvicted`. `maintainVisibleContentPosition` stands in for the spacer div.
8. **Blur.** The thread scrim's `blur(3px)` is an `expo-blur` BlurView (intensity 10) on
   iOS only. Android gets the flat rgba(2,1,8,.7) scrim.
9. **Thread compose.** The attach button (image data URL attached to a local comment) is
   not ported. The pill has only the avatar, input and send orb.
10. **Retry after fediverse failure.** "REPLIES DIDN'T ARRIVE · TAP TO RETRY" needs
    `_fediFailAt`, which core does not export. The deck shows "BE FIRST TO ENTER THE
    THREAD" in that case.
11. **Inline badges.** The translated badge and the OP chip are nested Text, so they have
    a background tint but no border or radius.
12. **LIGHT theme highlight (parity note).** The web applies `.post.highlight`, a gradient
    ending in rgba(13,8,32,.9), in every theme. It is kept as is, so the first card is
    dark in LIGHT too. This looks like a web bug. Ask design before changing it.
13. **Share.** `vwShare` copied a link. The thread's share action opens the native share
    sheet with `sourceUrl`, `_url`, or `https://void-app-d35c.pages.dev/#<id>`, then calls
    `VoidAPI.share`.
