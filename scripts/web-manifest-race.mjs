// A TILE CONNECTS AT THE SPEED OF ITS FASTEST CANDIDATE, NOT THE SUM OF ITS
// FAILURES. connectTile walked its chain serially with an 8s timeout per hls
// candidate, so one dead server cost eight seconds before the next try - a slot
// with two dead urls ahead of a live one took 16s+ to show a picture, which on
// screen reads as "the streams don't load". Before the serial walk, all hls
// candidates now race a 3.5s manifest fetch in parallel; the first url whose
// playlist actually arrives in THIS browser goes first, and the cascade usually
// connects on it in well under a second of hls.js work.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const L = (...x) => x.join('\n');
const f = fileURLToPath(new URL('../void2-final.html', import.meta.url));
let s = readFileSync(f, 'utf8'); const crlf = s.includes('\r\n'); s = s.replace(/\r\n/g, '\n');
const rep = (a, b) => { const n = s.split(a).length - 1; if (n !== 1) { console.log('ANCHOR x' + n + ': ' + a.slice(0, 90)); process.exit(1); } s = s.split(a).join(b); };

rep(L(
"function connectTile(cell,sources,onConnected){",
"  if(getComputedStyle(cell).position==='static')cell.style.position='relative';",
"  let i=0,cancelled=false;",
"  cell.__cancel=()=>{cancelled=true;};",
"  (async function next(){",
), L(
"// Fetch each hls candidate's manifest in parallel (3.5s cap) and put the first",
"// one that answers at the front of the chain. The serial walk below then almost",
"// always connects on its first try instead of burning CONNECT_TIMEOUT (8s) per",
"// dead server. An HTTP error or a non-playlist body marks the stream bad for",
"// the session; a thrown fetch (CORS, DNS) does NOT - the /hls proxy retry",
"// inside attemptSource may still carry that url, so it only loses its place in",
"// line. No manifest answering leaves the chain as it was.",
"async function raceHlsOrder(sources){",
"  const hls=sources.filter(x=>x&&x.type==='hls');",
"  if(hls.length<2)return sources;",
"  const probe=src=>new Promise(res=>{",
"    const ctl=new AbortController();",
"    const t=setTimeout(()=>{ctl.abort();res(null);},3500);",
"    fetch(src.url,{signal:ctl.signal}).then(r=>{",
"      clearTimeout(t);",
"      if(!r.ok){markBadStream(src);res(null);return;}",
"      r.text().then(tx=>{",
"        if(tx&&tx.slice(0,7)==='#EXTM3U')res(src);",
"        else{markBadStream(src);res(null);}",
"      }).catch(()=>res(null));",
"    }).catch(()=>{clearTimeout(t);res(null);});",
"  });",
"  const winner=await new Promise(res=>{",
"    let left=hls.length;",
"    hls.forEach(x=>probe(x).then(v=>{if(v)res(v);else if(--left===0)res(null);}));",
"  });",
"  if(!winner)return sources;",
"  return [winner,...sources.filter(x=>x!==winner)];",
"}",
"function connectTile(cell,sources,onConnected){",
"  if(getComputedStyle(cell).position==='static')cell.style.position='relative';",
"  let i=0,cancelled=false;",
"  cell.__cancel=()=>{cancelled=true;};",
"  (async function(){",
"    try{sources=await raceHlsOrder(sources);}catch(e){}",
"    if(cancelled)return;",
"    (async function next(){",
));

// Close the extra wrapper: the original IIFE ended `  })();\n  return cell;`.
rep(L(
"    if(ok){",
"      const fb=cell.querySelector('.sparkle-fallback');if(fb)fb.remove();",
"      if(!cell.dataset.nolabel)cell.insertAdjacentHTML('beforeend',tileLabel(src.label||'LIVE',src));",
"      if(onConnected)onConnected(src);",
"    }else next();",
"  })();",
"  return cell;",
"}",
), L(
"    if(ok){",
"      const fb=cell.querySelector('.sparkle-fallback');if(fb)fb.remove();",
"      if(!cell.dataset.nolabel)cell.insertAdjacentHTML('beforeend',tileLabel(src.label||'LIVE',src));",
"      if(onConnected)onConnected(src);",
"    }else next();",
"    })();",
"  })();",
"  return cell;",
"}",
));

if (crlf) s = s.replace(/\n/g, '\r\n');
writeFileSync(f, s);
console.log('hls candidates race their manifests; the first to answer goes first');
