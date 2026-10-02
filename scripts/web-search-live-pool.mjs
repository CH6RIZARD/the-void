// SEARCH'S LIVE TILES DRAW FROM THE WHOLE POOL, NOT A HARDCODED LIST OF NINE.
//
// Every LIVE slot on the search page was LIVE_CHANNELS[k]: the same nine
// YouTube channels, in the same order, for every person on every visit - and
// each slot's only fallback was GLOBAL_POOL, which is an empty array, so a
// channel that was not confirmed live sat on NO SIGNAL forever. That is why the
// page has shown DW / SKY / WION / BLOOMBERG with half of them dead, unchanged,
// for two weeks, through every other patch.
//
// The slots now draw from the probed HLS pool (2,500+ streams across 155
// countries): shuffled per session so no two visits lead with the same wall,
// each slot carrying a chain of candidates so a dead url cascades to the next
// instead of parking on NO SIGNAL. No YouTube here either - same rule as the
// globe wall, and these tiles ride the same /hls proxy rescue when a stream
// refuses CORS.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const L = (...x) => x.join('\n');
const f = fileURLToPath(new URL('../void2-final.html', import.meta.url));
let s = readFileSync(f, 'utf8'); const crlf = s.includes('\r\n'); s = s.replace(/\r\n/g, '\n');
const rep = (a, b) => { const n = s.split(a).length - 1; if (n !== 1) { console.log('ANCHOR x' + n + ': ' + a.slice(0, 90)); process.exit(1); } s = s.split(a).join(b); };

// ── the slot builders: a slot is a CHAIN from the pool, not a channel id ────
rep(L(
"// Search LIVE-NOW tiles: real connection engine (YouTube news, with global-pool",
"// fallback), instead of raw un-detected iframes.",
"function liveFeatSlot(ch){return `<div class=\"search-live-feat\"><div class=\"search-live-slot\" data-yt=\"${ch.id}\" data-nolabel=\"1\"></div><div class=\"search-live-feat-overlay\"></div><div class=\"search-live-feat-info\"><div class=\"search-live-badge2\"><span class=\"strip-live-dot\"></span>LIVE</div><div class=\"search-live-feat-name\">${esc(ch.n)}</div></div></div>`;}",
"function liveTileSlot(ch){return `<div class=\"search-live-tile\"><div class=\"search-live-slot\" data-yt=\"${ch.id}\" data-nolabel=\"1\"></div><div class=\"search-live-tile-lbl\">${esc(ch.n)}</div></div>`;}",
"function liveRow(chs){return `<div class=\"search-live-row\">${chs.map(liveTileSlot).join('')}</div>`;}",
"function hydrateLiveTiles(root){",
"  root.querySelectorAll('.search-live-slot').forEach(el=>{",
"    if(el.dataset.hydrated)return;el.dataset.hydrated='1';",
"    connectTile(el,[{type:'youtube',id:el.dataset.yt,label:'LIVE'},...GLOBAL_POOL]);",
"  });",
"}",
), L(
"// Search LIVE-NOW tiles, from the probed HLS pool - not a hardcoded channel",
"// list. Every slot used to be LIVE_CHANNELS[k]: the same nine YouTube channels",
"// in the same order on every visit, each with GLOBAL_POOL (an empty array) as",
"// its only fallback, so an unconfirmed channel sat on NO SIGNAL forever. The",
"// pool is shuffled once per session; each slot takes a chain of candidates so a",
"// dead url cascades instead of parking; the label follows whatever actually",
"// connected. HLS only, like the wall - these are the tiles that kept wearing",
"// YouTube chrome.",
"let _searchLivePool=null,_searchLiveCur=0;",
"function searchLivePool(){",
"  if(_searchLivePool)return _searchLivePool;",
"  const all=[];",
"  [...C].forEach(c=>{iptvFor(c.n).forEach(s=>{if(s&&s.type==='hls')all.push({...s,n:c.n});});});",
"  for(let i=all.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[all[i],all[j]]=[all[j],all[i]];}",
"  _searchLivePool=all;",
"  return all;",
"}",
"const _searchChains={};",
"function nextSearchChain(){",
"  const pool=searchLivePool();",
"  if(!pool.length)return null;",
"  const chain=[];",
"  // Four candidates a slot: enough that one dead stream is invisible, few",
"  // enough that the cursor keeps moving and the next render leads elsewhere.",
"  for(let k=0;k<4&&chain.length<4;k++){",
"    const s=pool[_searchLiveCur++%pool.length];",
"    if(!isBadStream(s))chain.push(s);",
"  }",
"  if(!chain.length)return null;",
"  const id='slc'+(_searchLiveCur+Math.floor(Math.random()*1e6));",
"  _searchChains[id]=chain;",
"  return {id,label:chain[0].n||chain[0].label||'LIVE'};",
"}",
"function liveFeatSlot(){const c=nextSearchChain();if(!c)return '';return `<div class=\"search-live-feat\"><div class=\"search-live-slot\" data-chain=\"${c.id}\" data-nolabel=\"1\"></div><div class=\"search-live-feat-overlay\"></div><div class=\"search-live-feat-info\"><div class=\"search-live-badge2\"><span class=\"strip-live-dot\"></span>LIVE</div><div class=\"search-live-feat-name\" data-lbl=\"${c.id}\">${esc(c.label)}</div></div></div>`;}",
"function liveTileSlot(){const c=nextSearchChain();if(!c)return '';return `<div class=\"search-live-tile\"><div class=\"search-live-slot\" data-chain=\"${c.id}\" data-nolabel=\"1\"></div><div class=\"search-live-tile-lbl\" data-lbl=\"${c.id}\">${esc(c.label)}</div></div>`;}",
"function liveRow(n){return `<div class=\"search-live-row\">${Array.from({length:n==null?2:n},()=>liveTileSlot()).join('')}</div>`;}",
"function hydrateLiveTiles(root){",
"  root.querySelectorAll('.search-live-slot').forEach(el=>{",
"    if(el.dataset.hydrated)return;el.dataset.hydrated='1';",
"    const chain=_searchChains[el.dataset.chain]||[];",
"    connectTile(el,chain,src=>{",
"      // The caption follows what actually connected - the country, then the",
"      // channel - instead of naming a stream three candidates back.",
"      const lbl=root.querySelector('[data-lbl=\"'+el.dataset.chain+'\"]');",
"      if(lbl)lbl.textContent=(src.n||'')+(src.label?(src.n?' \\u00b7 ':'')+src.label:'');",
"    });",
"  });",
"}",
));

// ── renderSearch: every LIVE_CHANNELS reference becomes a pool draw ─────────
rep(L(
"    container.innerHTML=`<div class=\"search-section-lbl\"><span class=\"strip-live-dot\"></span>LIVE NOW</div>",
"    ${liveFeatSlot(LIVE_CHANNELS[0])}",
"    ${liveRow(LIVE_CHANNELS.slice(1,3))}",
"    ${liveRow(LIVE_CHANNELS.slice(3,5))}",
"    ${liveRow(LIVE_CHANNELS.slice(5,7))}`;",
), L(
"    container.innerHTML=`<div class=\"search-section-lbl\"><span class=\"strip-live-dot\"></span>LIVE NOW</div>",
"    ${liveFeatSlot()}",
"    ${liveRow()}",
"    ${liveRow()}",
"    ${liveRow()}`;",
));
rep(L(
"  let html=`<div class=\"search-section-lbl\"><span class=\"strip-live-dot\"></span>LIVE NOW</div>",
"  ${liveFeatSlot(LIVE_CHANNELS[0])}",
"  ${liveRow(LIVE_CHANNELS.slice(1,3))}`;",
), L(
"  let html=`<div class=\"search-section-lbl\"><span class=\"strip-live-dot\"></span>LIVE NOW</div>",
"  ${liveFeatSlot()}",
"  ${liveRow()}`;",
));
rep(L(
"      if((i+1)%4===0){",
"        const off=(3+(Math.floor(i/4)*2))%LIVE_CHANNELS.length;",
"        html+=liveRow([0,1].map(j=>LIVE_CHANNELS[(off+j)%LIVE_CHANNELS.length]));",
"      }",
), L(
"      if((i+1)%4===0){",
"        html+=liveRow();   // two fresh pool draws, not a fixed rotation of nine",
"      }",
));

if (crlf) s = s.replace(/\n/g, '\r\n');
writeFileSync(f, s);
console.log('search live tiles draw from the probed pool, shuffled per session');
