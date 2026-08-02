# THE VOID — Patch 2 (final restyle + new systems)

Target: `void2-final.html`. **Feed (1b) and Profile monument (1d) are already applied — do not touch them**, except the specific removals below.

This patch has two kinds of work:
- **A. Restyle** (visual only, keep all ids/handlers): settings, nation overlay, thread, chat, loader, search skin.
- **B. New code + logic** (replace old implementations completely): composer, audio player, immersive viewer engine, icon system, scrollbar removal, banner removal.

The bundled `Profile + Settings Explorations.dc.html` is the visual reference (HTML mockups, not production code). Match it pixel-exactly. Striped/diagonal blocks in mockups = placeholders for real live embeds — never render stripes.

## Design tokens (already in `:root` — reuse)
`--bg:#04020c --bg2:#07041a --card:#0d0820 --glow:#5b21d4 --purple:#7c3aed --pdim:#2a1060 --gold:#c9a84c --gglow:rgba(201,168,76,.12) --white:#f4f0ff --dim:#6a58a0 --muted:#231d42 --red:#ef4444 --green:#10b981`

Shared recipes:
- Card: `background:rgba(13,8,32,.85); border-radius:18-20px; box-shadow:0 10px 30px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06)`; **no 1px borders**.
- Gold hairline: `height:1px; background:linear-gradient(90deg,rgba(201,168,76,.4),transparent)`.
- Pills: fully rounded (radius 16–28px), `rgba(255,255,255,.04)` idle / `rgba(201,168,76,.14)` + gold text active.
- Secondary body text: `#c9bfe8`.

---

## 0. GLOBAL — icons, scrollbars, banner (do this first)

### 0.1 Industry-standard SVG icon system (kill emoji/glyph action icons)
Add once near the top of the JS:

```js
const VI=(p,f)=>`<svg class="vi" viewBox="0 0 24 24" fill="${f?'currentColor':'none'}" ${f?'':'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${p}</svg>`;
const VICON={
  bolt:    VI('<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>'),
  boltFill:VI('<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>',1),
  reply:   VI('<path d="M21 12a8 8 0 0 1-8 8H4l2.2-2.6A8 8 0 1 1 21 12z"/>'),
  share:   VI('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  less:    VI('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  play:    VI('<path d="M7 4.5v15l13-7.5-13-7.5z"/>',1),
  pause:   VI('<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z"/>',1),
  globe:   VI('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>'),
  gear:    VI('<circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.07-.4.1-.8.1-1.2z"/>'),
  x:       VI('<path d="M5 5l14 14M19 5 5 19"/>'),
  back:    VI('<path d="M15 4l-8 8 8 8"/>'),
  send:    VI('<path d="M3 11.5 21 3l-6.5 18-3-7.5L3 11.5z"/>',1),
  attach:  VI('<path d="M21 12.5 12.7 20.8a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l8-8"/>'),
  search:  VI('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  pin:     VI('<path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>')
};
```
CSS: `.vi{width:1.15em;height:1.15em;display:inline-block;vertical-align:-.18em;flex-shrink:0}`

Replace **everywhere** in renderers and static HTML: 🔥/⚡→`VICON.bolt` (fired state = `boltFill` in gold), 💬/◈ counts→`VICON.reply`, ↗→`VICON.share`, ↓ LESS→`VICON.less`, 🌐/TR→`VICON.globe`+`TR`, ⚙→`VICON.gear`, 📎→`VICON.attach`, ➤→`VICON.send`, ✕→`VICON.x`, ←→`VICON.back`, 📍→`VICON.pin`. Wrap icon+count in `display:inline-flex;align-items:center;gap:5px`. Keep the brand glyphs ⬡ ◎ ◈ (nav/logo identity) — only action/UI icons change.

### 0.2 Kill all scrollbars app-wide
```css
*{scrollbar-width:none;-ms-overflow-style:none}
*::-webkit-scrollbar{display:none;width:0;height:0}
```

### 0.3 Remove the profile banner / cover-picker strip
Delete the `.profile-cover` element (and `.cover-palette`, particles) from `#screen-profile` HTML, plus `toggleCoverPicker` and cover-color persistence JS/CSS. The monument profile starts directly with the top row: `◎ ME` label left, gear (VICON.gear, gold) right — keep `openSettings()` on the gear. Page keeps its radial gradient background.

---

## A. RESTYLES

### A1. Settings — FULL PAGE, not a half sheet (ref: option 1f)
Current bottom-sheet renders half-screen — wrong. Rebuild as a full-screen page:
- `.settings-modal{position:fixed;inset:0;z-index:150;display:none;flex-direction:column;background:radial-gradient(120% 40% at 50% 0%,#10082a 0%,#04020c 60%)}` → `.open{display:flex}`. No dim backdrop, no drag handle, no rounded top, sheet fills 100%.
- Header row `padding:20px 24px 4px`: back arrow (VICON.back, dim, closes) + `SETTINGS` Syne Mono 9px letter-spacing .3em dim.
- Scrollable body `padding:10px 24px 24px` (scrollbar hidden).
- Section headers: DM Serif Display 20px white — "Identity", "Content", "About" — each followed by gold hairline.
- Rows: `display:flex;align-items:center;padding:12px 0`, **no borders**. Label Syne 600 13px white.
- Inputs (`s-name`,`s-handle`,`s-bio`): `background:rgba(255,255,255,.04);border:none;border-radius:12px;padding:9px 14px`; handle in gold Syne Mono.
- Language select pill: `padding:5px 11px;border-radius:16px;background:rgba(255,255,255,.06)` Syne Mono 10.5px.
- Toggles 40×23 r12: ON solid `#c9a84c` + `#04020c` 18px knob; OFF `rgba(255,255,255,.1)` + dim knob.
- "Clear all data" red 13px bold row with chevron.
- Save: full-width outlined gold pill `padding:13px;border-radius:24px;border:1px solid rgba(201,168,76,.5);color:var(--gold);background:transparent` Syne 800 12px .1em. Keep `saveSettings()`/`closeSettings()` and all ids.

### A2. Nation overlay `#c-overlay` (ref: 2d)
- Background `radial-gradient(120% 35% at 50% 0%,#12082e 0%,#04020c 55%)`; remove all borders.
- Header: eyebrow `JP · ASIA-PACIFIC` (iso + region) Syne Mono 8px .3em gold; country name DM Serif Display 32px white below. Right: LIVE pulse + close (VICON.x, keep `closeOverlay()`).
- Tabs `.ctab`: pills — active `padding:7px 16px;border-radius:20px;background:rgba(201,168,76,.14);color:var(--gold)`; inactive `rgba(255,255,255,.04)` dim. No underlines/border-bottom.
- Tiles `.csg-tile`: radius 14px (hero tile full-width 18px above 2-col grid), no border, `box-shadow:0 6px 18px rgba(0,0,0,.4)`; keep label gradient overlay + real embeds.

### A3. Thread `#thread-overlay` (ref: 2c)
- Header: back + `THREAD` Syne Mono 9px .3em dim + translate (VICON.globe TR, gold) right. No border-bottom.
- Original post: 34px avatar with purple ring shadow; body DM Serif Display italic 24px lh 1.4 (quote monument); actions Syne Mono 9px dim with VICON icons.
- `38 REPLIES` divider: Syne Mono 7px .25em gold + fading hairline (reuse `#thread-count`).
- Replies: no boxes; 26px avatar with fading 1px vertical gold thread-line beneath; name Syne 700 11px + mono time; body 12.5px lh 1.55 `#c9bfe8`.
- Compose: floating pill `margin:8px 14px 16px;border-radius:26px;background:rgba(13,8,32,.95);backdrop-filter:blur(14px);box-shadow:0 -6px 24px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.07);padding:10px 10px 10px 16px`; attach icon left; send = 36px circle `linear-gradient(135deg,#7c3aed,#5b21d4)` VICON.send white, glow `0 4px 14px rgba(124,58,237,.4)`. Keep `submitComment()`, ids, attach preview.

### A4. Messages + Chat (ref: 2e/2f)
- Conversation rows: borderless, `padding:13px 10px;border-radius:18px`; unread → `background:linear-gradient(90deg,rgba(124,58,237,.1),transparent 70%)` + 8px gold dot glow `0 0 10px rgba(201,168,76,.8)`; 44px avatars.
- Chat header: no border-bottom; soft `linear-gradient(rgba(13,8,32,.6),transparent)`; status `● ACTIVE IN THE VOID` Syne Mono 7px green.
- Incoming msgs: **no bubble** — 13px lh 1.55 `#c9bfe8`, mono 7px timestamp below. Outgoing: `padding:11px 15px;border-radius:18px 18px 4px 18px;background:linear-gradient(135deg,rgba(124,58,237,.35),rgba(91,33,212,.2));box-shadow:inset 0 1px 0 rgba(255,255,255,.08)` white, `✓✓`. Max-width 82%. Date divider Syne Mono 7px .25em `#231d42`.
- Compose: same floating pill as thread but gold send: `linear-gradient(135deg,#c9a84c,#8a6d2c)`, dark send icon, glow `0 4px 14px rgba(201,168,76,.35)`. Keep `sendChatMessage()`/`chatKeydown`.

### A5. Loader (ref: 2g) — **keep the existing sparkle/particle animation untouched**
Restyle only: logo `THE⬡VOID` Syne 800 26px .18em, ⬡ gold `text-shadow:0 0 24px rgba(201,168,76,.6)`; progress 150×2px track `rgba(255,255,255,.07)`, fill `linear-gradient(90deg,#7c3aed,#c9a84c)` glow (keep `#lfill` logic); `#ltxt` Syne Mono 8px .35em dim; bg `radial-gradient(80% 60% at 50% 45%,#0d0620 0%,#04020c 70%)`.

### A6. Search (ref: 3b) — KEEP the user's exact layout & content order
Structure stays exactly as-is: search bar + GO, filter pills row, then LIVE NOW hero stream, stream grid, SIGNAL FEED text results. Only the skin changes:
- `.search-head`: remove border-bottom → `background:linear-gradient(rgba(4,2,12,.92) 55%,transparent);backdrop-filter:blur(14px)`; header floats over results (results scroll under it — add top padding to results equal to header height).
- `.search-input` wrap → capsule: `border-radius:26px;background:rgba(13,8,32,.9);box-shadow:0 8px 24px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.07);border:none;padding:11px 16px` with gold search icon (VICON.search) inside left. GO button: `border-radius:26px;background:linear-gradient(135deg,#7c3aed,#5b21d4);box-shadow:0 6px 18px rgba(124,58,237,.35)`.
- `.filter-pill`: borderless — idle `background:rgba(13,8,32,.8);color:var(--dim)`; `.on` `background:rgba(201,168,76,.14);color:var(--gold)`.
- `.sg-item`: no border → card shadow recipe, radius 18px (grid tiles 14px). Section labels (LIVE NOW / SIGNAL FEED) keep position but use the gold hairline treatment.

---

## B. NEW SYSTEMS (full replacements)

### B1. Composer — strip and rebuild (ref: 3c)
Delete old `.composer-sheet` CSS/HTML entirely. New sheet (still bottom overlay via `#composer-overlay`, keep `openComposer/closeComposer/setComposerType/setComposerLink/submitComposerPost` names and `composerType/composerLink` logic):
- Sheet: `border-radius:26px 26px 0 0;background:radial-gradient(120% 50% at 50% 0%,#12082e 0%,#06031a 60%);box-shadow:0 -12px 48px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.07);padding:0 20px 26px` + 36×4 drag handle.
- Identity row: 34px avatar (gold ring shadow, initial from USER.name), name Syne 700 12px, `DROPPING INTO THE VOID` Syne Mono 7px .2em dim, close right.
- Textarea `#composer-text`: transparent, no border, DM Serif Display italic 24px lh 1.4 white, `caret-color:#c9a84c`, min-height 96px, placeholder "what's your signal" (italic serif, dim). Below: live char counter `280 − len` Syne Mono 7px .2em dim + gold hairline (counter turns red past limit; block submit >280).
- Type picker: 5 cards 64px wide `border-radius:18px;padding:12px 0`, icon 16px over Syne Mono 7px label — TEXT ◈, PHOTO ▣, VIDEO ▷, STACK ⊞, AUDIO ◉. Active card: `background:linear-gradient(160deg,rgba(124,58,237,.3),rgba(13,8,32,.9));box-shadow:0 6px 18px rgba(124,58,237,.25),inset 0 1px 0 rgba(255,255,255,.1)`, white. Idle: `rgba(13,8,32,.7)` + inset highlight, dim. (data-type: drop/image/video/carousel/audio — carousel is labeled STACK.)
- Link pills: ⊕ LIVE / ⊟ COUNTRY / ⊛ SEARCH — `padding:6px 13px;border-radius:20px;background:rgba(255,255,255,.04)` dim; toggled = gold bg/text.
- Submit: full-width `padding:14px;border-radius:26px;background:linear-gradient(135deg,#c9a84c,#8a6d2c);color:#04020c;font:800 13px Syne;letter-spacing:.22em;box-shadow:0 8px 28px rgba(201,168,76,.35)` — label `DROP ⬡`. Micro-interaction: on submit, button flashes and sheet slides down.
- FAB `#compose-fab`: 52px circle, `background:linear-gradient(135deg,#7c3aed,#5b21d4);border:none;border-radius:50%;color:#fff;font-size:24px;box-shadow:0 8px 24px rgba(124,58,237,.45)`, above the nav pill.

### B2. Audio player — real playback UI (ref: 3d)
Replace `.post-audio*` CSS and the audio branch in the feed renderer:

```js
// renderer branch for p.style==='audio'
const bars=Array.from({length:26},(_,j)=>`<span class="au-bar" style="height:${6+Math.round((Math.sin(j*.9+i)*.5+.5)*20)}px"></span>`).join('');
mediaHtml=`<div class="au-pill" data-t="0" data-dur="${97+(i*53)%140}" onclick="event.stopPropagation()">
  <button class="au-play" onclick="auToggle(this.parentNode)">${VICON.play}</button>
  <div class="au-wave" onclick="auScrub(this.parentNode,event)">${bars}</div>
  <span class="au-time">0:00<em> / ${auFmt(97+(i*53)%140)}</em></span></div>`;
```
```css
.au-pill{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:30px;margin-bottom:12px;background:linear-gradient(135deg,rgba(124,58,237,.18),rgba(13,8,32,.9) 65%);box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.au-play{width:38px;height:38px;border-radius:50%;border:none;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#c9a84c,#8a6d2c);color:#04020c;box-shadow:0 0 18px rgba(201,168,76,.4)}
.au-play .vi{width:15px;height:15px}
.au-wave{flex:1;display:flex;align-items:center;gap:2.5px;height:30px;cursor:pointer}
.au-bar{width:3px;border-radius:2px;background:#3b2a6a;transition:height .18s,background .18s}
.au-bar.played{background:#c9a84c}
.au-bar.head{background:#c9a84c;box-shadow:0 0 8px rgba(201,168,76,.6)}
.au-time{font-family:'Syne Mono',monospace;font-size:8px;color:#6a58a0;letter-spacing:.08em;flex-shrink:0}
.au-time em{font-style:normal;color:#3b2a6a}
```
```js
const auFmt=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
let auCur=null,auTimer=null;
function auStop(){if(auTimer)clearInterval(auTimer);auTimer=null;if(auCur){auCur.querySelector('.au-play').innerHTML=VICON.play;auCur=null;}}
function auToggle(pill){
  if(auCur===pill){auStop();return;} auStop();auCur=pill;
  pill.querySelector('.au-play').innerHTML=VICON.pause;
  auTimer=setInterval(()=>{
    let t=+pill.dataset.t+0.1,dur=+pill.dataset.dur;
    if(t>=dur){t=0;auStop();} pill.dataset.t=t;auPaint(pill,t,dur,true);
  },100);
}
function auPaint(pill,t,dur,playing){
  const bars=[...pill.querySelectorAll('.au-bar')],f=t/dur,head=Math.floor(f*bars.length);
  bars.forEach((b,j)=>{b.className='au-bar'+(j<head?' played':j===head?' head':'');
    if(playing&&Math.abs(j-head)<4)b.style.height=(8+Math.random()*20)+'px';});
  pill.querySelector('.au-time').innerHTML=`${auFmt(t)}<em> / ${auFmt(dur)}</em>`;
}
function auScrub(pill,e){const r=pill.querySelector('.au-wave').getBoundingClientRect();
  const f=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),dur=+pill.dataset.dur;
  pill.dataset.t=f*dur;auPaint(pill,f*dur,dur,false);}
```
Bars near the playhead jitter while playing (fake live EQ); gold = played; tap wave to scrub. Same pill in the reel viewer for audio items.

### B3. Immersive media viewer — full engine replacement (ref: 3e)
**Delete** `openReel/buildReels/updateReelCounter/closeReel` and reel CSS. The old one filtered `style==='image'` only and ran dry after 2 — replace with an infinite algorithmic queue over ALL media styles.

```js
// ─── IMMERSIVE VIEWER ENGINE ─────────────────────────────
const VW_STYLES=['image','video','carousel','audio'];
let vwQueue=[],vwSeen=new Set(),vwAff=JSON.parse(localStorage.getItem('void_aff')||'{}');
function vwBump(tags,d){(tags||[]).forEach(t=>{vwAff[t]=Math.max(-8,Math.min(8,(vwAff[t]||0)+d))});localStorage.setItem('void_aff',JSON.stringify(vwAff));}
function vwScore(p){
  const rec=1/(1+(Date.now()-p.time)/36e5);                    // recency
  const aff=(p.tags||[]).reduce((s,t)=>s+(vwAff[t]||0),0)/3;   // learned taste
  const ctr=Math.min(1,(p.replies||0)/Math.max(1,(p.score||1)/10)); // controversy
  return rec*2+aff*1.5+ctr+Math.random()*.6;                   // exploration noise
}
function vwFill(n=5){
  let pool=allPosts.filter(p=>VW_STYLES.includes(p.style)&&!vwSeen.has(p.id));
  if(pool.length<n){vwSeen.clear();vwQueue.slice(-3).forEach(p=>vwSeen.add(p.id.split('~')[0]));
    pool=allPosts.filter(p=>VW_STYLES.includes(p.style)&&!vwSeen.has(p.id));} // recycle, avoid immediate repeats
  const picks=pool.map(p=>[vwScore(p),p]).sort((a,b)=>b[0]-a[0]).slice(0,n)
    .map(([,p])=>{const c={...p};if(vwSeen.has(p.id)===false)vwSeen.add(p.id);
      c._vid=p.id+'~'+Math.random().toString(36).slice(2,6);return c;});
  vwQueue.push(...picks);return picks;
}
function openReel(postId){
  vwQueue=[];vwSeen=new Set();
  const start=allPosts.find(p=>p.id===postId);
  if(start){const c={...start,_vid:start.id+'~s'};vwQueue.push(c);vwSeen.add(start.id);}
  vwFill(5);
  const ov=document.getElementById('reel-overlay');ov.classList.add('open');
  const ct=document.getElementById('reel-container');
  ct.innerHTML=vwQueue.map(vwItemHtml).join('');
  vwObserve();ct.scrollTop=0;
  ct.onscroll=()=>{if(ct.scrollTop+ct.clientHeight*3>ct.scrollHeight){ // near end → append
    const add=vwFill(4);ct.insertAdjacentHTML('beforeend',add.map(vwItemHtml).join(''));vwObserve();}};
}
function vwItemHtml(p){
  const col=p._isoColor||`hsl(${p.imgHue||270},55%,14%)`;
  const media=p.style==='audio'
    ?`<div class="vw-audio-wrap">${/* reuse .au-pill markup from B2 */''}</div>`
    :`<div class="vw-cover" style="background:radial-gradient(120% 90% at 30% 20%,${col},#05020e 65%)"></div>`;
  return `<div class="vw-item" id="vw-${p._vid}" data-pid="${p.id.split('~')[0]}" ondblclick="vwFire(this)">
    ${media}<div class="vw-scan"></div>
    <div class="vw-rail">
      <div class="vw-act gold" onclick="vwReact(this,'fire',event)">${VICON.bolt}<span>${fmt(p.score)}</span></div>
      <div class="vw-act" onclick="openThread('${p.id.split('~')[0]}')">${VICON.reply}<span>${fmt(p.replies||0)}</span></div>
      <div class="vw-act" onclick="vwShare('${p.id.split('~')[0]}')">${VICON.share}<span>SHARE</span></div>
      <div class="vw-act dim" onclick="vwLess(this,event)">${VICON.less}<span>LESS</span></div>
    </div>
    <div class="vw-info">
      <div class="vw-id-row"><div class="vw-av" style="background:${col}">${(p._author||p.country||'V')[0]}</div>
        <span class="vw-name">${esc(p._author||p.country||'void')}</span>
        <span class="vw-tag">${(p.tags&&p.tags[0])||'void'}</span>
        <span class="vw-follow" onclick="this.textContent=this.textContent==='FOLLOW'?'FOLLOWING':'FOLLOW'">FOLLOW</span></div>
      <div class="vw-body">${esc(p.body)}</div>
      <div class="vw-meta">${VICON.pin} ${(p.country||'WORLD').toUpperCase()} · ${ago(p.time)} · SWIPE ↑</div>
      <div class="vw-spine"><i></i></div></div></div>`;
}
function vwObserve(){
  const ct=document.getElementById('reel-container');
  if(window._vwObs)window._vwObs.disconnect();
  window._vwObs=new IntersectionObserver(es=>es.forEach(e=>{
    if(e.isIntersecting&&e.intersectionRatio>.5){
      const items=[...ct.querySelectorAll('.vw-item')],idx=items.indexOf(e.target);
      document.getElementById('reel-counter').textContent=`${idx+1} / ∞`;
      const pid=e.target.dataset.pid,p=allPosts.find(x=>x.id===pid);
      if(p)vwBump(p.tags,.3); // dwell = mild positive signal
      e.target.querySelector('.vw-spine i').style.width='100%'; // spine fills per item
    }}),{threshold:.5});
  ct.querySelectorAll('.vw-item').forEach(el=>window._vwObs.observe(el));
}
function vwFire(item){const pid=item.dataset.pid,p=allPosts.find(x=>x.id===pid);
  if(p){react(pid,'fire',{stopPropagation(){}} );vwBump(p.tags,1.5);}
  const f=document.createElement('div');f.className='vw-burst';f.innerHTML=VICON.boltFill;
  item.appendChild(f);setTimeout(()=>f.remove(),700);}
function vwReact(el,kind,e){e.stopPropagation();const item=el.closest('.vw-item');vwFire(item);}
function vwLess(el,e){e.stopPropagation();const item=el.closest('.vw-item');
  const p=allPosts.find(x=>x.id===item.dataset.pid);if(p)vwBump(p.tags,-2.5);
  item.nextElementSibling?item.nextElementSibling.scrollIntoViewIfNeeded?item.nextElementSibling.scrollIntoViewIfNeeded():document.getElementById('reel-container').scrollBy({top:item.offsetHeight,behavior:'smooth'}):null;}
function vwShare(pid){navigator.clipboard&&navigator.clipboard.writeText(location.href.split('#')[0]+'#'+pid);showPtrFlash&&showPtrFlash(300);}
function closeReel(){document.getElementById('reel-overlay').classList.remove('open');if(window._vwObs)window._vwObs.disconnect();auStop&&auStop();}
```
(NOTE: do not use scrollIntoView variants if you prefer — `container.scrollBy({top:itemHeight})` is fine for LESS-advance.)

CSS:
```css
#reel-container{flex:1;overflow-y:scroll;scroll-snap-type:y mandatory;overscroll-behavior:contain}
.vw-item{height:100%;min-height:100vh;scroll-snap-align:start;scroll-snap-stop:always;position:relative;overflow:hidden;background:#05020e}
.vw-cover{position:absolute;inset:0}
.vw-scan{position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(255,255,255,.012) 3px,rgba(255,255,255,.012) 4px)}
.vw-rail{position:absolute;right:12px;bottom:130px;z-index:3;display:flex;flex-direction:column;gap:8px;align-items:center}
.vw-act{width:46px;height:46px;border-radius:50%;background:rgba(13,8,32,.65);backdrop-filter:blur(10px);box-shadow:inset 0 1px 0 rgba(255,255,255,.1);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;color:#f4f0ff;gap:1px}
.vw-act .vi{width:17px;height:17px}
.vw-act span{font-family:'Syne Mono',monospace;font-size:6.5px;color:rgba(255,255,255,.6);letter-spacing:.05em}
.vw-act.gold{color:#c9a84c}.vw-act.gold span{color:#c9a84c}.vw-act.dim{color:#6a58a0}.vw-act.dim span{color:#6a58a0}
.vw-info{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:100px 70px 24px 18px;background:linear-gradient(transparent,rgba(4,2,12,.95) 70%)}
.vw-id-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.vw-av{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#f4f0ff;box-shadow:0 0 0 2px rgba(201,168,76,.5)}
.vw-name{font-size:12px;font-weight:700;color:#f4f0ff}
.vw-tag{padding:2px 8px;border-radius:16px;background:rgba(239,68,68,.15);font-family:'Syne Mono',monospace;font-size:7px;letter-spacing:.12em;color:#ef4444;text-transform:uppercase}
.vw-follow{padding:2px 10px;border-radius:16px;border:1px solid rgba(201,168,76,.5);font-family:'Syne Mono',monospace;font-size:7px;letter-spacing:.12em;color:#c9a84c;cursor:pointer}
.vw-body{font-family:'DM Serif Display',serif;font-style:italic;font-size:20px;line-height:1.38;color:#f4f0ff;text-wrap:pretty}
.vw-meta{display:flex;align-items:center;gap:4px;font-family:'Syne Mono',monospace;font-size:8px;color:rgba(255,255,255,.45);letter-spacing:.12em;margin-top:8px}
.vw-spine{height:2px;border-radius:1px;margin-top:12px;background:rgba(255,255,255,.12);overflow:hidden}
.vw-spine i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7c3aed,#c9a84c);transition:width 6s linear}
.vw-burst{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9;color:#c9a84c;animation:vwB .7s ease forwards;pointer-events:none}
.vw-burst .vi{width:84px;height:84px;filter:drop-shadow(0 0 24px rgba(201,168,76,.8))}
@keyframes vwB{0%{transform:translate(-50%,-50%) scale(.4);opacity:0}25%{opacity:1}100%{transform:translate(-50%,-50%) scale(1.4);opacity:0}}
```
Top chrome: glass back button (36px circle, blur), `FOR YOU · <TAG>` Syne Mono 8px .25em label (tag = current item's top tag), counter `n / ∞` top-right. Header gradient `linear-gradient(rgba(0,0,0,.6),transparent)` 90px.

Behavior summary: opens on ANY media post → seeds queue with that post + 5 ranked picks; ranking = recency + learned tag affinity (persisted `void_aff` in localStorage) + controversy + noise; appends 4 more whenever within 3 screens of the end (never runs dry — recycles with fresh ids when pool exhausts, avoiding immediate repeats); snap paging; double-tap anywhere = bolt burst + react + affinity up; LESS = affinity down + auto-advance; dwell mildly bumps affinity; audio items show the B2 player pill center-screen.

Also update the feed renderer click hook: any `image|video|carousel|audio` media click → `openReel(id)` (was image/video only).

## Order of work
0.1 icons → 0.2 scrollbars → 0.3 banner → A1 settings → A6 search → B1 composer → B2 audio → B3 viewer → A2 nation → A3 thread → A4 chat → A5 loader. Show a diff per step. All existing ids, handlers, localStorage keys, globe, and translate logic must keep working. Test: post an audio drop from the new composer → appears in feed with player → click any media → viewer scrolls forever.

## Suggested Claude Code prompt
> Apply the patch in design_handoff_void_patch2/README.md to void2-final.html. Feed + profile monument are already done — don't touch them except section 0.3 (remove the cover banner strip). Follow the spec values and code exactly; use the bundled mockup HTML as visual reference (options 3b search, 3c compose, 3d audio, 3e viewer, 2c/2d/2f/2g, 1f settings AS A FULL PAGE). Keep every existing id/handler working. Work in the listed order, one step per diff.
