# Photo viewer (native port of the web `#photo-overlay`)

Route: `app/photo.tsx` → `/photo?id=<postId>&i=<index>` (`ROUTES.photo(id, index)`), a transparent
modal. `registerPhotoViewer()` (called once in `app/_layout.tsx`) registers the feed's
`registerPhotoOpener`, so `openPhoto(postId, index)` from `PostMedia`, `PostCarousel` and the
thread OP image opens this viewer instead of the thread.

## Matches the web (`openPhoto` / `closePhoto` / `initPhotoSwipe`)
- Slides are `p._imgs || [p._img]`, a paging strip that opens at the tapped index. Cells have 8px side
  padding, and the image is `contain` in a box 72% of the window height with a 14px radius.
- The orbit loader (`ImageOrbitLoader`) shows until each image has painted.
- Dots appear only when there is more than one slide (the active dot is gold at scale 1.35). The
  caption scrolls past 22vh. **OPEN THREAD** has the gradient pill. The source line reads
  `<host> · N SLIDES · SWIPE DOWN TO CLOSE`.
- Close X at top-left in #6a58a0. A tap on the backdrop closes.
- Swipe: the axis locks after 8px, and a drag is vertical when |dy| > |dx|·1.2. A downward drag
  follows the finger and an upward drag resists (×0.35). Opacity is `1 − |d|/500`, and releasing past
  110px closes. Horizontal drags belong to the strip.
- The media surface stays dark in the LIGHT theme too. Opening calls `vwBump(p.tags, .3)`.

## Native additions (requested)
- An `i / N` counter at top centre, shown only when there is more than one slide.
- Pinch-zoom (1–5×, around the focal point) and double-tap zoom (2.5× at the tap point, or back to 1×),
  built on RNGH + Reanimated. You can pan while zoomed, and the pan is clamped to the image box. While
  zoomed, paging and swipe-to-dismiss are off. Paging away resets zoom on the slide you left.
- Share through the native sheet (source URL, else the current image URL), plus `VoidAPI.share`.
- The ⋯ menu opens `openPostMenu(p)` in the viewer's own `<ModerationHost/>`. A block, report or hide
  that hides the post closes the viewer.
- Graphic veil: while the graphic filter is on, the image is blurred under GRAPHIC CONTENT. Tapping it
  reveals the image, and zoom and paging stay off until then.

## Limitations
- Pan bounds use the box size, not the image's intrinsic aspect ratio, so a letterboxed image can be
  panned into its empty bands.
- Nothing has run on a device (EAS compile only).
