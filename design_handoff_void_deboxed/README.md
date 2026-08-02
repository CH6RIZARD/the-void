# Handoff: THE VOID — De-boxed UI Restyle

## Overview
Restyle of the existing single-file app `void2-final.html` (THE VOID, mobile social app). The color palette, fonts, content, and ALL existing JavaScript behavior stay exactly as they are. This is a **visual restyle only**: replace the boxy 1px-border-everywhere layout with a softer language of floating cards, glass blur, pill shapes, gradient hairlines, and glow shadows.

**IMPORTANT — do not touch:**
- The existing JS (feed logic, globe (three.js), translate, localStorage, messaging, etc.)
- The color variables in `:root`
- The fonts (Syne, Syne Mono, DM Serif Display)
- The loader's existing sparkle/particle animation — KEEP IT. Only restyle the loader's logo/progress bar as specified in Screen 7.
- Any striped/diagonal-pattern blocks shown in the mockups are **placeholders for live embeds/thumbnails** — the real iframes/videos stay; do not add stripes anywhere.

## About the Design Files
`Profile + Settings Explorations.dc.html` in this bundle is a **design reference created in HTML** — mockups showing intended look, not production code. Recreate the chosen options inside `void2-final.html`'s existing CSS/markup, reusing its classes and JS hooks (ids, onclick handlers must keep working).

Chosen options: **1b** (feed), **1d** (profile), **1f** (settings), **2d** (nation overlay), **2c** (thread), **2f** (chat), **2g** (loader).

## Fidelity
**High-fidelity.** Recreate pixel-perfectly. All values below are exact.

## Design Tokens (already in the app's `:root` — reuse them)
- `--bg:#04020c --bg2:#07041a --card:#0d0820 --card2:#130b2e --border:#1a1232`
- `--glow:#5b21d4 --purple:#7c3aed --pdim:#2a1060`
- `--gold:#c9a84c --gdim:#5c4420 --gglow:rgba(201,168,76,.12)`
- `--white:#f4f0ff --dim:#6a58a0 --muted:#231d42 --red:#ef4444 --green:#10b981`

New shared recipes (add as needed):
- **Card shadow**: `box-shadow: 0 10px 30px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06)`
- **Gold hairline**: `height:1px; background:linear-gradient(90deg,transparent,rgba(201,168,76,.25),transparent)` (or one-sided fade)
- **Diamond divider** (feed/profile): flex row — fading hairline, `◆` in gold at 8px, fading hairline
- **Reply-text color** (secondary body text): `#c9bfe8`
- **Radii scale**: inputs/selects 12px; media 13-14px; cards 18-20px; sheets 22px; pills/bars/compose 20-28px (fully rounded)
- Kill almost all `border:1px solid var(--border)` usage on cards/rows — depth comes from background + shadow instead.

---

## Screens

### 1. Feed — `#screen-void` (option 1b: floating glass cards)
- Header: keep `.bio-hud` content but remove its `border-bottom`; logo unchanged.
- Each `.post` becomes a floating card, not a full-bleed bordered row:
  - Card: `background:rgba(13,8,32,.85); border-radius:20px; padding:18px; margin:0 16px 12px;` card shadow (above). No border, no `border-bottom`.
  - First/highlight post may use `background:linear-gradient(160deg,rgba(124,58,237,.14),rgba(13,8,32,.9) 60%)` + `backdrop-filter:blur(10px)`.
  - Avatar 32px, add `box-shadow:0 0 0 2px rgba(124,58,237,.35)` (purple accts) — gold accts use gold at .35.
  - Topic tag becomes a pill: `padding:3px 8px; border-radius:20px; background:rgba(201,168,76,.1); color:var(--gold); font:Syne Mono 7px; letter-spacing:.14em` (purple variant: `rgba(124,58,237,.12)` / `#a78bfa`).
  - `.post-media`: no longer full-bleed negative margin — stays inside the card, `border-radius:13px; overflow:hidden`.
  - Action row unchanged functionally; 9px Syne Mono, gap 16px, dim color.
- Bottom nav `.bnav`: floating pill — `margin:12px 16px 16px; border-radius:24px; background:rgba(13,8,32,.9); backdrop-filter:blur(14px); box-shadow:0 -4px 24px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.06); padding:10px 18px`. Remove top border. Active item icon gold. Feed scrolls behind it.

### 2. Profile — `#screen-profile` (option 1d: centered monument)
Replace the left-aligned info bar with a centered layout. Keep all ids (`p-avatar`, `p-name`, `p-handle`, `p-bio`, `p-posts`, `p-following`, `p-followers`) and the cover-picker + settings-gear behavior.
- Top row: left `◎ ME` label (Syne Mono 8px, .25em, dim); right gear `⚙` in gold (keeps `openSettings()`).
- Page background: `radial-gradient(100% 55% at 50% 0%, #170a38 0%, #04020c 60%)`. The user's chosen cover color can tint the top of this gradient (keep cover-picker working; tapping the top area still opens the palette).
- Avatar: centered, 96px circle, `background:linear-gradient(135deg,#7c3aed,#1a0840)`, font-size 34px, `box-shadow:0 0 0 2px #04020c, 0 0 0 4px rgba(201,168,76,.6), 0 0 40px rgba(124,58,237,.45)` (gold ring + purple glow).
- Name: DM Serif Display 26px, white, margin-top 16px, centered.
- Handle: Syne Mono 10px gold, letter-spacing .16em, margin-top 4px.
- Bio: DM Serif Display italic 14px dim, margin-top 10px.
- Stats: 3 glass pills centered, gap 8px, margin-top 18px. Pill: `padding:9px 16px; border-radius:16px; background:rgba(13,8,32,.8); inset highlight shadow`. Number Syne 800 15px white (VOICES number in gold); label Syne Mono 7px .14em dim.
- Tabs (`.me-tab`): pills instead of underline — active: `padding:8px 18px; border-radius:20px; background:rgba(201,168,76,.12); color:var(--gold)`; inactive same padding, transparent, dim. Syne Mono 8px .16em.
- Content pane: one soft container `margin:16px 16px 20px; border-radius:20px; background:rgba(13,8,32,.6); inset highlight; padding:20px`. Inside, user drops separated by the gold hairline (no bordered rows).

### 3. Settings — `#settings-modal` (option 1f: airy page, serif headers)
Keep the bottom-sheet mechanic (`openSettings`/`closeSettings`, ids `s-name`, `s-handle`, `s-bio`, `s-lang`, `s-autoplay`, `s-notify`) but restyle the inside:
- Sheet: `border-radius:22px 22px 0 0`, background `radial-gradient(120% 40% at 50% 0%, #10082a 0%, #04020c 60%)`, no border. Keep drag handle.
- Header: back/close row with `SETTINGS` in Syne Mono 9px .3em dim (no big bold title bar, no border-bottom).
- Section headers: DM Serif Display 20px white ("Identity", "Content", "About"), each followed by a one-sided gold hairline `linear-gradient(90deg,rgba(201,168,76,.4),transparent)`.
- Rows: `display:flex; align-items:center; padding:12px 0;` — **no row borders**. Label Syne 600 13px white; value on the right (dim, or gold mono for handle).
- Inputs keep their ids but style as soft fills: `background:rgba(255,255,255,.04); border:none; border-radius:12px; padding:9px 14px`.
- Language select: pill `padding:5px 11px; border-radius:16px; background:rgba(255,255,255,.06); Syne Mono 10.5px`.
- Toggles: 40×23px, radius 12px; ON = solid gold `#c9a84c` with dark `#04020c` 18px knob; OFF = `rgba(255,255,255,.1)` with dim knob.
- Clear all data: red 13px bold row with `›` chevron.
- Save button: outlined gold pill — `padding:13px; border-radius:24px; border:1px solid rgba(201,168,76,.5); color:var(--gold); background:transparent; Syne 800 12px .1em; width:100%` (keeps `saveSettings()`).

### 4. Nation overlay — `#c-overlay` (option 2d)
- Background: `radial-gradient(120% 35% at 50% 0%, #12082e 0%, #04020c 55%)`, no borders anywhere.
- Header: country code + region eyebrow line in Syne Mono 8px .3em gold (e.g. `JP · ASIA-PACIFIC`), then country name in **DM Serif Display 32px** white. Right side: LIVE pulse tag + `✕` close (keeps `closeOverlay()`).
- Tabs (`.ctab`): pills — active `padding:7px 16px; border-radius:20px; background:rgba(201,168,76,.14); color:var(--gold)`; inactive `rgba(255,255,255,.04)` dim. No underline, no border-bottom on the tab row.
- Live grid tiles (`.csg-tile`): `border-radius:14px` (hero tile 18px, full-width, above the 2-col grid), **no border**, `box-shadow:0 6px 18px rgba(0,0,0,.4)`. Label gradient overlay stays. Real embeds fill the tiles (stripes in mockup = placeholder only).

### 5. Thread — `#thread-overlay` (option 2c)
- Header: `←` back + `THREAD` Syne Mono 9px .3em dim + translate `🌐 TR` in gold on the right. No border-bottom.
- Original post: avatar row (34px avatar with 2px purple ring shadow), then the body in **DM Serif Display italic 24px, line-height 1.4** — a quote monument. Actions row below in Syne Mono 9px dim.
- Replies divider: `38 REPLIES` Syne Mono 7px .25em gold + one-sided fading gold hairline. (Reuse `#thread-count`.)
- Replies: no bordered boxes. 26px avatar; a 1px vertical thread line under the avatar fading out (`linear-gradient(rgba(201,168,76,.3),transparent)`); name Syne 700 11px white + time mono 8px dim; body 12.5px line-height 1.55 color `#c9bfe8`.
- Compose (`.thread-compose`): floating pill — `margin:8px 14px 16px; border-radius:26px; background:rgba(13,8,32,.95); backdrop-filter:blur(14px); shadow + inset highlight; padding:10px 10px 10px 16px`. Attach `📎` dim on the left, placeholder text dim, send = 36px circle `linear-gradient(135deg,#7c3aed,#5b21d4)` with `➤`, glow `0 4px 14px rgba(124,58,237,.4)`. Keep `submitComment()`, `previewAttach()`, ids.

### 6. Chat — `#chat-window` + conversation list (options 2e-lite + 2f)
- Conversation list (`.conv-list`, `#me-conv-list`): borderless rows `padding:13px 10px; border-radius:18px`; unread row gets `background:linear-gradient(90deg,rgba(124,58,237,.1),transparent 70%)` and an 8px gold dot with glow `0 0 10px rgba(201,168,76,.8)`. 44px avatars.
- Chat header: 38px avatar, name Syne 700 13px, status `● ACTIVE IN THE VOID` Syne Mono 7px green .12em. No border-bottom; use a soft top gradient `linear-gradient(rgba(13,8,32,.6),transparent)`.
- Messages: incoming = **no bubble** — plain text 13px lh 1.55 color `#c9bfe8`, timestamp mono 7px dim below. Outgoing = soft bubble `padding:11px 15px; border-radius:18px 18px 4px 18px; background:linear-gradient(135deg,rgba(124,58,237,.35),rgba(91,33,212,.2)); inset 0 1px 0 rgba(255,255,255,.08)`, white text, `✓✓` in timestamp. Max-width 82%. Date divider centered Syne Mono 7px .25em `#231d42`.
- Compose: same floating pill as thread compose, but send button gold: `linear-gradient(135deg,#c9a84c,#8a6d2c)`, dark `➤`, glow `0 4px 14px rgba(201,168,76,.35)`. Keep `sendChatMessage()`, `chatKeydown`.

### 7. Loader — `#loader` (option 2g)
**Keep the existing sparkle/particle animation exactly as-is.** Restyle only:
- Logo: `THE⬡VOID` Syne 800 26px .18em; the `⬡` gold with `text-shadow:0 0 24px rgba(201,168,76,.6)`.
- Progress: 150px × 2px track `rgba(255,255,255,.07)`, fill `linear-gradient(90deg,#7c3aed,#c9a84c)` with glow `0 0 12px rgba(201,168,76,.6)` (keep `#lfill` width logic).
- Status text (`#ltxt`): Syne Mono 8px .35em dim.
- Background: `radial-gradient(80% 60% at 50% 45%, #0d0620 0%, #04020c 70%)`.

## Interactions & Behavior
All existing handlers, ids, tab switching, localStorage, translate, globe, and cover-picker logic are unchanged. Transitions: keep existing durations; hover/active states shift background alpha up (~+.04) or border-glow, never add hard borders. `text-wrap:pretty` on all multi-line body copy.

## Assets
No new assets. Glyphs are unicode (◆ ◎ ⬡ ⊗ ◈ ➤ 📎 ⚙). Striped blocks in mockups = embed placeholders only.

## Files
- `Profile + Settings Explorations.dc.html` — visual reference. Turn 1: 1b (feed), 1d (profile), 1f (settings). Turn 2: 2c (thread), 2d (nation), 2e/2f (messages/chat), 2g (loader).
- Target: your `void2-final.html`.

## Suggested prompt for Claude Code
> Apply the restyle described in design_handoff_void_deboxed/README.md to void2-final.html. Visual-only: keep every id, handler, and all JS logic working. Follow the spec values exactly; use the bundled mockup HTML as the visual reference. Work screen by screen (feed → profile → settings → nation overlay → thread → chat → loader) and show me a diff per screen.
