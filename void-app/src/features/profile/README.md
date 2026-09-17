# features/profile: PROFILE v3 (patch3 §2)

- `ProfileScreen` renders your own profile with no props or params. `<ProfileScreen handle="x"/>`, or a `handle` route param (`/u/[handle]`), renders another user.
- Self: PROFILE label + gear (→ `/settings`), the 72px avatar with a 1px gold ring, stats with dividers, EDIT PROFILE (→ `EditProfileSheet`), share circle (RN `Share`), DROPS/MESSAGES tabs.
- Other: a back button, the ··· `AccountSheet` (BLOCK/UNBLOCK, REPORT ACCOUNT → reasons sheet via core `moderation`), and MESSAGE (`start_dm` → chat). Stats come from post and follow counts.

## Deviations
- DROPS render as the shared `<PostCard surface="profile">` (coordinator request) in a FlatList with `usePostViewability('profile')` and one `<ModerationHost/>`. The web used compact `renderUserDrops` rows. Server rows go through core `sbPostToApp`.
- `.prof-top` is a pinned bar above the list rather than a sticky row inside it. On VOID its background is flat `#120830` (the top colour of the glow).
- The DROPS list queries `posts?author_id=eq.<uid>` directly and falls back to `VoidAPI.recentPosts` filtered by author. recentPosts alone is a global 40 and misses older drops. Drops posted this session are merged in from the composer's pending store.
- EDIT PROFILE opens a sheet (the web opened Settings) and adds avatar upload. The image is picked square, compressed to 512px WebP, uploaded to `post-media` with `voidUploadMedia`, and saved to `profiles.avatar_url` plus local `void_avatar_url`. Bio stays device-local because `profiles` has no bio column.
- The share URL is `https://void-app-d35c.pages.dev/#@handle` (the web used `location.href`).
