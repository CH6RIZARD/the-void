# features/messages: real Supabase DMs

Port of the web MESSAGING MODULE (void2-final.html, lines 8845-9120; CSS 1093-1151).

- `MessagesScreen` (tab) has a 15s list poll while focused, one search field for conversations, message bodies and people (`profiles` ilike → `start_dm`), and the "NOT ENCRYPTED · STORED ON THE VOID'S SERVERS" footer.
- `ChatScreen` (`/messages/[id]`, param `id`) has a 5s poll, optimistic send with rollback, `last_read_at` marking, the DM_NOTE status line, the unlock icon, and the terms gate before sending.
- `openDmWith(userId)` is exported for profile and post surfaces. `chatRoute(id)` returns `/messages/<id>`.
- Nav dot: `setDmUnread` is updated on every list load. To keep the dot live outside the tab, call `startDmBadgePoll()` once (for example in `(tabs)/_layout.tsx`, in an effect that returns its disposer).

## Deviations
- Block checks cover `isBlockedUser` and server `blocks`, as on the web. The chat also calls the `dm_blocked(conv)` RPC (007) and replaces the compose pill with "CAN'T MESSAGE THIS ACCOUNT" (the web only toasted). An RLS or `dm_blocked` send error does the same.
- The chat is a stack route, not a fixed overlay. Polls pause while the app is backgrounded (the web used `visibilityState`).
- `#c9bfe8`, `#6a58a0` and `#231d42` stay hardcoded, as in the web CSS.
