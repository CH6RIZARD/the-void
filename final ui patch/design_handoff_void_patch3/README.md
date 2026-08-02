# THE VOID — Patch 3 · UI FINAL REDESIGN + LOGIC PATCHES (for the Claude Code agent)

**Status: FINAL.** This is the definitive UI redesign plus its logic patches. Apply every visual identically across all three themes — VOID / DARK / LIGHT — through the section-7 CSS variables (never hardcode a theme's color in a renderer).

**Delivery**: this folder (`design_handoff_void_patch3/`) is meant to sit in the repo next to `void2-final.html`; the bundled `Profile + Settings Explorations.dc.html` is the pixel reference.

Target: `void2-final.html`. Visual reference: bundled `Profile + Settings Explorations.dc.html` — **turn 5 supersedes turn 4 for nav, profile, composer**; turn 4 still rules thread (4c), globe dual-mode (4d/4e), nation layout (4f). Match pixel-exactly. Striped blocks = placeholders for real embeds. No 1px borders for depth (hairlines for structure are fine). Tokens unchanged; new neutral: inactive/dim icon `#5c4d8a`.

## ⚠ RESCINDED — do NOT apply, and revert if already applied
- **Patch 2 A2 (nation overlay restyle)** — the user's ORIGINAL nation overlay skin stays. Section 5 below only inserts new content into it.
- **Patch 2 A6 (search restyle)** — the user's original/current search screen is final. Do not touch search at all.
- Mockups 2a/2b/2c/2d/3a/3b/3c/4a/4b/4e are dead references (4e globe-mode mock removed — the original globe screen is the spec; 3c composer + 4b profile superseded by 5c/5b; 4a nav + 2c thread superseded by 5a-B / 4c; nav alternates 5a-A/5a-C dropped).

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

## 4. THREAD v3 (ref 4c, icons at 1.5px)
As previously specced: original-post actions bolt/reply/**repost**/share; `TOP`/`NEW` sort chips on the replies divider (TOP = bolts desc, NEW = time desc, re-render on toggle); per-reply mini actions (bolt+count, REPLY → focuses compose, prefixes `@name`, submits nested with `parentId`); nested replies indented 39px, 22px avatar, `OP` chip when replier = thread author; 28px avatars with fading gold thread-line when a reply has children. **No category chip on the original post** (see section 8). Keep `openThread/closeThread/submitComment`, `#thread-count`, translate.

## 5. GLOBE TAB — DUAL MODE (ref 4d/4e). One tab, two views.
GLOBE nav opens `#screen-globe` in **REELS mode by default**; floating top-center segmented toggle (glass capsule) flips REELS ⇄ GLOBE; persist `localStorage('void_globe_mode')`.
- **REELS (ref 4d — this UI/format is approved)**: patch-2 immersive engine (B3) rendered inline in the tab. **NOT country-specific by default** — the queue is the general FOR YOU ranking (`vwScore`: recency + tag affinity + controversy + noise, live streams eligible alongside posts). No geo boost here. Sub-caption `FOR YOU · SEEDED BY YOUR SIGNALS`. Side rail: bolt / reply→openThread / repost / share (1.5px icons). Nav stays visible. Country-scoped reels exist ONLY via globe → tap nation → tap media (section 6).
- **GLOBE (no mockup — deliberately)**: the user's ORIGINAL globe screen, byte-for-byte unchanged, with only the toggle pinned above it; tapping a nation opens section 6.

## 6. NATION v3 (ref 4f layout, ORIGINAL overlay skin)
Keep `closeOverlay()`, the open-from-globe handler, and the overlay's **existing header/skin exactly as it is in the app today**. Changes inside the body only:
- **Delete the LIVE/FEED `.ctab` pills.**
- Insert ranked CTA block: label `FOR YOU · RANKED FOR <NATION>` gold mono + hairline + `TAP → REELS` hint; 3 portrait tiles (flex, gap 8, aspect 9/14, r16, shadow), 32px glass play button, bottom gradient label (title + viewer count), top-left badge `◉ LIVE` red / `TRENDING` gold / `ABOUT <ISO>` purple. `rankNation(iso)`: streams + nation posts + about-nation items scored by interest affinity + geo + live bonus + view velocity; top 3, ≥1 stream and ≥1 about item when available.
- Below: `THE FEED · <NATION>` label + hairline, then the standard feed renderer seeded to that nation. One scrolling column.
- Every media tap (tiles + embeds) → `openReel(id)` seeded nation-first (`p.country===iso` pool, then blended global).
- **Loading states in the nation UI** (and the 4f mock now shows this): image tiles/embeds show the section-8 **6c twin-orbit loader** while loading — never striped placeholders; video/stream tiles keep the original hardcoded sparkle-float loader.

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
0 icons v2 → 1 nav → 2 profile → 3 composer → 4 thread → 5 globe dual-mode → 6 nation → 7 themes → 8 media loading → 9 cleanup sweep → 10 VoidAPI sweep. One diff each. Test: nav shows hairline icons w/ gold underline → composer has text tabs + plain DROP → globe tab opens reels, toggles to globe, tap nation → original overlay + 3 ranked tiles + one feed → tile → nation-seeded reels → thread sorts + nests replies → Settings → Appearance flips VOID/DARK/LIGHT live and persists across reload → image loads show the circling-sparkle ring while video/stream loads keep the original float → no category chips on any post, no emoji/green in messages/chat → all engagement hits VoidAPI.

## Claude Code prompt
> Apply design_handoff_void_patch3/README.md to void2-final.html. Patches 1–2 are applied EXCEPT: revert/skip patch-2 A2 (nation restyle) and A6 (search restyle) per the RESCINDED block. Use the bundled mockup (turn 5: 5a nav — 5 tabs incl DMS, 5b profile, 5c composer with real gallery/mic capture, 5d–5f themes; turn 4: 4c thread, 4d/4e globe dual-mode, 4f nation layout) as pixel reference. Keep every existing id/handler/localStorage key working. Route ALL engagement through VoidAPI exactly as specified. One diff per section, in the listed order.
