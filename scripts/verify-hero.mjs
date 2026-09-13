// Nation hero (7e) live-stream audit. Driven from scripts/verify-ui.mjs:
//   node scripts/verify-ui.mjs --only=hero --all [--pages=4] [--wait=25] [--out=dir]
//   node scripts/verify-ui.mjs --only=hero --country=Kenya,Peru
// Opens every nation in C, waits for #nation-hero.playing, and records the source
// that played, time to play, sources walked and why each failed, plus the whole
// cascade — then checks that no stream / channel is shared between nations and no
// foreign global broadcaster is standing in as a nation's own stream.
// Writes <out>/hero-audit.json and prints a table.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let sleep, args, WAIT_S, COUNTRY;
// ─── HERO AUDIT ─────────────────────────────────────────────────────────
// Instruments the PAGE (never the source file): wraps nationStreamSources to capture
// each nation's cascade and attemptSource to time every attempt made into the hero
// stage (#cpane-live). Both are classic-script globals, so the reassignment is what
// loadCountryLiveGrid calls.
const HERO_INSTRUMENT = `(()=>{
  if(window.__heroInst)return 'already';
  window.__heroInst=true;window.__hero={cascade:null,attempts:[]};
  const _ns=nationStreamSources;
  nationStreamSources=async function(c){const r=await _ns(c);
    window.__hero.cascadeAt=Math.round(performance.now()-(window.__hero.t0||0));window.__hero.cascade=r.map(s=>({type:s.type,label:s.label||'',key:streamKey(s),id:s.id||'',url:s.url||'',kind:s.kind||''}));return r;};
  const _yl=ytLog;
  ytLog=function(src,ok,reason){const a=window.__hero.attempts.find(x=>x.key===streamKey(src)&&x.ok===undefined);if(a)a.reason=reason;return _yl(src,ok,reason);};
  const _as=attemptSource;
  attemptSource=function(cell,src){
    let pre='';
    if(src&&src.type==='youtube'&&liveVidFor(src)===undefined)pre='yt-channel-not-live';
    else if(src&&isBadStream(src))pre='bad-stream';
    const p=_as(cell,src);
    if(cell&&cell.id==='cpane-live'){
      const t=performance.now();
      const e={type:src.type,label:src.label||'',key:streamKey(src),at:Math.round(t-(window.__hero.t0||0))};
      if(pre)e.reason=pre;
      window.__hero.attempts.push(e);
      p.then(ok=>{e.ok=ok;e.ms=Math.round(performance.now()-t);
        if(!ok&&!e.reason)e.reason=e.ms>=((CONNECT_TIMEOUT[src.type]||8000)-50)?'timeout':'error';});
    }
    return p;
  };
  return 'ok';
})()`;

async function heroBootPage(p, url) {
  await p.cdp.send('Page.navigate', { url });
  for (let i = 0; i < 80; i++) {
    if (await p.ev(`document.readyState==='complete' && typeof openCountry==='function' && typeof nationStreamSources==='function'`) === true) break;
    await sleep(500);
  }
  await sleep(2500);
  await p.ev(`(()=>{try{if(typeof signInAnon==='function')signInAnon()}catch(e){}})()`);
  await sleep(2000);
  return p.ev(HERO_INSTRUMENT);
}

async function heroOne(p, name) {
  await p.ev(`(()=>{try{if(document.getElementById('c-overlay')?.classList.contains('open'))closeOverlay();}catch(e){}
    window.__hero={cascade:null,attempts:[],t0:performance.now()};})()`);
  await sleep(600);
  const opened = await p.ev(`(()=>{try{openCountry(${JSON.stringify(name)});return true}catch(e){return String(e&&e.stack||e)}})()`);
  const t0 = Date.now(); let playedAt = null;
  while (Date.now() - t0 < WAIT_S * 1000) {
    await sleep(400);
    const st = await p.ev(`(()=>{const h=document.getElementById('nation-hero');return h?(h.classList.contains('playing')?'playing':(h.hidden?'hidden':'wait')):'missing'})()`);
    if (st === 'playing') { playedAt = Date.now() - t0; break; }
  }
  await sleep(300);
  const h = await p.ev(`(()=>({hero:window.__hero,caption:(document.getElementById('nation-hero-caption')?.textContent||''),
    badge:(document.getElementById('nation-hero-badge')?.textContent||''),kind:(document.getElementById('nation-hero-viewers')?.textContent||''),
    hidden:!!document.getElementById('nation-hero')?.hidden}))()`);
  const attempts = (h.hero && h.hero.attempts) || [];
  const played = playedAt !== null ? (attempts.filter(a => a.ok === true).pop() || attempts[attempts.length - 1]) : null;
  const r = {
    country: name, openCountry: opened, playing: playedAt !== null, msToPlay: playedAt,
    played: played ? { type: played.type, label: played.label, key: played.key } : null,
    caption: h.caption, badge: h.badge, kind: h.kind, heroHidden: h.hidden,
    walked: attempts.length, cascadeAt: h.hero && h.hero.cascadeAt, cascadeLen: h.hero && h.hero.cascade ? h.hero.cascade.length : null,
    failures: attempts.filter(a => a !== played && a.ok !== true).map(a => ({ type: a.type, label: a.label, key: a.key, reason: a.reason || (a.ok === undefined ? 'pending' : ''), at: a.at, ms: a.ms })),
    cascade: (h.hero && h.hero.cascade) || [],
  };
  await p.ev(`(()=>{try{closeOverlay()}catch(e){}})()`);
  return r;
}

// Broadcasters that serve many nations. A nation may only carry one of these as
// its stream when the broadcaster is FROM that nation.
const GLOBAL_BROADCASTERS = [
  [/al ?jazeera/i, 'Qatar'], [/\bdw\b|deutsche welle/i, 'Germany'], [/france ?24/i, 'France'],
  [/\bbbc\b/i, 'United Kingdom'], [/bloomberg/i, 'United States'], [/aaj tak/i, 'India'],
  [/\bcnn\b/i, 'United States'], [/euronews/i, 'France'], [/\bsky news\b(?! arabia)/i, 'United Kingdom'],
  [/nhk world/i, 'Japan'], [/\bcgtn\b/i, 'China'], [/trt world/i, 'Turkey'], [/\bwion\b/i, 'India'],
  [/africanews/i, 'Congo'], [/pluto tv/i, 'United States'], [/\baxn\b|disney channel|national geographic|viasat|cinemaworld/i, 'multinational'],
];
function normLabel(l) {
  return String(l || '').toLowerCase().replace(/\b(hd|sd|fhd|uhd|4k|live|tv|channel|24\/7)\b/g, ' ')
    .replace(/[^a-z0-9À-￿]+/g, ' ').trim();
}
function channelKey(s) {
  if (s.type === 'hls' || s.type === 'mjpeg' || s.type === 'iframe') {
    try { const u = new URL(s.url); return s.type + ':' + u.host + u.pathname.replace(/\/[^/]*$/, '/'); } catch { return s.key; }
  }
  if (s.type === 'youtube' && s.id && s.id.length !== 11) return 'ytchan:' + s.id;
  return s.key;
}
function heroUniqueness(results) {
  const byKey = {}, byLabel = {}, byChan = {}, heroDup = {};
  const add = (m, k, n) => { if (!k) return; (m[k] = m[k] || new Set()).add(n); };
  for (const r of results) for (const s of r.cascade || []) {
    add(byKey, s.key, r.country); add(byLabel, normLabel(s.label), r.country); add(byChan, channelKey(s), r.country);
  }
  for (const r of results) if (r.played) add(heroDup, normLabel(r.played.label) || r.played.key, r.country);
  const multi = m => Object.entries(m).filter(([k, v]) => k && v.size > 1).map(([k, v]) => ({ k, nations: [...v] }));
  const globals = [];
  for (const r of results) for (const s of r.cascade || []) for (const [re, home] of GLOBAL_BROADCASTERS) {
    if (re.test(s.label) && home !== r.country) globals.push({ nation: r.country, label: s.label, key: s.key, home, hero: r.played?.key === s.key });
  }
  return { sharedKeys: multi(byKey), sharedLabels: multi(byLabel), sharedChannels: multi(byChan), heroShared: multi(heroDup), globalBroadcasters: globals };
}

async function runAudit({ ev, url, attach }) {
  const all = await ev(`C.map(c=>c.n)`);
  let names = args.all ? all : String(args.country || COUNTRY).split(',').map(s => s.trim()).filter(Boolean);
  // --shard=i/n: run every n-th nation. Separate Chrome processes are the reliable way to
  // parallelise — background tabs in one browser get their timers and media throttled.
  if (args.shard) { const [i, n] = String(args.shard).split('/').map(Number); names = names.filter((_, k) => k % n === i); }
  const PAGES = Math.max(1, Math.min(Number(args.pages || 1), names.length));
  const pages = [{ cdp: null, ev }];
  await ev(HERO_INSTRUMENT);
  for (let i = 1; i < PAGES; i++) { const p = await attach(); await heroBootPage(p, url); pages.push(p); }
  const queue = names.slice(); const results = [];
  const t0 = Date.now();
  await Promise.all(pages.map(async (p, pi) => {
    while (queue.length) {
      const n = queue.shift();
      let r;
      try { r = await heroOne(p, n); } catch (e) { r = { country: n, error: String(e && e.stack || e), cascade: [] }; }
      results.push(r);
      process.stderr.write(`[hero ${results.length}/${names.length} tab${pi}] ${n}: ${r.playing ? 'PLAYING ' + r.msToPlay + 'ms ' + (r.played?.type || '') + ' ' + (r.played?.label || '') : 'NO PLAY'} (walked ${r.walked}/${r.cascadeLen})\n`);
    }
  }));
  for (const p of pages.slice(1)) p.cdp.close();
  results.sort((a, b) => names.indexOf(a.country) - names.indexOf(b.country));
  const times = results.filter(r => r.playing).map(r => r.msToPlay).sort((a, b) => a - b);
  return {
    at: new Date().toISOString(), waitS: WAIT_S, pages: PAGES, elapsedS: Math.round((Date.now() - t0) / 1000),
    nations: names.length, playing: times.length,
    medianMsToPlay: times.length ? times[Math.floor((times.length - 1) / 2)] : null,
    failing: results.filter(r => !r.playing).map(r => r.country),
    uniqueness: heroUniqueness(results), results,
  };
}

function heroReport(h) {
  const L = [];
  L.push(`HERO AUDIT  ${h.playing}/${h.nations} playing within ${h.waitS}s  median ${h.medianMsToPlay}ms  (${h.elapsedS}s, ${h.pages} tabs)`);
  for (const r of h.results) L.push(`  ${r.playing ? 'OK  ' : 'FAIL'} ${r.country.padEnd(24)} ${r.playing ? String(r.msToPlay).padStart(6) + 'ms' : '        '} walked ${r.walked}/${r.cascadeLen}  ${r.played ? r.played.type + ' ' + r.played.label : (r.failures || []).slice(0, 5).map(f => f.type + ':' + f.reason).join(', ')}`);
  const u = h.uniqueness;
  L.push(`shared stream keys: ${u.sharedKeys.length}  shared labels: ${u.sharedLabels.length}  shared channels: ${u.sharedChannels.length}  hero shared: ${u.heroShared.length}  foreign global broadcasters: ${u.globalBroadcasters.length}`);
  for (const x of [...u.sharedKeys, ...u.sharedLabels, ...u.sharedChannels, ...u.heroShared]) L.push(`   dup ${x.k} -> ${x.nations.join(', ')}`);
  for (const g of u.globalBroadcasters) L.push(`   global ${g.nation}: ${g.label} (home ${g.home})${g.hero ? ' [HERO]' : ''}`);
  return L.join('\n');
}

// Merge shard outputs: node scripts/verify-hero.mjs --merge <dir> <dir> ... [--out=file]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const outArg = (process.argv.find(a => a.startsWith('--out=')) || '').slice(6);
  if (process.argv.includes('--merge') && dirs.length) {
    const parts = dirs.map(d => JSON.parse(fs.readFileSync(path.join(d, 'hero-audit.json'), 'utf8')));
    const results = parts.flatMap(p => p.results);
    const order = parts[0].order || null;
    const times = results.filter(r => r.playing).map(r => r.msToPlay).sort((a, b) => a - b);
    const merged = { at: new Date().toISOString(), waitS: parts[0].waitS, pages: parts.length, elapsedS: Math.max(...parts.map(p => p.elapsedS)),
      nations: results.length, playing: times.length, medianMsToPlay: times.length ? times[Math.floor((times.length - 1) / 2)] : null,
      failing: results.filter(r => !r.playing).map(r => r.country), uniqueness: heroUniqueness(results),
      results: results.sort((a, b) => a.country.localeCompare(b.country)) };
    if (outArg) fs.writeFileSync(outArg, JSON.stringify(merged, null, 1));
    console.log(heroReport(merged));
  }
}

export async function heroAudit(ctx) {
  ({ sleep, args, WAIT_S } = ctx); COUNTRY = ctx.COUNTRY || 'Morocco';
  const { CDP, dbgPort, WIDTH = 412 } = ctx;
  const attach = async () => {
    // A new WINDOW, not a tab: a background tab is document.hidden, and hidden pages
    // neither autoplay YouTube nor get the keep-alive nudges — every tab but one fails.
    const ver = await (await fetch(`http://127.0.0.1:${dbgPort}/json/version`)).json();
    const b = await CDP.connect(ver.webSocketDebuggerUrl);
    const { targetId } = await b.send('Target.createTarget', { url: 'about:blank', newWindow: true });
    b.close();
    let t;
    for (let i = 0; i < 20 && !t; i++) { t = (await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json()).find(x => x.id === targetId); if (!t) await sleep(200); }
    const c = await CDP.connect(t.webSocketDebuggerUrl);
    await c.send('Runtime.enable'); await c.send('Page.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 915, deviceScaleFactor: 1, mobile: true });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const e = async (expr, awaitPromise = false) => {
      const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
      if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
      return r.result.value;
    };
    return { cdp: c, ev: e };
  };
  const hero = await runAudit({ ev: ctx.ev, url: ctx.url, attach });
  const f = path.join(ctx.OUT, 'hero-audit.json');
  fs.writeFileSync(f, JSON.stringify(hero, null, 1));
  console.log(heroReport(hero));
  console.log('full audit:', f);
  return hero;
}
