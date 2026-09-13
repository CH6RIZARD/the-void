#!/usr/bin/env node
// Zero-dependency headless UI check for void2-final.html via Chrome DevTools Protocol.
// Usage: node scripts/verify-ui.mjs [--only=nation|wall] [--country=Morocco]
//        [--compare=Japan|none] [--wait=25] [--chrome=path] [--out=dir]
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'void-chrome-'));
  const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${profile}`,
    '--autoplay-policy=no-user-gesture-required', '--window-size=412,915', `--user-agent=${UA}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  const cleanup = async () => { cdp?.close(); try { chrome.kill(); } catch {} srv.close(); await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const url = `http://127.0.0.1:${port}/void2-final.html`;
    summary.page = url;
    await cdp.send('Page.navigate', { url });

    const ev = async (expr, awaitPromise = false) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
      if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
      return r.result.value;
    };
    const shot = async name => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const f = path.join(OUT, `${name}.png`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); summary.screenshots.push(f); return f;
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
    summary.boot = { ok: booted === true, identityGate: gate };

    if (ONLY === 'all' || ONLY === 'nation') {
      summary.nation = {};
      for (const name of [COUNTRY, COMPARE].filter(Boolean)) summary.nation[name] = await nationCheck(ev, shot, name);
    }
    if (ONLY === 'all' || ONLY === 'wall') summary.wall = await wallCheck(ev);
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
  const counts = [r.top.postCount];
  for (let i = 0; i < 2; i++) {
    await ev(`(()=>{const b=document.getElementById('c-body');b.scrollTop=b.scrollHeight;b.dispatchEvent(new Event('scroll'));})()`);
    await sleep(8000);
    counts.push(await ev(`document.querySelectorAll('#cpane-feed .post').length`));
  }
  r.postCountsAcrossScrolls = counts;
  r.postsGrewOnScroll = counts[2] > counts[0];
  r.afterScroll = await ev(COLLECT);
  r.screenshotScrolled = await shot(`${name}-scrolled`);
  r.genericTileLabels = r.top.tileLabels.filter(l => GENERIC.test(l));
  await ev(`(()=>{try{closeOverlay()}catch(e){}})()`);
  await sleep(1000);
  return r;
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
