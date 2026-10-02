// THE WALL REMEMBERS WHAT PLAYS IN THIS BROWSER.
//
// Nothing persisted which streams actually work here, so every fill, every
// scroll batch and every return visit re-discovered the pool from zero - the
// opposite of instant. Four changes:
//
//   1. A proven table (localStorage): streamKey -> {ms, via, bad, at}. A manifest
//      that answered is proven (with its time and whether it needed the proxy);
//      an HTTP-refused one is bad for a day. Pruned at 7 days.
//   2. The wall's cascade races manifests like connectTile does (it never did -
//      the race only reached search tiles), with proven-fresh winners skipping
//      the race entirely: zero network before hls.js starts.
//   3. A stream proven to need the proxy starts THROUGH the proxy - no failed
//      direct attempt, no retry round-trip.
//   4. Each placed batch prewarms the NEXT batch's manifests in the background
//      (4 at a time), so by the time scrolling mounts those tiles their winners
//      are already in the table and they connect on the first try.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const L = (...x) => x.join('\n');
const f = fileURLToPath(new URL('../void2-final.html', import.meta.url));
let s = readFileSync(f, 'utf8'); const crlf = s.includes('\r\n'); s = s.replace(/\r\n/g, '\n');
const rep = (a, b) => { const n = s.split(a).length - 1; if (n !== 1) { console.log('ANCHOR x' + n + ': ' + a.slice(0, 90)); process.exit(1); } s = s.split(a).join(b); };

// ─── 1. the proven table, beside the other stream-memory helpers ────────────
rep("function usedStreamKeys(){", L(
"// ─── PROVEN STREAMS: what this browser has actually played ─────────────────",
"// streamKey -> {ms:int, via:0|1 (1 = needed the proxy), bad:0|1, at:epoch}.",
"// Proven-good orders the wall and skips the manifest race; proven-bad (an HTTP",
"// refusal or a non-playlist body) is skipped for a day. CORS refusals are NOT",
"// bad - the proxy carries those, and via:1 records that it had to.",
"const PROVEN_KEY='void_proven_v1';",
"let _proven=null;",
"function provenAll(){",
"  if(_proven)return _proven;",
"  try{_proven=JSON.parse(localStorage.getItem(PROVEN_KEY)||'{}')||{};}catch(e){_proven={};}",
"  const cut=Date.now()-7*864e5;",
"  for(const k in _proven)if(!_proven[k]||_proven[k].at<cut)delete _proven[k];",
"  return _proven;",
"}",
"let _provenT=0;",
"function provenSave(){",
"  clearTimeout(_provenT);",
"  _provenT=setTimeout(()=>{try{localStorage.setItem(PROVEN_KEY,JSON.stringify(_proven||{}));}catch(e){}},800);",
"}",
"function provenOf(src){const k=src&&streamKey(src);return (k&&provenAll()[k])||null;}",
"function provenMark(src,ms,via){const k=src&&streamKey(src);if(!k)return;provenAll()[k]={ms:Math.round(ms||0),via:via?1:0,bad:0,at:Date.now()};provenSave();}",
"function provenBad(src){const k=src&&streamKey(src);if(!k)return;provenAll()[k]={ms:0,via:0,bad:1,at:Date.now()};provenSave();}",
"function provenGood(src,maxAgeMs){const p=provenOf(src);return p&&!p.bad&&Date.now()-p.at<(maxAgeMs||12*36e5)?p:null;}",
"function provenDead(src){const p=provenOf(src);return !!(p&&p.bad&&Date.now()-p.at<864e5);}",
"function usedStreamKeys(){",
));

// ─── 2a. the race learns, skips proven, and respects proven-dead ────────────
rep(L(
"async function raceHlsOrder(sources){",
"  const hls=sources.filter(x=>x&&x.type==='hls');",
"  if(hls.length<2)return sources;",
), L(
"async function raceHlsOrder(sources){",
"  // A fresh proven winner needs no race at all: put it first and go.",
"  const good=sources.find(x=>x&&x.type==='hls'&&provenGood(x));",
"  if(good)return [good,...sources.filter(x=>x!==good)];",
"  const hls=sources.filter(x=>x&&x.type==='hls'&&!provenDead(x));",
"  if(hls.length<2)return sources;",
));
rep(L(
"    fetch(src.url,{signal:ctl.signal}).then(r=>{",
"      clearTimeout(t);",
"      if(!r.ok){markBadStream(src);res(null);return;}",
"      r.text().then(tx=>{",
"        if(tx&&tx.slice(0,7)==='#EXTM3U')res(src);",
"        else{markBadStream(src);res(null);}",
"      }).catch(()=>res(null));",
"    }).catch(()=>{clearTimeout(t);res(null);});",
), L(
"    const t0=performance.now();",
"    fetch(src.url,{signal:ctl.signal}).then(r=>{",
"      clearTimeout(t);",
"      if(!r.ok){markBadStream(src);provenBad(src);res(null);return;}",
"      r.text().then(tx=>{",
"        if(tx&&tx.slice(0,7)==='#EXTM3U'){provenMark(src,performance.now()-t0,0);res(src);}",
"        else{markBadStream(src);provenBad(src);res(null);}",
"      }).catch(()=>res(null));",
"    }).catch(()=>{clearTimeout(t);res(null);});",
));

// ─── 2b. the WALL cascade gets the race too (it never had it) ───────────────
rep(L(
"  for(let i=0;i<chain.length;i++){",
"    if(!cell.isConnected)return {ok:false};",
"    // Preface: sparkle only — never channel posters (play-glyph art).",
"    sparkleTile(cell,i===0?'● CONNECTING':'● RETRYING');",
), L(
"  // Same race the search tiles run: the first manifest to answer in THIS",
"  // browser goes first, so the serial walk below is almost always one attempt.",
"  try{chain=await raceHlsOrder(chain);}catch(e){}",
"  if(!cell.isConnected)return {ok:false};",
"  for(let i=0;i<chain.length;i++){",
"    if(!cell.isConnected)return {ok:false};",
"    // Preface: sparkle only — never channel posters (play-glyph art).",
"    sparkleTile(cell,i===0?'● CONNECTING':'● RETRYING');",
));

// ─── 3. proven-proxy streams start through the proxy; successes are recorded ─
rep(L(
"            let triedProxy=false;",
"            const begin=(url)=>{",
), L(
"            let triedProxy=false;",
"            const viaProxy=u=>VOID_PROXY_BASE+'/hls?u='+encodeURIComponent(u);",
"            const begin=(url)=>{",
));
rep(L(
"              hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(v.play)v.play().catch(()=>{});});",
), L(
"              hls.on(Hls.Events.MANIFEST_PARSED,()=>{provenMark(source,0,triedProxy?1:0);if(v.play)v.play().catch(()=>{});});",
));
rep(L(
"                    begin(VOID_PROXY_BASE+'/hls?u='+encodeURIComponent(source.url));",
), L(
"                    begin(viaProxy(source.url));",
));
rep(L(
"            begin(source.url);",
), L(
"            // Proven to need the proxy: start there. The direct attempt already",
"            // failed once in this browser; repeating it is a full failed fetch",
"            // plus a retry round-trip on every single mount.",
"            {const p=provenGood(source,864e5);",
"             if(p&&p.via&&VOID_PROXY_BASE){triedProxy=true;begin(viaProxy(source.url));}",
"             else begin(source.url);}",
));

// ─── 4a. wallSlots: proven-fast first inside each country, proven-dead out ──
rep("    const news=shuffle(iptvFor(n).filter(usable));", L(
"    // Proven-fast streams lead their country's list - the shuffle still varies",
"    // the rest, but what connects INSTANTLY in this browser goes first, which is",
"    // most of what \"the wall is fast\" means on the second visit.",
"    const news=shuffle(iptvFor(n).filter(s=>usable(s)&&!provenDead(s)))",
"      .sort((a,b)=>{const pa=provenGood(a),pb=provenGood(b);return (pa?pa.ms:9e9)-(pb?pb.ms:9e9);});",
));

// ─── 4b. each placed batch prewarms the next one's manifests ────────────────
rep(L(
"  _wallBusy=false;",
"  const done=document.getElementById('gl-done');",
"  if(_slotIdx>=_slots.length && done) done.style.display='block';",
), L(
"  _wallBusy=false;",
"  // Prewarm the NEXT batch: race its manifests quietly (4 at a time) so the",
"  // proven table already knows the winners when scrolling mounts those tiles.",
"  // Pure fetches - no players, no keys claimed - and best-effort throughout.",
"  try{prewarmSlots(_slotIdx,WALL_BATCH);}catch(e){}",
"  const done=document.getElementById('gl-done');",
"  if(_slotIdx>=_slots.length && done) done.style.display='block';",
));
rep("async function loadWallBatch(want){", L(
"let _prewarmBusy=false;",
"async function prewarmSlots(from,count){",
"  if(_prewarmBusy)return;_prewarmBusy=true;",
"  try{",
"    const todo=_slots.slice(from,from+count).map(s=>s.src)",
"      .filter(x=>x&&x.type==='hls'&&!provenOf(x));",
"    let i=0;",
"    await Promise.all(Array.from({length:Math.min(4,todo.length)},async()=>{",
"      while(i<todo.length){",
"        const src=todo[i++];",
"        await new Promise(res=>{",
"          const ctl=new AbortController();const t=setTimeout(()=>{ctl.abort();res();},3500);",
"          const t0=performance.now();",
"          fetch(src.url,{signal:ctl.signal}).then(r=>{clearTimeout(t);",
"            if(!r.ok){provenBad(src);res();return;}",
"            r.text().then(tx=>{if(tx&&tx.slice(0,7)==='#EXTM3U')provenMark(src,performance.now()-t0,0);else provenBad(src);res();}).catch(()=>res());",
"          }).catch(()=>{clearTimeout(t);res();});",
"        });",
"      }",
"    }));",
"  }finally{_prewarmBusy=false;}",
"}",
"async function loadWallBatch(want){",
));

if (crlf) s = s.replace(/\n/g, '\r\n');
writeFileSync(f, s);
console.log('proven table, wall race, proxy-first for proven-proxy, batch prewarm');
