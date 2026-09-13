# PATCH 7e — Nation overlay: Cinema LIVE CTA + nation-seeded feed (1:1 spec)

Target: `void2-final.html`. Pixel reference: bundled `nation-7e-reference.html` (exact standalone mock, and turn 7 → 7e in `Profile + Settings Explorations.dc.html`). This patch REPLACES section 6 of `design_handoff_void_patch3/README.md` — everything else there still applies.

## Hard rules
1. **NO colored/striped placeholder blocks anywhere.** The purple/blue radial-gradient tiles in earlier mocks were mock stand-ins ONLY. Every real media surface is: the user's EXISTING loading animation → the real stream/video frame.
2. **Loading states use the app's own loaders, never spinners/skeletons/shimmer:**
   - Live streams + videos → the app's original sparkle/float loader, hardcoded, untouched.
   - Images → the 6c twin counter-rotating orbit loader (patch3 §8).
3. **The LIVE hero autoplays instantly** — real stream for the tapped country, muted inline, no poster placeholder.
4. **The feed below is populated from that exact country on open** — not global, not stale.

## A. Markup — overlay body (keep existing header/skin + `closeOverlay()` untouched)

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

## B. Logic — exact code

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

## C. Reel handoff
`openReel(id,{nation:iso})` seeds the reel queue nation-first: pool `p.country===iso` (ranked by `vwScore`) until exhausted, then blended global. Same viewer engine, same rail, same VoidAPI calls.

## Test
Globe → tap Japan → overlay opens with original header → hero shows the sparkle/float loader, then the Japan live stream fades in ALREADY PLAYING (muted) → TRENDING/ABOUT cards filled from Japan ranking → scroll: THE FEED · JAPAN, Japan-only posts, image loads show the 6c orbit → tap hero/card/feed media → reels seeded Japan-first → tap another country → everything repopulates for that ISO. Zero colored placeholder tiles anywhere.

## Claude Code prompt
> Apply design_handoff_void_patch3/PATCH-7e.md to void2-final.html (it replaces §6 of README.md; the rest of README.md still applies). Pixel reference: nation-7e-reference.html. Reuse the app's existing sparkle/float loader for the hero and all video/stream loads — do NOT introduce spinners, skeletons, or colored placeholder blocks. Keep closeOverlay(), the overlay header/skin, and all existing ids/handlers working.
