# PATCH 8b — Thread redesign: deck-stack cards + reply overlay screen (1:1 spec)

Target: `void2-final.html`. Pixel reference: turn 8 → **8b** (thread) and **8f** (reply overlay) in the bundled `Profile + Settings Explorations.dc.html`. **Supersedes §4 (Thread v3 / 4c) of README.md**; everything else there still applies (TOP/NEW sort, VoidAPI wiring, no category chips, 1.5px icons).

## Concept
Thread = the same card language as the rest of the app (rounded dark cards, inset top highlight). The OP is a CTA card that pops on screen; every comment is its own card; replies live BEHIND their comment as stacked card edges peeking below. No reply-count text on the card — the stack itself says "there's more". Tapping a comment with replies opens a full REPLY SCREEN that overlays whatever screen the thread was on (thread, reels, nation feed).

## A. Thread screen (ref 8b) — keep `openThread/closeThread/submitComment`, `#thread-count`, translate handler
- Backdrop: thread opens over the previous screen with `rgba(2,1,8,.7)` + blur(3px) scrim; content column slides/pops in (`transform:translateY(12px)→0, opacity 0→1, ~240ms ease-out`).
- **OP CTA card**: `border-radius:22px;background:rgba(13,8,32,.96);box-shadow:0 18px 50px rgba(0,0,0,.6),0 0 0 1px rgba(201,168,76,.25),inset 0 1px 0 rgba(255,255,255,.07);padding:18px 18px 15px`. Header row (32px avatar, name, mono handle·time, hairline X), serif italic quote, actions row (bolt gold when fired / replies / reposts / share — 1.5px icons, mono counts).
- Replies divider row with `38 REPLIES` + gold-fade hairline + TOP/NEW chips (README §4 sort logic).
- **Comment card**: `border-radius:18px;background:rgba(13,8,32,.95);box-shadow:0 10px 28px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.06);padding:14px 15px 12px` — 26px avatar, name + mono time, body `#c9bfe8` 12.5px/1.5, action row: bolt+count and REPLY only. **NO reply-count text, NO ▸.**
- **Reply stack edges** (only when the comment has replies) — inside the comment's wrapper, peeking BELOW the card:
```html
<div style="position:relative;margin-bottom:26px"><!-- wrapper per comment -->
  <!-- 2+ replies: two edges -->
  <div style="position:absolute;left:10px;right:10px;bottom:-10px;height:30px;border-radius:16px;background:rgba(13,8,32,.45);box-shadow:inset 0 1px 0 rgba(255,255,255,.03)"></div>
  <!-- 1+ replies: one edge -->
  <div style="position:absolute;left:5px;right:5px;bottom:-5px;height:30px;border-radius:17px;background:rgba(13,8,32,.68);box-shadow:inset 0 1px 0 rgba(255,255,255,.04)"></div>
  <div class="comment-card" style="position:relative;…">…</div>
</div>
```
  1 reply = one edge; ≥2 replies = two edges; 0 replies = plain card, `margin-bottom:16px`. The whole wrapper is the tap target → `openReplies(commentId)`.
- Compose pill pinned at bottom (unchanged from current): `add to the thread…` + purple send orb.

## B. Reply overlay screen (ref 8f) — NEW `openReplies(commentId)`
A full screen that OVERLAYS the current screen (do not navigate away; the underlying screen stays mounted):
```html
<div id="reply-overlay" style="position:fixed;inset:0;z-index:60;display:none">
  <div class="ro-scrim" style="position:absolute;inset:0;background:rgba(2,1,8,.55)" onclick="closeReplies()"></div>
  <div class="ro-sheet" style="position:absolute;left:0;right:0;bottom:0;top:88px;border-radius:26px 26px 0 0;background:rgba(8,4,24,.97);box-shadow:0 -14px 50px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.06);display:flex;flex-direction:column;transform:translateY(100%);transition:transform .28s cubic-bezier(.32,.72,.28,1)">
    <!-- 32×3 handle · header: back chevron (closeReplies) + REPLIES mono label + count gold right -->
    <!-- body (flex:1, scroll): PARENT comment card (same card style + gold 1px ring + mono PARENT tag)
         then each reply as its own card, margin-left:22px, radius 16, bg rgba(18,11,42,.95);
         replies WITH their own replies get the same §A stack edges → tapping opens openReplies(replyId) (recursive, overlay replaces content, back pops) -->
    <!-- compose pill pinned: placeholder "reply to <name>…" + purple send orb -->
  </div>
</div>
```
- Open: `display:block`, then `transform:translateY(0)` next frame. Close: reverse, then hide. Underlying screen keeps its scroll position.
- Back chevron pops one level (nested reply → parent's overlay → thread); scrim tap closes fully.
- OP chip (`rgba(124,58,237,.18)` purple mono) on any reply authored by the thread author.
- Submits: `VoidAPI.reply(threadId, body, parentId)` with `parentId` = the overlay's parent comment; optimistic insert at top of NEW / re-rank under TOP; increments the parent card's stack edges live.
- Works identically when the thread was entered from reels or nation feed — the overlay stacks above that context and returns to it.

## C. Open animation (ref turn 9, 9a–9e — one system, all media formats)
Tapping a post to open its thread NEVER navigates — the tapped card itself becomes the OP CTA card via FLIP:
1. **T+0 LIFT**: measure the tapped card's feed position; the thread screen mounts with the OP card at that exact rect, then animates to its thread position while scaling to 1.02, the gold ring (`0 0 0 1px rgba(201,168,76,.3)`) fades in, and the underlying screen dims to `rgba(2,1,8,.55–.7)` + blur(2–3px). ~240ms `cubic-bezier(.32,.72,.28,1)`.
2. **T+120 DEAL**: comment cards deal UP from beneath the OP card — each starts `translateY(24px); opacity:0` and springs to rest, 60ms stagger (T+120, T+180, T+240…). Reply stack edges (§A) fade in with their card.
3. **Media continuity — hard rule**: the OP's media element is REPARENTED, not recreated. Video keeps its playback position and keeps playing; live streams stay live (muted state preserved); audio keeps playing with the wave animating; images still loading keep the 6c orbit loader; buffering video/stream shows the original sparkle-float loader. No poster flashes, no restarts.
4. Close = reverse: deck deals down/out, OP card FLIPs back to its feed rect, scrim lifts. Scroll position untouched.
Same animation from every surface (feed, reels info card, nation feed) — only the backdrop differs.

## Test
Open thread → OP pops as CTA card over blurred previous screen → comments are cards; ones with replies show 1–2 stacked edges below, no count text → tap → reply screen slides up over the thread → parent card gold-ringed + PARENT tag, replies as cards, nested replies show their own stack edges → reply → lands under parent, VoidAPI.reply called with parentId → back chevron pops levels, scrim closes → underlying screen (thread/reels/nation) untouched, scroll preserved.

## Claude Code prompt
> Apply design_handoff_void_patch3/PATCH-8b-thread.md to void2-final.html (it replaces §4 of README.md; the rest of README.md still applies). Pixel reference: turn 8 options 8b + 8f in the bundled mockup. Keep openThread/closeThread/submitComment and all existing ids working; add openReplies/closeReplies as specified. Route replies through VoidAPI.reply with parentId. No reply-count text on comment cards — stack edges only.
