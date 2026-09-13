# THE VOID — PATCH 3 · COMPLETE (single file: UI final redesign + all logic patches)

**Status: FINAL.** This is the definitive UI redesign plus its logic patches. Apply every visual identically across all three themes — VOID / DARK / LIGHT — through the section-7 CSS variables (never hardcode a theme's color in a renderer).

**Delivery**: this ONE file is the whole patch — PATCH-7e and PATCH-8b are merged in as §6 and §4 (their standalone files are kept only as duplicates). Folder `design_handoff_void_patch3/` sits next to `void2-final.html`; the bundled `Profile + Settings Explorations.dc.html` is the pixel reference (turn 9 = thread open animation, turn 8 = 8b/8f thread, turn 7 = 7e nation, turn 6 = 6c loader, turn 5 = nav/profile/composer/themes, turn 4 = 4d reels mode). `nation-7e-reference.html` = standalone nation mock.

Target: `void2-final.html`. Match the referenced mock options pixel-exactly. Striped/colored blocks in older mocks were stand-ins only — real media surfaces show the §8 loaders then real media. No 1px borders for depth (hairlines for structure are fine). Tokens unchanged; new neutral: inactive/dim icon `#5c4d8a`.

## ⚠ RESCINDED — do NOT apply, and revert if already applied
- **Patch 2 A2 (nation overlay restyle)** — the user's ORIGINAL nation overlay skin stays. Section 5 below only inserts new content into it.
- **Patch 2 A6 (search restyle)** — the user's original/current search screen is final. Do not touch search at all.
- Mockups 2a/2b/2c/2d/3a/3b/3c/4a/4b/4e/4f/7a/7b/7c/7d are dead references (4f nation 3-across superseded by **7e Cinema LIVE**; 4e globe-mode mock removed — the original globe screen is the spec; 3c composer + 4b profile superseded by 5c/5b; 4a nav + 2c thread superseded by 5a-B / 4c; nav alternates 5a-A/5a-C dropped).

## 0. ICON SYSTEM v2 — hairline, grown-up
All `VI()` icons switch to `stroke-width="1.5"` (was 2). Add/replace:

```js
home:  VI('<path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5L12 2.5z"/>'),
user:  VI('<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20c1.3-3.6 4-5.5 7-5.5s5.7 1.9 7 5.5"/>'),
globe: VI('<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.8" ry="8.5"/><path d="M3.5 12h17"/>'),
search:VI('<circle cx="11" cy="11" r="6.5"/><path d="m20.5 20.5-4.8-4.8"/>'),
repost:VI('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
dms:   VI('<path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z"/>'),
lock:  VI('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>')
```
No filled icon variants except `boltFill` (fired state) and `play/pause/send`. No emoji anywhere — sweep remaining 🔥 💬 🔒 🌐 📎 ➤ ⚙ 📍 ●-status glyphs to VICON or plain text.

## 1. NAV BAR — DECIDED: 5a-B in the ORIGINAL pill container
Kill glyph nav AND the turn-4 glow-dot version. Keep the app's existing floating pill container exactly as it is (`border-radius:24px;background:rgba(13,8,32,.92);backdrop-filter:blur(14px);box-shadow:0 -4px 24px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.07)`, same margins/position); inner padding `13px 18px 10px`. Inside it: **5 items** `flex:1` matching the existing `.ni` tabs (`nav-void/globe/search/messages/profile`, keep `switchTab()` + ids), **icons only — delete the text labels** (`VOID/GLOBE/SEARCH/DMS/ME` spans go away). Hairline icons 19px `home/globe/search/dms/user`, stroke-width 1.5. Active = gold icon + 12×1px underline `rgba(201,168,76,.7)` (7px gap below icon); inactive `#5c4d8a`, empty 1px spacer keeps height. **DMS unread** (`#nav-dm-badge`): 4px solid gold dot at the icon's top-right corner — no glow, no count bubble. No dots elsewhere, no filled shapes. (Alternate treatments rescinded — 5a-B is final.) Alternates: 5a-A type-only (Syne Mono 9px .22em, active gold + 1px border-bottom), 5a-C icon row with label on active only. Keep `switchScreen()` and ids.

## 2. PROFILE v3 (ref 5b)
Keep `openSettings()`, tab handlers, stat sources, ids. Rebuild `#screen-profile`:
- Bg `radial-gradient(110% 45% at 50% 0%,#120830 0%,#04020c 58%)`. Top row: `PROFILE` Syne Mono 8px .3em `#5c4d8a` left, gear (1.5px stroke, `#8d7cc0`) right.
- Identity row: 72px avatar, **1px gold ring only** (`box-shadow:0 0 0 1px rgba(201,168,76,.45)`) — no glow, no thick ring; name DM Serif 25px white, `@handle` gold mono 9.5px, bio italic serif 13.5px `#8d7cc0`.
- Stats: 3 columns split by 1px×20px `rgba(255,255,255,.08)` verticals; numbers Syne 700 15px white (all white — no gold number), labels mono 7px `#5c4d8a`.
- Buttons: EDIT PROFILE pill `rgba(244,240,255,.94)`; share = 46px outlined circle `inset 0 0 0 1px rgba(255,255,255,.12)` hairline share icon.
- Tabs: plain text row (no segmented pill): Syne Mono 8.5px .18em, active white + 1px gold border-bottom, inactive `#5c4d8a`.
- Drops list: hairline action rows (bolt/reply/repost 1.5px, 12px), plain `rgba(255,255,255,.07)` 1px dividers (no ◆ ornament).
- Bottom nav per section 1, ME active.

## 3. COMPOSER v2 (ref 5c) — supersedes patch 2 B1 visuals, keep its logic
Keep `openComposer/closeComposer/setComposerType/setComposerLink/submitComposerPost`, `composerType/composerLink`, char counter + limit logic. Visual rebuild:
- Sheet: `border-radius:24px 24px 0 0;background:#07041a;box-shadow:0 -12px 48px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.06);padding:0 22px 24px`; 32×3 handle.
- Header: `NEW DROP` Syne Mono 8px .28em `#5c4d8a` + `@handle` gold mono; hairline X close right. No avatar card, no "DROPPING INTO THE VOID" banner.
- Textarea: serif italic 23px lh 1.42 white, gold 1.5px caret, placeholder "what's your signal"; counter `280−len` mono 7.5px `#5c4d8a` + gold-fade hairline.
- **Type picker = 3 text tabs, NOT icon cards**: TEXT · MEDIA · AUDIO — Syne Mono 8.5px .18em, gap 22px, active gold + 1px gold border-bottom, inactive `#5c4d8a`. Delete the 64px glyph cards AND the old PHOTO/VIDEO/STACK split entirely.
- **MEDIA actually opens the gallery**: tapping MEDIA triggers a hidden `<input type="file" accept="image/*,video/*" multiple>`. 1 image → image post; 1 video → video post; multiple selections → carousel/STACK automatically (map to existing composerType values `image/video/carousel`). Show selected media as small thumbnails above the DROP button with an ✕ to remove each; object-URL previews, files attached to the post payload.
- **AUDIO actually records**: tapping AUDIO calls `navigator.mediaDevices.getUserMedia({audio:true})` → mic permission prompt → record via `MediaRecorder`, live elapsed timer + the B2 waveform as level meter while recording; STOP produces a playable take (B2 player pill preview) attached to the post (blob URL locally; upload via VoidAPI when backend lands). Graceful denial: mono note `MIC ACCESS DENIED` and tab reverts to TEXT.
- **Link pills (LIVE / COUNTRY / SEARCH) are REMOVED** — delete that row and its `setComposerLink` UI (keep the function as a no-op if referenced elsewhere).
- Submit: full-width `padding:13px;border-radius:24px;background:linear-gradient(135deg,#c9a84c,#a8873a);color:#04020c;font:700 12px Syne;letter-spacing:.3em` — label `DROP` (no ⬡), soft shadow only.

## 4. THREAD — deck-stack cards + reply overlay + open animation (ref 8b / 8f / 9a–9e — CHOSEN)
Keep `openThread/closeThread/submitComment`, `#thread-count`, translate handler. TOP/NEW sort (TOP = bolts desc, NEW = time desc), nested `parentId` replies, OP chip, 1.5px icons, no category chips all apply within this layout.

### 4.0 Concept
Thread = the same card language as the rest of the app (rounded dark cards, inset top highlight). The OP is a CTA card that pops on screen; every comment is its own card; replies live BEHIND their comment as stacked card edges peeking below. No reply-count text on the card — the stack itself says "there's more". Tapping a comment with replies opens a full REPLY SCREEN that overlays whatever screen the thread was on (thread, reels, nation feed).

### 4.A Thread screen (ref 8b) — keep `openThread/closeThread/submitComment`, `#thread-count`, translate handler
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

### 4.B Reply overlay screen (ref 8f) — NEW `openReplies(commentId)`
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

### 4.C Open animation (ref turn 9, 9a–9e — one system, all media formats)
Tapping a post to open its thread NEVER navigates — the tapped card itself becomes the OP CTA card via FLIP:
1. **T+0 LIFT**: measure the tapped card's feed position; the thread screen mounts with the OP card at that exact rect, then animates to its thread position while scaling to 1.02, the gold ring (`0 0 0 1px rgba(201,168,76,.3)`) fades in, and the underlying screen dims to `rgba(2,1,8,.55–.7)` + blur(2–3px). ~240ms `cubic-bezier(.32,.72,.28,1)`.
2. **T+120 DEAL**: comment cards deal UP from beneath the OP card — each starts `translateY(24px); opacity:0` and springs to rest, 60ms stagger (T+120, T+180, T+240…). Reply stack edges (§A) fade in with their card.
3. **Media continuity — hard rule**: the OP's media element is REPARENTED, not recreated. Video keeps its playback position and keeps playing; live streams stay live (muted state preserved); audio keeps playing with the wave animating; images still loading keep the 6c orbit loader; buffering video/stream shows the original sparkle-float loader. No poster flashes, no restarts.
4. Close = reverse: deck deals down/out, OP card FLIPs back to its feed rect, scrim lifts. Scroll position untouched.
Same animation from every surface (feed, reels info card, nation feed) — only the backdrop differs.

### 4.T Test
Open thread → OP pops as CTA card over blurred previous screen → comments are cards; ones with replies show 1–2 stacked edges below, no count text → tap → reply screen slides up over the thread → parent card gold-ringed + PARENT tag, replies as cards, nested replies show their own stack edges → reply → lands under parent, VoidAPI.reply called with parentId → back chevron pops levels, scrim closes → underlying screen (thread/reels/nation) untouched, scroll preserved.

## 5. GLOBE TAB — DUAL MODE (ref 4d/4e). One tab, two views.
GLOBE nav opens `#screen-globe` in **REELS mode by default**; floating top-center segmented toggle (glass capsule) flips REELS ⇄ GLOBE; persist `localStorage('void_globe_mode')`.
- **REELS (ref 4d — this UI/format is approved)**: patch-2 immersive engine (B3) rendered inline in the tab. **NOT country-specific by default** — the queue is the general FOR YOU ranking (`vwScore`: recency + tag affinity + controversy + noise, live streams eligible alongside posts). No geo boost here. Sub-caption `FOR YOU · SEEDED BY YOUR SIGNALS`. Side rail: bolt / reply→openThread / repost / share (1.5px icons). Nav stays visible. Country-scoped reels exist ONLY via globe → tap nation → tap media (section 6).
- **GLOBE (no mockup — deliberately)**: the user's ORIGINAL globe screen, byte-for-byte unchanged, with only the toggle pinned above it; tapping a nation opens section 6.

## 6. NATION — Cinema LIVE CTA + nation-seeded feed (ref 7e — CHOSEN, ORIGINAL overlay skin)
Keep `closeOverlay()`, the open-from-globe handler, and the overlay header/skin exactly as in the app today. Pixel mock: `nation-7e-reference.html`.

### 6.0 Hard rules
1. **NO colored/striped placeholder blocks anywhere.** The purple/blue radial-gradient tiles in earlier mocks were mock stand-ins ONLY. Every real media surface is: the user's EXISTING loading animation → the real stream/video frame.
2. **Loading states use the app's own loaders, never spinners/skeletons/shimmer:**
   - Live streams + videos → the app's original sparkle/float loader, hardcoded, untouched.
   - Images → the 6c twin counter-rotating orbit loader (patch3 §8).
3. **The LIVE hero autoplays instantly** — real stream for the tapped country, muted inline, no poster placeholder.
4. **The feed below is populated from that exact country on open** — not global, not stale.

### 6.A Markup — overlay body (keep existing header/skin + `closeOverlay()` untouched)

Replace the current `#c-overlay` body (delete the `.ctab` LIVE/FEED pills) with:

```html
<div id="nation-body" style="flex:1;overflow-y:auto">
  <!-- label row -->
  <div style="display:flex;align-items:center;gap:10px;padding:18px 22px 10px">
    <span style="font-family:'Syne Mono',monospace;font-size:10px;letter-spacing:.25em;color:var(--gold)">FOR YOU · RANKED FOR <span id="nation-cta-name">—</span></span>
    <span style="flex:1;height:1px;background:linear-gradient(90deg,rgba(201,168,76,.3),transparent)"></span>
    <span style="font-family:'Syne Mono',monospace;font-size:10px;letter-spacing:.15em;color:var(--dim)">TAP → REELS</span>
  </div>
  <!-- cinema hero: full-bleed, NO side padding, NO border-radius -->
  <div id="nation-hero" style="aspect-ratio:16/10;position:relative;overflow:hidden;background:#05020e" onclick="openReel(this.dataset.postId,{nation:currentNationIso})">
    <div id="nation-hero-loader" style="position:absolute;inset:0"><!-- app's ORIGINAL sparkle/float loader mounts here while the stream buffers --></div>
    <video id="nation-hero-video" autoplay muted playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .35s"></video>
    <div style="position:absolute;top:12px;left:16px;display:flex;align-items:center;gap:6px">
      <span style="padding:3px 9px;border-radius:14px;background:rgba(239,68,68,.85);font-family:'Syne Mono',monospace;font-size:9px;letter-spacing:.12em;color:#fff;white-space:nowrap;flex-shrink:0">◉ LIVE</span>
      <span id="nation-hero-viewers" style="font-family:'Syne Mono',monospace;font-size:10px;letter-spacing:.12em;color:rgba(255,255,255,.55)"></span>
    </div>
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;border-radius:50%;background:rgba(13,8,32,.6);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;color:var(--white)"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5-13-7.5z"></path></svg></div>
    <div style="position:absolute;bottom:0;left:0;right:0;padding:30px 16px 12px;background:linear-gradient(transparent,rgba(4,2,12,.95))">
      <div id="nation-hero-caption" style="font-family:'DM Serif Display',serif;font-style:italic;font-size:17px;color:var(--white);line-height:1.35"></div>
    </div>
  </div>
  <!-- quiet cards -->
  <div style="display:flex;gap:8px;padding:10px 16px 0">
    <div id="nation-card-trending" onclick="openReel(this.dataset.postId,{nation:currentNationIso})" style="flex:1;border-radius:12px;background:rgba(13,8,32,.8);box-shadow:inset 0 1px 0 rgba(255,255,255,.05);padding:10px 11px;cursor:pointer">
      <span style="font-family:'Syne Mono',monospace;font-size:9px;letter-spacing:.14em;color:var(--gold)">TRENDING</span>
      <div class="nc-title" style="font-size:12.5px;font-weight:600;color:var(--white);margin-top:5px;line-height:1.4"></div>
      <div class="nc-meta" style="font-family:'Syne Mono',monospace;font-size:9px;color:var(--dim);margin-top:5px"></div>
    </div>
    <div id="nation-card-about" onclick="openReel(this.dataset.postId,{nation:currentNationIso})" style="flex:1;border-radius:12px;background:rgba(13,8,32,.8);box-shadow:inset 0 1px 0 rgba(255,255,255,.05);padding:10px 11px;cursor:pointer">
      <span class="nc-eyebrow" style="font-family:'Syne Mono',monospace;font-size:9px;letter-spacing:.14em;color:#a78bfa">ABOUT</span>
      <div class="nc-title" style="font-size:12.5px;font-weight:600;color:var(--white);margin-top:5px;line-height:1.4"></div>
      <div class="nc-meta" style="font-family:'Syne Mono',monospace;font-size:9px;color:var(--dim);margin-top:5px"></div>
    </div>
  </div>
  <!-- nation feed -->
  <div style="display:flex;align-items:center;gap:10px;padding:18px 22px 8px">
    <span style="font-family:'Syne Mono',monospace;font-size:10px;letter-spacing:.25em;color:var(--dim)">THE FEED · <span id="nation-feed-name">—</span></span>
    <span style="flex:1;height:1px;background:linear-gradient(90deg,rgba(201,168,76,.2),transparent)"></span>
    <span style="font-family:'Syne Mono',monospace;font-size:10px;letter-spacing:.15em;color:var(--dim)">SCROLL ↓</span>
  </div>
  <div id="nation-feed"><!-- standard feed renderer output --></div>
</div>
```

Sizes above are mock-scale ×1.4 rounded (mock card is 390px vs app 100%): keep the app's real type scale where one already exists.

### 6.B Logic — exact code

```js
let currentNationIso=null;

async function openNation(iso,name,region){
  currentNationIso=iso;
  document.getElementById('nation-cta-name').textContent=name.toUpperCase();
  document.getElementById('nation-feed-name').textContent=name.toUpperCase();
  document.querySelector('#nation-card-about .nc-eyebrow').textContent='ABOUT '+iso.toUpperCase();
  openOverlay(iso,name,region); // existing overlay open, header untouched
  // 1. rank CTA for THIS country (local scorer now, VoidAPI when backend lands)
  const top=await(VoidAPI.base?VoidAPI.nationTop3(iso):Promise.resolve(rankNation(iso)));
  mountNationHero(top.live);           // top-ranked LIVE stream for this geo
  mountNationCard('nation-card-trending',top.trending);
  mountNationCard('nation-card-about',top.about);
  // 2. populate the feed from THIS country on open
  const posts=await(VoidAPI.base?VoidAPI.nationFeed(iso):Promise.resolve(POSTS.filter(p=>p.country===iso).sort((a,b)=>vwScore(b)-vwScore(a))));
  renderFeed(document.getElementById('nation-feed'),posts); // existing feed renderer; media inside uses §Hard-rules loaders
}

function rankNation(iso){
  const pool=POSTS.filter(p=>p.country===iso);
  const s=p=>vwScore(p)+(p.live?1.5:0)+(p.viewVelocity||0);
  return {
    live:     pool.filter(p=>p.live).sort((a,b)=>s(b)-s(a))[0]||null,
    trending: pool.filter(p=>!p.live&&!p.about).sort((a,b)=>s(b)-s(a))[0]||null,
    about:    pool.filter(p=>p.about).sort((a,b)=>s(b)-s(a))[0]||null
  };
}

function mountNationHero(post){
  const hero=document.getElementById('nation-hero'),
        vid=document.getElementById('nation-hero-video'),
        loader=document.getElementById('nation-hero-loader');
  if(!post){hero.style.display='none';return}
  hero.style.display='';hero.dataset.postId=post.id;
  document.getElementById('nation-hero-caption').textContent=post.caption||post.body;
  document.getElementById('nation-hero-viewers').textContent=fmtCount(post.viewers)+' WATCHING';
  showSparkleFloatLoader(loader);      // the app's ORIGINAL loader — do not replace
  vid.style.opacity=0;
  vid.src=post.streamUrl;              // geo-exact stream for this country
  vid.play().catch(()=>{});            // muted+playsinline ⇒ instant inline autoplay
  vid.addEventListener('playing',()=>{ // first real frame: fade loader out, video in
    loader.style.display='none';vid.style.opacity=1;
  },{once:true});
}

function mountNationCard(id,post){
  const el=document.getElementById(id);
  if(!post){el.style.display='none';return}
  el.style.display='';el.dataset.postId=post.id;
  el.querySelector('.nc-title').textContent=post.title||post.body;
  el.querySelector('.nc-meta').textContent=fmtCount(post.views)+' · TAP → REELS';
}
```

Wire the globe's country tap to `openNation(iso,name,region)` (replacing whatever opened the old two-tab body). `showSparkleFloatLoader` = whatever function/markup currently mounts the existing sparkle/float animation — reuse it verbatim; if it's inline markup today, extract it into that helper without changing a pixel. `renderFeed`/`vwScore`/`fmtCount`/`openReel`/`POSTS` are the app's existing pieces.

### 6.C Reel handoff
`openReel(id,{nation:iso})` seeds the reel queue nation-first: pool `p.country===iso` (ranked by `vwScore`) until exhausted, then blended global. Same viewer engine, same rail, same VoidAPI calls.

### 6.T Test
Globe → tap Japan → overlay opens with original header → hero shows the sparkle/float loader, then the Japan live stream fades in ALREADY PLAYING (muted) → TRENDING/ABOUT cards filled from Japan ranking → scroll: THE FEED · JAPAN, Japan-only posts, image loads show the 6c orbit → tap hero/card/feed media → reels seeded Japan-first → tap another country → everything repopulates for that ISO. Zero colored placeholder tiles anywhere.

## 7. THEME SYSTEM — VOID / DARK / LIGHT (ref 5d/5e/5f — **approved final**)
Themeable via CSS variables on `<html data-theme="void|dark|light">`. All hardcoded colors in CSS/renderers move to vars:

| var | VOID (default) | DARK | LIGHT |
|---|---|---|---|
| --bg | #04020c (+purple radials) | #0a0a0c (no radials) | radial #f2ecdd → #e7e0cf (warm greige, toned) |
| --bg2/card | #0d0820 | #141417 | #f6f1e6 raised, shadow 0 6px 18px rgba(26,20,36,.12) |
| --white/ink | #f4f0ff | #f2f2f0 | #1a1424 |
| --dim | #5c4d8a | #77747e | #7c7668 |
| --gold | #c9a84c | #c9a84c | #9a7b2d |
| --purple | #7c3aed | (unused — neutrals) | (unused) |
| --red | #ef4444 | #ef4444 | #d43c3c |
| --hairline | rgba(255,255,255,.07) | rgba(255,255,255,.07) | rgba(26,20,36,.14) |

DARK = neutral near-black, purple glow/radials removed, gold kept. LIGHT = **toned warm greige with real depth, never flat white**: radial-toned background, avatars `#ded7c5` with 1px inset ring + soft drop shadow, embed placeholders `#ddd6c3/#d5cdb8` stripes with inset shadow, nav pill `rgba(250,247,240,.92)` with `0 -4px 20px rgba(26,20,36,.16)` + white inset highlight, gold deepened to `#9a7b2d`. All themes keep the SAME pill nav geometry (section 1) — only surface colors swap. Globe/reels overlays stay dark in LIGHT mode (media surfaces), chrome follows theme.
- **Settings → new "Appearance" section** (ref 5d, above Content): three mini-preview cards (VOID/DARK/LIGHT swatch mocks), tap to apply instantly, selected card gets 1px gold ring + gold label; below, `Match system` toggle — when ON, dark↔light follow `prefers-color-scheme` (VOID selection ignores it: "VOID STAYS VOID").
- Persist `localStorage('void_theme')` + `void_theme_match_system`; apply before first paint (inline script in `<head>`) to avoid flash. Keep `saveSettings()` ids.

## 8. MEDIA LOADING STATES ⚠ (user-ordered — do not replace their animation)
- **Videos + live streams: keep the app's EXISTING sparkle/float loading animation exactly as-is, hardcoded.** Do not swap it for spinners, skeletons, shimmer, or anything generic. If any patch step touched it, restore the original.
- **Images ONLY** (ref **6c — CHOSEN**): same loading background as now, sparkles orbit in a **twin counter-rotating formation**: outer ring 62px, `spin 3.4s linear infinite`, 3 gold sparks (lead 3px w/ soft glow, others .55/.4 opacity); inner ring 34px counter-rotating (`spin-reverse 2.2s`), 2 purple sparks (.7/.35 opacity — in DARK/LIGHT themes use dim-neutral instead of purple); `LOADING IMAGE` Syne Mono 7px .3em dim centered below. Applies everywhere an image loads: feed embeds, reels, nation tiles, profile media. (Alternates 6a/6b/6d rescinded.)

## 9. CONTENT CLEANUP (user-ordered)
- **Remove category/tag chips from ALL post renderings** — feed, thread, profile drops, reels info row, nation feed: no THEOLOGY/POWER/CONFLICT/CONTROVERSY chips on posts. Tags stay in the data model (ranking/affinity still uses them) — they just never render on a post. Status badges (`◉ LIVE`, TRENDING, ABOUT) are NOT tags and stay. Search filter pills stay (search is untouched per rescission).
- **Messages list**: `ENCRYPTED` header tag → Syne Mono dim `#6a58a0`, no lock emoji, no green.
- **Chat**: header lock = hairline VICON.lock dim; status `ACTIVE IN THE VOID` mono dim (no green, no ●); no emoji in seeded message copy; send buttons use VICON.send.

## 10. BACKEND WIRING CONTRACT ⚠ (user is building the backend)
Unchanged from before — repeated here as the single source of truth. All engagement goes through ONE adapter:

```js
const VoidAPI={
  base:null, // set to backend origin when ready; null = local-only mode
  async call(method,path,body){
    if(!this.base) return {ok:true,local:true};
    const r=await fetch(this.base+path,{method,headers:{'Content-Type':'application/json'},body:body&&JSON.stringify(body)});
    if(!r.ok) throw new Error(path+' '+r.status);
    return r.json();
  },
  bolt:(id,on)=>VoidAPI.call(on?'POST':'DELETE',`/posts/${id}/bolt`),
  reply:(id,body,parentId)=>VoidAPI.call('POST',`/posts/${id}/replies`,{body,parentId}),
  replies:(id,cursor)=>VoidAPI.call('GET',`/posts/${id}/replies?cursor=${cursor||''}`),
  repost:(id,on)=>VoidAPI.call(on?'POST':'DELETE',`/posts/${id}/repost`),
  share:(id)=>VoidAPI.call('POST',`/posts/${id}/share`),
  follow:(handle,on)=>VoidAPI.call(on?'POST':'DELETE',`/follow/${handle}`),
  reels:(seed)=>VoidAPI.call('GET',`/feed/reels?seed=${seed||''}`),
  nationFeed:(iso,cursor)=>VoidAPI.call('GET',`/feed/nation/${iso}?cursor=${cursor||''}`),
  nationTop3:(iso)=>VoidAPI.call('GET',`/rank/nation/${iso}/top3`)
};
```
Rules: every bolt/reply/repost/share/follow in feed, thread, reels rail, nation UI calls the matching method; optimistic UI first, rollback + `SIGNAL LOST · RETRY` toast on error; replies pass `parentId`; counts render from post objects, never hardcoded; local scorers stay as fallback when `base` is null; `void_aff`/`void_globe_mode`/`void_theme` stay local, synced only through the adapter.

## Order & test
0 icons v2 → 1 nav → 2 profile → 3 composer → 4 thread (cards, reply overlay, open animation) → 5 globe dual-mode → 6 nation (cinema hero, seeded feed) → 7 themes → 8 media loading → 9 cleanup sweep → 10 VoidAPI sweep. One diff each.

End-to-end test: nav shows hairline icons w/ gold underline in the original pill → composer has TEXT/MEDIA/AUDIO tabs, MEDIA opens gallery, AUDIO prompts mic + records, plain DROP → globe tab opens reels (general For You), toggle to globe (original screen) → tap Japan → original overlay header, sparkle-float loader then Japan live stream fades in already playing muted, TRENDING/ABOUT cards from Japan ranking, THE FEED · JAPAN scrolls below with Japan-only posts → tap hero/card/media → reels seeded Japan-first → tap a post → it FLIP-lifts into the OP CTA card, comment cards deal up with 60ms stagger, media never restarts → comments with replies show 1–2 stack edges, no count text → tap → reply overlay slides up over the current screen, back pops levels → Settings → Appearance flips VOID/DARK/LIGHT live and persists → image loads show 6c twin orbit, video/stream loads keep the original float → no category chips on posts, no emoji/green in messages/chat → every bolt/reply/repost/share/follow hits VoidAPI with optimistic UI.

## Claude Code prompt
> Apply design_handoff_void_patch3/README.md to void2-final.html — it is the COMPLETE patch (sections 0–10; PATCH-7e.md and PATCH-8b-thread.md are already merged into §6 and §4). Patches 1–2 are applied EXCEPT: revert/skip patch-2 A2 (nation restyle) and A6 (search restyle) per the RESCINDED block. Pixel reference: the bundled mockup (turn 9 thread animation, turn 8 8b/8f thread, turn 7 7e nation + nation-7e-reference.html, turn 6 6c loader, turn 5 nav/profile/composer/themes, turn 4 4d reels mode). Keep every existing id/handler/localStorage key working. Reuse the app's existing sparkle/float loader for all video/stream loads — never spinners, skeletons, or colored placeholders. Route ALL engagement through VoidAPI exactly as specified. One diff per section, in the listed order.
