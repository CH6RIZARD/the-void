# Search tab (native port)

Source of truth: `void2-final.html`: `#screen-search` markup, `setFilter`, `doSearch`, `renderSearch`,
`liveFeatSlot` / `liveTileSlot` / `liveRow` / `hydrateLiveTiles`, `openSearchPost`, the `.search-*` /
`.filter-*` CSS (the `pointer:coarse` values a phone renders), and the VMod wrappers on `surfaceFree`,
`renderSearch` and `openThread`. patch3 RESCINDS the search restyle (A6), so this is the ORIGINAL screen.
Nothing here has run on a device. The files were checked only with the TypeScript parser, because
node_modules is not installed.

## Files
| file | what |
|---|---|
| `SearchScreen.tsx` | **default export**, the search tab. Sticky head (bar + filter pills) and results |
| `searchModel.ts` | `buildSearch(q, filter) → {sig, blocks}`: the data half of `renderSearch`, plus `FILTERS` |
| `SearchPostCard.tsx` | `.search-post-card` (cover with the orbit loader, head, tag, body/take, meta) |
| `SearchLiveTile.tsx` | `SearchLiveFeat`, `SearchLiveTile`, `SearchLiveRow`: the LIVE NOW tiles on `useStreamCascade` + `StreamTile` |
| `format.ts` | web `fmt`, `ago`, `baseId` (the reels feature uses them too) |

## Wiring
```tsx
// app/(tabs)/search.tsx
export { default } from '../../src/features/search/SearchScreen';
```
The screen pushes `/thread/<encodeURIComponent(id)>` after `openSearchPost(id)` has put the card into
`allPosts` with `_offFeed`, so the thread route can resolve it with `findPost(id)`.

## Behaviour that matches the web exactly
- **Query:** the grid only rebuilds on GO or the keyboard's search key. The web has no debounce and does
  not search while you type, so neither does this screen. A typed query calls `pullSearchQuery(lq)` once
  per query, and its results re-render the screen when they land.
- **Discovery:** `pullSearchDiscovery()` runs once when the screen first mounts, and again from
  `buildSearch` whenever fewer than 24 free cards remain and there is no query. New discovery results
  re-render the screen, but only while the tab is focused (the web checks `activeTab==='search'`).
- **Exclusivity:** `surfaceFree(p, 'search', moderation.hidden)`, and every rendered card is claimed
  with `surfaceClaim(p, 'search')`, so search never shows feed content and hidden or blocked posts never
  appear.
- **Signature:** if the set of cards is unchanged, the screen does not re-render, so the live tiles keep
  playing.
- **Layout:** the pool, boost and sort are the same (BIO tag boost, then score for a query or pool order
  without one). There are 12 cards, with a 2-tile live row after every 4th card at
  `off=(3+floor(i/4)*2)%len`. The LIVE filter shows the featured tile plus three rows. With no cards the
  screen shows `NO SIGNAL`.
- **Filter tap:** the pill highlights immediately and the grid rebuilds on the next frame.
- **Live tiles:** the cascade is `[{type:'youtube', id:<channel>, label:'LIVE'}, ...GLOBAL_POOL]`. There
  is no label strip on connect (`data-nolabel`). The loader shows `● CONNECTING` and then `● NO SIGNAL`.
  Tapping a playing tile turns its sound on (via `AudioOwner`).
- **Colours:** the dark literal colours are kept in every theme, because the web hardcodes
  `rgba(13,8,32,…)` on the pills, cards and GO button. Only the `var(--…)` tokens follow `useTheme`. In
  LIGHT, the cover loader uses the milky feed panel (`surface="feed"`).

## Deviations
- **Input style:** the input is bare. `.search-input-wrap` exists in the CSS, but no element in the
  markup uses it. What the web renders is the bare `.search-input`.
- **Safe area:** the head adds `insets.top` to its 12px top padding. The bottom padding is
  `80 + (nav space − 58)`, because the web screen already stops 58px above the viewport bottom.
- **Live tiles on blur:** the tiles disconnect when the tab loses focus and reconnect when it regains
  focus. The web leaves them running in a hidden tab, but a phone should not keep 5+ WebViews decoding
  in the background.
- **Cover image failure:** only the image and its loader are removed, and the hue gradient stays. This
  matches the web's `onerror="…this.remove()"`, so `VoidImage`, which removes the whole box, is not used.
- **Gradients:** gradients use `experimental_backgroundImage` (RN 0.86). On a platform that ignores it,
  the GO button falls back to a solid `#6a2ee0`.
- **Discovery timing:** the web waits 5s after page load before the first discovery pull. Here it starts
  when the tab first mounts, because the tab is lazy anyway.

## Dependencies on other agents
- The `AudioOwnerProvider` must wrap the app. `StreamTile` calls `useAudioOwner()`, which throws without
  it, and `app/_layout.tsx` currently stubs the provider.
- Imports `src/features/live/{StreamTile,TileChrome,useStreamCascade,core}`, `src/ui/{icons,
  ImageOrbitLoader,Toast}`, `src/theme/{tokens,palettes}`, `src/nav/layout.useBottomNavSpace`, and
  from `src/core`: `buildSearch` deps plus `openSearchPost`, `searchPostById`, `findPost`, `onPostsChanged`,
  `moderation`, `GLOBAL_POOL`, `LIVE_CHANNELS`.
