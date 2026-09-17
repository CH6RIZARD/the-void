#!/usr/bin/env node
// Zero-dependency headless UI check for void2-final.html via Chrome DevTools Protocol.
// Usage: node scripts/verify-ui.mjs [--only=nation|wall|ref] [--country=Morocco]
//        [--compare=Japan|none] [--wait=25] [--chrome=path] [--out=dir]
//        [--countries=Nepal,Japan,...] [--theme=void|dark|light] [--threads=3]
//        [--width=412] [--scrolls=2] [--ref] (also renders nation-7e-reference.html at 390px)
//        --only=hero --all [--pages=4]  nation hero stream audit, see scripts/verify-hero.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const ONLY = args.only || 'all';
const COUNTRY = args.country || 'Morocco';
const COMPARE = args.compare === 'none' ? null : (args.compare || (args.country ? null : 'Japan'));
const WAIT_S = Number(args.wait || 25);
const COUNTRIES = args.countries ? String(args.countries).split(',').map(x => x.trim()).filter(Boolean) : null;
const THEME = args.theme || null;
const THREADS = Number(args.threads || 0);
const WIDTH = Number(args.width || 412);
const DPR = Number(args.dpr || 1);
const SCROLLS = args.scrolls === undefined ? 2 : Number(args.scrolls);
const CHROME = args.chrome || process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve(args.out || path.join(os.tmpdir(), 'void-verify-ui'));
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.m3u8': 'application/vnd.apple.mpegurl',
};

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
}

function serve(port) {
  const srv = http.createServer((req, res) => {
    try {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let f = path.join(ROOT, u);
      if (!f.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!fs.existsSync(f)) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(res);
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r(srv)));
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (msg.id && this.pending.has(msg.id)) { const { res, rej } = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
      else if (msg.method) this.handlers.forEach(h => h(msg));
    });
  }
  static connect(url) { return new Promise((res, rej) => { const ws = new WebSocket(url); ws.addEventListener('open', () => res(new CDP(ws))); ws.addEventListener('error', rej); }); }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  on(fn) { this.handlers.push(fn); }
  close() { try { this.ws.close(); } catch {} }
}

const summary = { page: null, console: { errors: [], warnings: [], logCount: 0 }, exceptions: [], nation: null, wall: null, screenshots: [] };

async function main() {
  const port = await freePort(), dbgPort = await freePort();
  const srv = await serve(port);
  // --profile=dir reuses one Chrome profile across runs (cleared at start) instead of a new temp dir per run.
  const profile = args.profile ? path.resolve(String(args.profile)) : fs.mkdtempSync(path.join(os.tmpdir(), 'void-chrome-'));
  if (args.profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} fs.mkdirSync(profile, { recursive: true }); }
  const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${profile}`,
    '--autoplay-policy=no-user-gesture-required', `--window-size=${WIDTH},915`, `--user-agent=${UA}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio', '--disk-cache-size=1', '--media-cache-size=1',
    // hero audit runs several tabs in ONE browser; background tabs must not be throttled
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  // chrome.kill() only ends the parent on Windows; its child processes kept the profile
  // locked, so the rmSync below failed silently and leaked 50-250 MB per run.
  const cleanup = async () => { cdp?.close(); try { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); else chrome.kill(); } catch {} srv.close(); await sleep(1500); for (let i = 0; i < 5; i++) { try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(1000); } } };
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try { const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json(); target = list.find(t => t.type === 'page'); } catch {}
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('Chrome page target not found');
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    cdp.on(msg => {
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
        const t = msg.params.type;
        if (t === 'error' || t === 'assert') summary.console.errors.push(text.slice(0, 500));
        else if (t === 'warning') summary.console.warnings.push(text.slice(0, 300));
        else summary.console.logCount++;
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        summary.exceptions.push({
          text: d.exception?.description || d.text, url: d.url, line: d.lineNumber + 1, col: d.columnNumber + 1,
          stack: (d.stackTrace?.callFrames || []).map(f => `${f.functionName || '<anon>'} @ ${path.basename(f.url || '')}:${f.lineNumber + 1}:${f.columnNumber + 1}`),
        });
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        summary.console.errors.push(`[log:${msg.params.entry.source}] ${msg.params.entry.text} ${msg.params.entry.url || ''}`.slice(0, 400));
      }
    });
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 915, deviceScaleFactor: DPR, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    if (args.ref || ONLY === 'ref') {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1100, deviceScaleFactor: DPR, mobile: true });
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/design_handoff_void_patch3/nation-7e-reference.html` });
      await sleep(3000);
      await cdp.send('Runtime.evaluate', { expression: `document.body.style.padding='0';document.body.style.display='block'` });
      await sleep(300);
      const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
      const f = path.join(OUT, 'reference-7e-390.jpg'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); summary.screenshots.push(f);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 915, deviceScaleFactor: DPR, mobile: true });
      if (ONLY === 'ref') { await cleanup(); console.log(JSON.stringify(summary, null, 2)); process.exit(0); }
    }
    const url = `http://127.0.0.1:${port}/void2-final.html`;
    summary.page = url;
    await cdp.send('Page.navigate', { url });   // --theme is applied with setTheme() after boot

    const ev = async (expr, awaitPromise = false) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
      if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
      return r.result.value;
    };
    // --shots=top,thread-1 keeps only captures whose name ends with one of those; JPEG unless --png.
    const SHOTS = args.shots ? String(args.shots).split(',').filter(Boolean) : null;
    const shot = async name => {
      if (SHOTS && !SHOTS.some(k => name.endsWith(k))) return null;
      const png = !!args.png;
      const r = await cdp.send('Page.captureScreenshot', png ? { format: 'png' } : { format: 'jpeg', quality: 55 });
      const f = path.join(OUT, `${name}.${png ? 'png' : 'jpg'}`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); summary.screenshots.push(f); return f;
    };

    // Boot: wait for document + key globals.
    let booted = false;
    for (let i = 0; i < 60; i++) {
      booted = await ev(`document.readyState==='complete' && typeof openCountry==='function'`);
      if (booted === true) break; await sleep(500);
    }
    await sleep(3000);
    // The identity gate covers the app on a fresh profile; take the anonymous path
    // like a first-time user would, so screenshots show the real UI.
    const gate = await ev(`(()=>{try{if(typeof signInAnon==='function'){signInAnon();return 'signInAnon'}return 'none'}catch(e){return 'error: '+(e&&e.stack||e)}})()`);
    await sleep(3000);
    if (THEME) summary.themeApplied = await ev(`(()=>{try{setTheme(${JSON.stringify(THEME)});return document.documentElement.getAttribute('data-theme')}catch(e){return 'ERR '+e}})()`);
    summary.boot = { ok: booted === true, identityGate: gate };

    if (ONLY === 'all' || ONLY === 'nation') {
      summary.nation = {};
      for (const name of (COUNTRIES || [COUNTRY, COMPARE].filter(Boolean))) {
        const ex0 = summary.exceptions.length;
        try { summary.nation[name] = await nationCheck(ev, shot, name); }
        catch (e) { summary.nation[name] = { error: String(e && e.stack || e) }; }
        summary.nation[name].exceptionsDuring = summary.exceptions.slice(ex0).map(x => x.text && String(x.text).split('\n')[0]);
      }
    }
    if (THREADS) {
      // GDELT is CORS-blocked from a local origin, so the article thread is checked with
      // a post built by the app's own gdeltToPost from a representative artlist row.
      summary.articleThread = await ev(`(async()=>{try{
        const p=gdeltToPost({title:'Test headline for the article thread',url:'https://www.example.com/world/story-1',socialimage:'',domain:'example.com',sourcecountry:'Kenya',seendate:'20260913T120000Z'});
        allPosts.push(p);openThread(p.id);await new Promise(r=>setTimeout(r,400));
        const a=document.querySelector('#thread-original .t-article');
        const out={open:document.getElementById('thread-overlay').classList.contains('open'),title:document.getElementById('thread-body-text')?.textContent,href:a&&a.getAttribute('href'),host:a&&a.querySelector('.t-art-host')?.textContent,source:document.querySelector('#thread-original .thread-source-link')?.textContent,count:document.getElementById('thread-count').textContent};
        closeThread();return out;}catch(e){return 'ERR '+(e&&e.stack||e)}})()`, true);
    }
    if (ONLY === 'settings') {   // account deletion row + confirm sheet; --delete-local also runs the no-session delete
      summary.settings = await ev(`(async()=>{try{
        const w=ms=>new Promise(r=>setTimeout(r,ms));
        openSettings();await w(300);
        const row=document.getElementById('s-delete-row');
        const out={settingsOpen:document.getElementById('settings-modal').classList.contains('open'),row:!!row,
          rowLabel:row&&row.querySelector('.settings-row-label')?.textContent,rowButton:row&&row.querySelector('button')?.textContent,
          inIdentitySection:!!(row&&row.closest('.settings-section')?.querySelector('.settings-section-label')?.textContent)};
        row.scrollIntoView();await w(200);
        row.querySelector('button').click();await w(400);
        const wrap=document.getElementById('da-wrap'),go=document.getElementById('da-go'),inp=document.getElementById('da-input');
        const r=wrap&&wrap.querySelector('.da-sheet').getBoundingClientRect();
        out.sheet={open:!!(wrap&&wrap.classList.contains('on')),visible:!!(r&&r.height>100&&r.top<innerHeight),
          title:document.getElementById('da-title')?.textContent,items:wrap?wrap.querySelectorAll('.da-list li').length:0,
          goDisabledInitially:go.disabled,hasSession:!!(VoidAuth.session&&VoidAuth.session.access_token)};
        inp.value='delet';inp.dispatchEvent(new Event('input'));out.sheet.disabledOnPartial=go.disabled;
        inp.value='delete';inp.dispatchEvent(new Event('input'));out.sheet.enabledOnDelete=!go.disabled;
        return out;}catch(e){return 'ERR '+(e&&e.stack||e)}})()`, true);
      await shot('settings-delete-confirm');
      // Local path only: the session is dropped first, so this never deletes a server account.
      if (args['delete-local'] && summary.settings && summary.settings.sheet) {
        await ev(`VoidAuth.save(null);localStorage.setItem('void_aff','{"x":1}');localStorage.setItem('void_theme','void');runDeleteAccount()`);
        await sleep(600);
        summary.settings.done = await ev(`({eyebrow:document.querySelector('#da-wrap .da-eyebrow')?.textContent,text:document.getElementById('da-done')?.textContent,
          user:localStorage.getItem('void_user'),aff:localStorage.getItem('void_aff'),signedIn:localStorage.getItem('void_signed_in'),theme:localStorage.getItem('void_theme')})`);
        await shot('settings-delete-done');
        await ev(`location.reload()`); await sleep(5000);
        summary.settings.afterReload = await ev(`({gateOn:document.getElementById('signin').classList.contains('on'),user:localStorage.getItem('void_user')})`);
        await shot('settings-delete-gate');
      }
    }
    if (ONLY === 'moderation') {   // UGC safety (VMod): report, block, terms gate, graphic filter, settings pages
      summary.moderation = await ev(`(async()=>{try{
        const w=ms=>new Promise(r=>setTimeout(r,ms)),out={};
        VoidAPI._sbReady=()=>false;                       // local fallback only: never write to the live project
        switchTab('void');closeThread&&document.getElementById('thread-overlay').classList.contains('open')&&closeThread();
        const mk=(id,handle,author,body,extra)=>Object.assign({id,style:'take',source:'bluesky',_social:true,_author:author,_handle:handle,body,tags:['geopolitics'],time:Date.now(),score:5,replies:0,reposts:0,country:'',provenance:{sourceHost:'bsky.app'}},extra||{});
        const P=[mk('vt_rep','@reporter.bsky.social','Rep','Post that will be reported for spam'),
          mk('vt_a1','@troll.bsky.social','Troll','First post by the abusive author'),
          mk('vt_a2','@troll.bsky.social','Troll','Second post by the abusive author'),
          mk('vt_ok','@fine.bsky.social','Fine','A post that must stay'),
          mk('vt_gfx','@war.bsky.social','War','Graphic image post',{style:'image',_img:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',_graphic:true,tags:['graphic']})];
        allPosts.unshift(...P);
        document.getElementById('void-feed').innerHTML='';_rendered.clear();_evicted.clear();renderFeed();await w(300);
        const inFeed=id=>!!document.querySelector('#void-feed #post-'+id);
        out.rendered=P.map(p=>p.id).filter(inFeed);
        out.moreButtons=document.querySelectorAll('#void-feed .vmod-more').length;
        // 1. menu + report
        document.querySelector('#post-vt_rep .vmod-more').click();await w(300);
        out.menuOpen=document.getElementById('vmod-ov').classList.contains('open');
        out.menuRows=[...document.querySelectorAll('#vmod-body .vmod-row-l')].map(x=>x.textContent);
        window.__shot='menu';await w(50);
        return out;
      }catch(e){return 'ERR '+(e&&e.stack||e)}})()`, true);
      await shot('mod-1-menu');
      const step2 = await ev(`(async()=>{try{
        const w=ms=>new Promise(r=>setTimeout(r,ms)),out={};
        [...document.querySelectorAll('#vmod-body .vmod-row')][0].click();await w(250);
        out.reasons=document.querySelectorAll('#vmod-reasons .vmod-row').length;
        out.sendDisabledBeforePick=document.getElementById('vmod-send').disabled;
        document.querySelector('#vmod-reasons .vmod-row[data-r="spam"]').click();
        document.getElementById('vmod-note').value='headless test';
        return out;
      }catch(e){return 'ERR '+(e&&e.stack||e)}})()`, true);
      await shot('mod-2-report');
      const step3 = await ev(`(async()=>{try{
        const w=ms=>new Promise(r=>setTimeout(r,ms)),out={};
        const inFeed=id=>!!document.querySelector('#void-feed #post-'+id);
        document.getElementById('vmod-send').click();await w(400);
        out.reportToast=document.getElementById('void-toast')?.textContent;
        out.reportedGone=!inFeed('vt_rep');
        out.reportQueued=JSON.parse(localStorage.getItem('void_reports_pending')||'[]').length;
        // 2. block the author of vt_a1: both of their posts leave the feed, others stay
        document.querySelector('#post-vt_a1 .vmod-more').click();await w(250);
        const blk=[...document.querySelectorAll('#vmod-body .vmod-row')].find(b=>/Hide @|Block @/.test(b.textContent));
        out.blockRowLabel=blk&&blk.querySelector('.vmod-row-l').textContent;
        blk.click();await w(400);
        out.blockToast=document.getElementById('void-toast')?.textContent;
        out.a1Gone=!inFeed('vt_a1');out.a2Gone=!inFeed('vt_a2');out.okStays=inFeed('vt_ok');
        // re-render from scratch: blocked author must not come back
        document.getElementById('void-feed').innerHTML='';_rendered.clear();_evicted.clear();renderFeed();await w(300);
        out.afterRerender={a1:inFeed('vt_a1'),a2:inFeed('vt_a2'),rep:inFeed('vt_rep'),ok:inFeed('vt_ok')};
        out.threadBlocked=(()=>{openThread('vt_a2');return document.getElementById('thread-overlay').classList.contains('open');})();
        // Void-user block by uid (local fallback) + DM guard
        const vu={id:'00000000-0000-4000-8000-00000000abcd',style:'take',source:'void',_author:'Abuser',_handle:'@abuser',_authorId:'00000000-0000-4000-8000-00000000abcd',body:'void user post',tags:['void'],time:Date.now(),score:0,replies:0};
        out.voidAuthorKey=VMod.authorOf(vu).key;allPosts.push(vu);VMod.menu(vu.id);await w(200);out.voidMenuRows=[...document.querySelectorAll('#vmod-body .vmod-row-l')].map(x=>x.textContent);VMod.close();
        // 3. graphic filter
        out.gfxBodyClass=document.body.classList.contains('vmod-gfx');
        const g=document.querySelector('#post-vt_gfx .post-media');
        out.gfxBlurred=!!(g&&g.classList.contains('vmod-gm'))&&getComputedStyle(g.querySelector('img')).filter.includes('blur');
        g&&g.click();await w(100);
        out.gfxRevealedOnTap=!!(g&&g.classList.contains('vmod-rev'));
        out.photoNotOpenedByRevealTap=!document.getElementById('photo-overlay')?.classList.contains('open');
        // 4. thread OP + ⋯
        openThread('vt_ok');await w(500);
        out.threadMore=!!document.querySelector('#thread-original .vmod-more');
        closeThread();await w(400);
        return out;
      }catch(e){return 'ERR '+(e&&e.stack||e)}})()`, true);
      const step4 = await ev(`(async()=>{try{
        const w=ms=>new Promise(r=>setTimeout(r,ms)),out={};
        // 5. terms gate: posting blocked until accepted
        localStorage.removeItem('void_terms_accepted');
        openComposer();await w(300);
        const body='terms gate test '+Date.now();
        document.getElementById('composer-text').value=body;
        const before=allPosts.length;
        submitComposerPost();await w(400);
        out.termsSheetShown=document.getElementById('vmod-ov').classList.contains('open')&&!!document.getElementById('vmod-agree');
        out.postBlockedBeforeAccept=allPosts.length===before&&!allPosts.some(p=>p.body===body);
        return out;
      }catch(e){return 'ERR '+(e&&e.stack||e)}})()`, true);
      await shot('mod-3-terms');
      const step5 = await ev(`(async()=>{try{
        const w=ms=>new Promise(r=>setTimeout(r,ms)),out={};
        const body=document.getElementById('composer-text').value;
        document.getElementById('vmod-agree').click();await w(700);
        out.termsStored=!!localStorage.getItem('void_terms_accepted');
        out.postedAfterAccept=allPosts.some(p=>p.body===body&&p._user);
        // reply path is gated too once cleared
        localStorage.removeItem('void_terms_accepted');
        openThread('vt_ok');await w(400);
        document.getElementById('thread-input').value='gated reply';
        submitComment();await w(300);
        out.replyGateShown=!!document.getElementById('vmod-agree');
        VMod.close();closeThread();await w(400);
        localStorage.setItem('void_terms_accepted',JSON.stringify(new Date().toISOString()));
        // 6. settings
        openSettings();await w(300);
        out.settings={gfxToggleOn:document.getElementById('s-gfx')?.classList.contains('on'),blockedRow:!!document.getElementById('s-blocked'),contactRow:!!document.getElementById('s-contact')};
        VMod.contactSheet();await w(200);
        out.contactEmail=document.querySelector('#vmod-body .vmod-mail')?.textContent;
        VMod.blockedSheet();await w(250);
        out.blockedList=[...document.querySelectorAll('#vmod-blocked .vmod-item .vmod-row-l')].map(x=>x.textContent);
        return out;
      }catch(e){return 'ERR '+(e&&e.stack||e)}})()`, true);
      await shot('mod-4-blocked');
      await ev(`VMod.close();closeSettings();`);
      Object.assign(summary.moderation, { step2, step3, step4, step5 });
    }
    if (ONLY === 'all' || ONLY === 'wall') summary.wall = await wallCheck(ev);
    if (ONLY === 'dms') {    // media uploads + direct messages: --only=dms (scripts/verify-dms.mjs)
      const { dmsAudit } = await import('./verify-dms.mjs');
      summary.dms = await dmsAudit({ ev, sleep, summary, shot });
    }
    if (ONLY === 'hero') {   // nation hero stream audit: --only=hero --all [--pages=4] (scripts/verify-hero.mjs)
      const { heroAudit } = await import('./verify-hero.mjs');
      await heroAudit({ ev, url, dbgPort, CDP, sleep, args, WAIT_S, COUNTRY, OUT, WIDTH });
      await cleanup(); process.exit(0);
    }
    await shot('final');
  } finally { await cleanup(); }
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.exceptions.length ? 1 : 0);
}

const COLLECT = `(()=>{
  const q=(s,r=document)=>r?[...r.querySelectorAll(s)]:[];
  const live=document.getElementById('cpane-live'), feed=document.getElementById('cpane-feed'), cta=document.getElementById('cn-cta');
  const tiles=q('.csg-tile',live);
  const posts=q('.post',feed);
  const body=document.getElementById('c-body');
  return {
    overlayOpen: !!document.getElementById('c-overlay')?.classList.contains('open'),
    liveLbl: (document.getElementById('cn-live-lbl')?.textContent||'').trim(),
    liveTiles: tiles.length,
    liveTilesPlaying: tiles.filter(t=>t.classList.contains('playing')).length,
    tileLabels: tiles.map(t=>(t.querySelector('.csg-tile-label')?.textContent||'').trim()),
    ctaTiles: q('.cn-tile',cta).length,
    ctaBadges: q('.cn-badge',cta).map(b=>b.textContent.trim()),
    ctaTitles: q('.cn-tile-lbl span',cta).map(s=>s.textContent.trim()).slice(0,10),
    postCount: posts.length,
    firstPosts: posts.slice(0,5).map(p=>({handle:(p.querySelector('.post-handle')?.textContent||'').trim(), name:(p.querySelector('.post-name')?.childNodes[0]?.textContent||'').trim(), body:(p.querySelector('.post-body')?.textContent||'').trim().slice(0,200)})),
    nfStatus: q('.nf-status,.nf-more',feed).map(s=>s.textContent.trim()),
    feedPaneText: posts.length?undefined:(feed?.textContent||'').trim().slice(0,200),
    scroll: body?{top:body.scrollTop,height:body.scrollHeight,client:body.clientHeight}:null,
    theme: document.documentElement.getAttribute('data-theme')||'void',
    overflowX: body?body.scrollWidth-body.clientWidth:null,
    layout: Object.fromEntries(['#c-eyebrow','#c-name','.cn-cta-head','#nation-hero','#nation-hero-badge','#nation-hero-viewers','#nation-hero-caption','#nation-cards','#nation-card-trending','#nation-card-about','#cn-feed-lbl','#cpane-feed .post'].map(s=>{
      const e=document.querySelector(s);if(!e)return [s,null];const r=e.getBoundingClientRect(),cs=getComputedStyle(e);
      return [s,{x:Math.round(r.left),y:Math.round(r.top+(body?body.scrollTop:0)),w:Math.round(r.width),h:Math.round(r.height),fs:cs.fontSize,color:cs.color,hidden:e.hidden||cs.display==='none',text:(e.textContent||'').trim().slice(0,90)}];
    })),
    heroPlaying: !!document.getElementById('nation-hero')?.classList.contains('playing'),
    wideChildren: body?[...body.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left<-1)&&!e.closest('.post-car-strip')}).slice(0,8).map(e=>(e.id?'#'+e.id:'')+'.'+String(e.className).slice(0,40)+' w='+Math.round(e.getBoundingClientRect().width)):[],
  };
})()`;

const GENERIC = /BLOOMBERG|AL ?JAZEERA|DW( NEWS)?\b|FRANCE ?24|CNN|SKY NEWS|EURONEWS|ABC NEWS|NBC|CBS|REUTERS|TRT WORLD|CGTN|WION|NEWSMAX|FOX/i;

async function nationCheck(ev, shot, name) {
  const r = { country: name };
  await ev(`(()=>{try{if(document.getElementById('c-overlay')?.classList.contains('open'))closeOverlay();}catch(e){}})()`);
  await sleep(1000);
  const opened = await ev(`(()=>{try{openCountry(${JSON.stringify(name)});return true}catch(e){return String(e&&e.stack||e)}})()`);
  r.openCountry = opened;
  const t0 = Date.now();
  // Did the feed auto-load (without a tap)? Sample when the first .post appears.
  let firstPostAt = null;
  const early = [];
  while (Date.now() - t0 < WAIT_S * 1000) {
    const n = await ev(`document.querySelectorAll('#cpane-feed .post').length`);
    if (firstPostAt === null && n > 0) firstPostAt = Date.now() - t0;
    if ((Date.now() - t0) % 5000 < 1000) early.push({ t: Math.round((Date.now() - t0) / 1000), posts: n });
    await sleep(1000);
  }
  r.feedAutoLoaded = firstPostAt !== null;
  r.firstPostAfterMs = firstPostAt;
  r.timeline = early;
  r.top = await ev(COLLECT);
  r.screenshotTop = await shot(`${name}-top`);
  await ev(`(()=>{const b=document.getElementById('c-body'),l=document.getElementById('cn-feed-lbl');if(b&&l)b.scrollTop=Math.max(0,l.offsetTop-300);})()`);
  await sleep(1500);
  r.screenshotMid = await shot(`${name}-mid`);
  if (THREADS) r.threads = await threadCheck(ev, shot, name, THREADS);
  const counts = [r.top.postCount];
  for (let i = 0; i < SCROLLS; i++) {
    await ev(`(()=>{const b=document.getElementById('c-body');b.scrollTop=b.scrollHeight;b.dispatchEvent(new Event('scroll'));})()`);
    await sleep(8000);
    counts.push(await ev(`document.querySelectorAll('#cpane-feed .post').length`));
  }
  r.postCountsAcrossScrolls = counts;
  r.postsGrewOnScroll = counts[counts.length - 1] > counts[0];
  r.afterScroll = await ev(COLLECT);
  r.screenshotScrolled = await shot(`${name}-scrolled`);
  if (args.styles) r.media = await mediaCheck(ev, name);
  r.genericTileLabels = r.top.tileLabels.filter(l => GENERIC.test(l));
  await ev(`(()=>{try{closeOverlay()}catch(e){}})()`);
  await sleep(1000);
  return r;
}

// Opens N nation-feed posts (one per source first) the way a tap does, and checks
// the OP card renders at once, its media is there, and source replies land in the deck.
async function threadCheck(ev, shot, name, n) {
  const ids = await ev(`(()=>{const ps=[...document.querySelectorAll('#cpane-feed .post')].map(e=>e.id.slice(5));
    const by={};for(const id of ps){const p=allPosts.find(x=>x.id===id);if(!p)continue;const k=p.source||'?';(by[k]=by[k]||[]).push(id);}
    const pref=k=>({mastodon:0,lemmy:1,news:2}[k]??3);const keys=Object.keys(by).sort((a,b)=>pref(a)-pref(b));
    for(const k of keys)by[k].sort((a,b)=>((allPosts.find(x=>x.id===b)||{}).replies||0)-((allPosts.find(x=>x.id===a)||{}).replies||0));
    const out=[];for(let r=0;out.length<${n}&&r<20;r++)for(const k of keys){if(out.length>=${n})break;if(by[k][r])out.push(by[k][r]);}
    return out;})()`);
  const res = [];
  for (const id of (Array.isArray(ids) ? ids : [])) {
    const x = { id };
    const J = JSON.stringify(id);
    const t0 = Date.now();
    x.open = await ev(`(()=>{try{const el=document.getElementById('post-'+${J});if(el)el.scrollIntoView({block:'center'});
      const b=el&&el.querySelector('.post-body');if(b)b.click();else openThread(${J});
      return document.getElementById('thread-overlay').classList.contains('open')}catch(e){return 'ERR '+(e&&e.stack||e)}})()`);
    await sleep(150);
    x.opInstant = await ev(`(()=>{const o=document.getElementById('thread-original');return {text:(document.getElementById('thread-body-text')?.textContent||'').trim().slice(0,80),media:!!o.querySelector('#thread-op-media > *'),count:document.getElementById('thread-count').textContent,cards:document.querySelectorAll('#thread-comments .tc-wrap').length}})()`);
    let st;
    for (let i = 0; i < 24; i++) {
      st = await ev(`(()=>{const p=allPosts.find(x=>x.id===${J})||{};const rr=_remoteReplies[${J}];return {source:p.source,replies:p.replies,loading:!!_remoteLoading[${J}],cached:Array.isArray(rr)?rr.length:null,
        cards:document.querySelectorAll('#thread-comments .tc-wrap').length,edges:document.querySelectorAll('#thread-comments .tc-edge').length,count:document.getElementById('thread-count').textContent,
        empty:(document.querySelector('#thread-comments .tc-empty')?.textContent||''),
        media:(()=>{const m=document.querySelector('#thread-op-media');return m?[...m.querySelectorAll('img,video,iframe,.au-pill,.img-load,.sparkle-fallback')].map(e=>e.tagName==='DIV'?e.className.split(' ')[0]:e.tagName+(e.tagName==='IMG'?(e.complete&&e.naturalWidth?':ok':':loading'):'')).join(','):''})(),
        article:(()=>{const a=document.querySelector('#thread-original .t-article');return a?a.getAttribute('href'):null})(),
        source:(document.querySelector('#thread-original .thread-source-link')?.textContent||'')}})()`);
      if (st.source !== 'mastodon' && st.source !== 'lemmy') { if (i > 3) break; }
      else if (!st.loading && st.cached !== null) break;
      await sleep(500);
    }
    x.afterMs = Date.now() - t0;
    x.state = st;
    await sleep(700);
    x.shot = await shot(`${name}-thread-${res.length + 1}`);
    x.replyOverlay = await ev(`(()=>{const w=document.querySelector('#thread-comments .tc-wrap.s1,#thread-comments .tc-wrap.s2');if(!w)return null;openReplies(w.dataset.cid);return document.querySelectorAll('#ro-body .tc-card').length})()`);
    if (x.replyOverlay) { await sleep(600); x.replyShot = await shot(`${name}-thread-${res.length + 1}-replies`); await ev(`closeReplies(true,true)`); }
    await ev(`closeThread()`); await sleep(500);
    await ev(`openThread(${J})`); await sleep(100);
    x.reopen = await ev(`({cards:document.querySelectorAll('#thread-comments .tc-wrap').length,loading:!!_remoteLoading[${J}],count:document.getElementById('thread-count').textContent})`);
    await ev(`closeThread()`); await sleep(400);
    res.push(x);
  }
  return res;
}

// --styles: nation feed format mix after the scrolls — style histogram, longest
// same-format run (image+carousel count as one format), posts per source, pool
// backlog, relevance misses, and whether a tapped audio pill actually buffers.
async function mediaCheck(ev, name) {
  const m = await ev(`(()=>{const c=_nf.c||{n:${JSON.stringify(name)}};
    const ps=[...document.querySelectorAll('#cpane-feed .post')].map(e=>allPosts.find(x=>x.id===e.id.slice(5))).filter(Boolean);
    const styles={},sources={},seq=ps.map(p=>p.style==='carousel'?'image':(['image','video','audio'].includes(p.style)?p.style:'take'));
    ps.forEach(p=>{styles[p.style]=(styles[p.style]||0)+1;sources[p.source||'?']=(sources[p.source||'?']||0)+1;});
    let maxRun=0,cur=0,runAt=0;seq.forEach((g,i)=>{cur=i&&seq[i-1]===g?cur+1:1;if(cur>maxRun){maxRun=cur;runAt=i-cur+1;}});
    const offTopic=ps.filter(p=>!(nationNamed(c,p.body+' '+(p._desc||''))||nationIsLocal(p.country,c)||p._region===nationCode(c)||p.source==='mastodon')).map(p=>p.source+': '+String(p.body).slice(0,70));
    return {total:ps.length,styles,sources,maxSameFormatRun:maxRun,first30:seq.slice(0,30).map(g=>g[0]).join(''),maxRunAt:runAt+':'+(seq[runAt]||''),all:seq.map(g=>g[0]).join(''),inflight:Object.keys(_nf.inflight||{}),
      cursors:{lemmyPage:_nf.lemmyPage,ptQ:_nf.ptQ,ptStart:_nf.ptStart,radioOff:_nf.radioOff,iaPage:_nf.iaPage,commonsOff:_nf.commonsOff,commonsVidOff:_nf.commonsVidOff,masto:!!_nf.mastoMax,mastoMedia:!!_nf.mastoMediaMax},
      pool:(_nf.pool||[]).length,exhausted:Object.keys(_nf.exhausted||{}).filter(k=>_nf.exhausted[k]),
      videosWithFile:ps.filter(p=>p.style==='video'&&p._video).length,offTopic:offTopic.slice(0,6)};})()`);
  const pills = await ev(`[...document.querySelectorAll('#cpane-feed .au-pill[data-src]')].length`);
  m.audio = { pills };
  if (pills) {
    m.audio.tries = [];
    for (let k = 0; k < Math.min(3, pills); k++) {
      await ev(`(()=>{const p=[...document.querySelectorAll('#cpane-feed .au-pill[data-src]')][${k}];p.scrollIntoView({block:'center'});p.querySelector('.au-play').click();})()`);
      let s;
      for (let i = 0; i < 16; i++) {
        await sleep(500);
        s = await ev(`(()=>{const a=_auEl;return a?{src:String(a.currentSrc||a.src).slice(0,90),readyState:a.readyState,paused:a.paused,currentTime:+a.currentTime.toFixed(2),error:a.error&&a.error.code}:null})()`);
        if (s && (s.readyState >= 3 && s.currentTime > 0.2 || s.error)) break;
      }
      m.audio.tries.push(s);
      await ev(`(()=>{try{auStop()}catch(e){}})()`);
      if (s && s.readyState >= 3 && s.currentTime > 0.2) break;
    }
    m.audio.plays = m.audio.tries.some(s => s && s.readyState >= 3 && s.currentTime > 0.2);
  }
  return m;
}

async function wallCheck(ev) {
  const r = {};
  const types = await ev(`(()=>{try{return typeof wallSlots==='function' ? wallSlots().slice(0,300).map(s=>s&&s.src&&(s.src.type||'?')) : null}catch(e){return {__error:String(e&&e.stack||e)}}})()`);
  if (!Array.isArray(types)) { r.error = types === null ? 'wallSlots not a function' : types; return r; }
  const tally = arr => { const hls = arr.filter(t => t === 'hls').length; return { total: arr.length, hls, life: arr.length - hls }; };
  r.first30Types = types.slice(0, 30);
  r.first30 = tally(types.slice(0, 30));
  r.first300 = tally(types);
  const bad = [];
  for (let i = 0; i + 3 <= Math.min(30, types.length); i++) if (!types.slice(i, i + 3).includes('hls')) bad.push(i);
  r.every3WindowHasHls = bad.length === 0;
  r.windowsWithoutHls = bad;
  return r;
}

main().catch(e => { console.error(e); console.log(JSON.stringify(summary, null, 2)); process.exit(2); });
