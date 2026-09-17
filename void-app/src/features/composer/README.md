# features/composer: COMPOSER v2 (patch3 §3)

`ComposerSheet` (`/composer`) renders its own `Sheet` and closes with `router.back()`, or `onClosed` if given. It has the NEW DROP header, the serif italic 23px textarea with a gold caret, the `280−len` counter with a gold hairline, and TEXT · MEDIA · AUDIO text tabs.

- **MEDIA**: `expo-image-picker` multi-select. Thumbnails are 62px with ✕. 1 image = image, 1 video = video, several = carousel.
- **AUDIO**: `expo-audio` recorder with metering. It shows a live timer and a 26-bar meter (dBFS → 4+v·22 px). On denial it shows `MIC ACCESS DENIED` and reverts to TEXT. The finished take previews in the `.au-pill` player with RE-RECORD.
- **DROP** runs in this order:
  1. Terms gate, then the web's pre-flight checks and toasts.
  2. The sheet closes and `runDrop()` adds a pending card.
  3. Images are compressed with `expo-image-manipulator` (max 2048px WebP, JPEG fallback, GIF untouched).
  4. `voidUploadMedia` for each file, then `VoidAPI.createPost`.
  5. Success: haptic, post count +1. Failure: uploads and card removed, toast `DROP FAILED · … · DRAFT KEPT`, composer reopened with the draft.

## Feed integration (feed agent)
`usePendingDrops()` returns web app-post objects, newest first:
- `_pending: true` plus `_pendingKind` means render the loader card.
- Once saved, `_pending` is false and `_img/_imgs/_video/_audio` hold public URLs. Dedupe by `id` against `recentPosts`, then call `forgetDrop(id)`.

## Deviations / requirements
- **`expo-image-manipulator` is NOT in package.json.** Add `expo-image-manipulator ~57`. The code prefers the SDK 52+ contextual API and falls back to `manipulateAsync`.
- The draft is module state, so it survives closing the sheet, as on the web.
- Audio is AAC `.m4a` (`audio/mp4`), not webm.
- Video thumbnails use `expo-video` `VideoView` (first frame, muted).
