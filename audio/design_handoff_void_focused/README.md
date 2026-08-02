# THE VOID — Focused Patch: 3d Audio · 2c Thread · 2e Messages

Target: `void2-final.html`. These three were skipped in the last pass — apply ONLY these. Do not touch feed, profile, settings, search, composer, viewer, nation, loader. Keep every existing id and handler working. No 1px borders anywhere — depth = background + shadow.

Tokens (in `:root`): `--gold:#c9a84c --purple:#7c3aed --glow:#5b21d4 --dim:#6a58a0 --white:#f4f0ff --muted:#231d42 --green:#10b981`. Secondary body text: `#c9bfe8`.

If the SVG icon system (`VICON`) from the previous patch is NOT yet in the file, add it first:

```js
const VI=(p,f)=>`<svg class="vi" viewBox="0 0 24 24" fill="${f?'currentColor':'none'}" ${f?'':'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${p}</svg>`;
const VICON={
  bolt:VI('<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>'),
  reply:VI('<path d="M21 12a8 8 0 0 1-8 8H4l2.2-2.6A8 8 0 1 1 21 12z"/>'),
  share:VI('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  play:VI('<path d="M7 4.5v15l13-7.5-13-7.5z"/>',1),
  pause:VI('<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z"/>',1),
  globe:VI('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>'),
  back:VI('<path d="M15 4l-8 8 8 8"/>'),
  send:VI('<path d="M3 11.5 21 3l-6.5 18-3-7.5L3 11.5z"/>',1),
  attach:VI('<path d="M21 12.5 12.7 20.8a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l8-8"/>'),
  lock:VI('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>')
};
```
CSS: `.vi{width:1.15em;height:1.15em;display:inline-block;vertical-align:-.18em;flex-shrink:0}`

---

## 1. AUDIO POSTS (mockup 3d) — replace the old audio rendering completely

Delete any existing `.post-audio*` CSS and the `style==='audio'` branch in the feed renderer. New branch:

```js
// inside the feed post renderer, when p.style==='audio' (i = post index)
const dur=97+(i*53)%140;
const bars=Array.from({length:26},(_,j)=>`<span class="au-bar" style="height:${6+Math.round((Math.sin(j*.9+i)*.5+.5)*20)}px"></span>`).join('');
mediaHtml=`<div class="au-pill" data-t="0" data-dur="${dur}" onclick="event.stopPropagation()">
  <button class="au-play" onclick="auToggle(this.parentNode)">${VICON.play}</button>
  <div class="au-wave" onclick="auScrub(this.parentNode,event)">${bars}</div>
  <span class="au-time">0:00<em> / ${auFmt(dur)}</em></span></div>`;
```

CSS:
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

JS (module-level):
```js
const auFmt=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
let auCur=null,auTimer=null;
function auStop(){if(auTimer)clearInterval(auTimer);auTimer=null;
  if(auCur){auCur.querySelector('.au-play').innerHTML=VICON.play;auCur=null;}}
function auToggle(pill){
  if(auCur===pill){auStop();return;} auStop();auCur=pill;
  pill.querySelector('.au-play').innerHTML=VICON.pause;
  auTimer=setInterval(()=>{
    let t=+pill.dataset.t+0.1,dur=+pill.dataset.dur;
    if(t>=dur){pill.dataset.t=0;auPaint(pill,0,dur,false);auStop();return;}
    pill.dataset.t=t;auPaint(pill,t,dur,true);
  },100);
}
function auPaint(pill,t,dur,playing){
  const bars=[...pill.querySelectorAll('.au-bar')],head=Math.floor(t/dur*bars.length);
  bars.forEach((b,j)=>{b.className='au-bar'+(j<head?' played':j===head?' head':'');
    if(playing&&Math.abs(j-head)<4)b.style.height=(8+Math.random()*20)+'px';});
  pill.querySelector('.au-time').innerHTML=`${auFmt(t)}<em> / ${auFmt(dur)}</em>`;
}
function auScrub(pill,e){const r=pill.querySelector('.au-wave').getBoundingClientRect();
  const f=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),dur=+pill.dataset.dur;
  pill.dataset.t=f*dur;auPaint(pill,f*dur,dur,auCur===pill);}
```

Behavior: gold play orb toggles play/pause; while playing, bars near the playhead jitter (live EQ feel); played bars turn gold, playhead bar glows; tap anywhere on the wave to scrub; only one pill plays at a time; timer text updates live. If the immersive viewer exists, reuse the same pill for audio items and call `auStop()` in `closeReel()`.

---

## 2. THREAD (mockup 2c) — restyle `#thread-overlay`

Keep `openThread/closeThread/submitComment/previewAttach`, `#thread-count`, and all ids. Visual rebuild:

- **Header**: remove border-bottom. Row `padding:16px 20px 8px; display:flex; align-items:center; gap:12px`: back (VICON.back, dim, 16px, closes) · `THREAD` Syne Mono 9px letter-spacing .3em dim · right: translate button = `VICON.globe` + `TR` in gold Syne Mono 8px (keep existing translate handler).
- **Original post** (`padding:14px 22px 18px`): avatar row — 34px avatar `box-shadow:0 0 0 2px rgba(124,58,237,.3)`, name Syne 700 12.5px white, handle+time Syne Mono 8px dim. Body = quote monument: **DM Serif Display italic 24px line-height 1.4 white**, `text-wrap:pretty`. Actions row margin-top 16px, Syne Mono 9px dim, gap 18px, VICON.bolt / VICON.reply counts + VICON.share right-aligned (each `display:inline-flex;align-items:center;gap:5px`).
- **Replies divider**: `N REPLIES` (reuse `#thread-count`) Syne Mono 7px .25em gold + `flex:1;height:1px;background:linear-gradient(90deg,rgba(201,168,76,.3),transparent)`.
- **Replies**: NO boxes/borders. Each: `display:flex;gap:11px;padding:8px 0 16px`. Left column: 26px avatar, and below it a vertical thread line `flex:1;width:1px;background:linear-gradient(rgba(201,168,76,.3),transparent);margin-top:6px` (last reply: no line). Right: name Syne 700 11px white + time mono 8px dim; body 12.5px line-height 1.55 color `#c9bfe8`.
- **Compose**: floating pill, replaces the old bar:
```css
.thread-compose{margin:8px 14px 16px;border-radius:26px;background:rgba(13,8,32,.95);backdrop-filter:blur(14px);box-shadow:0 -6px 24px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.07);display:flex;align-items:center;gap:10px;padding:10px 10px 10px 16px;border:none}
.thread-compose input{flex:1;background:transparent;border:none;font-size:12.5px;color:var(--white);outline:none}
.thread-send{width:36px;height:36px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#7c3aed,#5b21d4);color:#f4f0ff;box-shadow:0 4px 14px rgba(124,58,237,.4)}
.thread-send .vi{width:14px;height:14px}
```
Attach button = VICON.attach (dim) left of input, placeholder "add to the thread…". Send = VICON.send. Keep `submitComment()` on send + Enter.

---

## 3. MESSAGES (mockup 2e) — restyle the conversation list

Keep list container ids (`#me-conv-list` / `.conv-list`) and open-chat handlers.

- **Page header**: back (VICON.back dim) + title "Messages" **DM Serif Display 24px white** (not mono caps) + right `ENCRYPTED` tag: VICON.lock + text, Syne Mono 7px .2em green. No border-bottom.
- **Rows**: borderless — `display:flex;align-items:center;gap:13px;padding:13px 10px;border-radius:18px;cursor:pointer`. Remove all `border-bottom` between rows.
  - Avatar 44px circle, gradient background as now; **unread** rows: avatar adds `box-shadow:0 0 0 2px rgba(124,58,237,.4)` and the row gets `background:linear-gradient(90deg,rgba(124,58,237,.1),transparent 70%)`.
  - Middle (`flex:1;min-width:0`): name Syne 700 13px white; preview 11.5px, `white-space:nowrap;overflow:hidden;text-overflow:ellipsis`, color `#c9bfe8` when unread else dim, margin-top 2px.
  - Right column (`display:flex;flex-direction:column;align-items:flex-end;gap:5px`): time Syne Mono 8px dim uppercase (2M / 1H / 1D); unread dot `width:8px;height:8px;border-radius:50%;background:#c9a84c;box-shadow:0 0 10px rgba(201,168,76,.8)` (only when unread).
- **Footer line** centered under the list: `END-TO-END · NO ARCHIVE · NO ADS` Syne Mono 8px .2em color `#231d42`, margin-top 26px.
- Row hover/active: background `rgba(255,255,255,.03)`.

---

## Order & test
Audio → Thread → Messages, one diff each. Test: feed shows an audio post with working play/scrub → open a thread: serif monument + borderless replies + pill compose sends → messages list shows glow unread row, opening a chat still works.

## Claude Code prompt
> Apply design_handoff_void_focused/README.md to void2-final.html. ONLY the three sections (audio player, thread overlay, messages list) — everything else is already done, don't touch it. Use the exact code/values given; keep every existing id and handler working. One diff per section.
