#!/usr/bin/env node
// Decoder-budget + reels probe for void2-final.html, over CDP, zero dependencies.
//
// It answers the two questions the 10fps report raised, with numbers instead of
// opinion: how many videos are actually DECODING after the wall has been scrolled,
// and what frame rate the visible ones are getting. Then it swipes to reels and
// checks a card really plays.
//
// Usage: node scripts/verify-perf.mjs [--wait=25] [--scrolls=8] [--chrome=path]
//        [--only=wall|reels] [--out=dir]
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
const WAIT_S = Number(args.wait || 25);
const SCROLLS = Number(args.scrolls || 8);
const ONLY = args.only || 'all';
const CHROME = args.chrome || process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve(args.out || path.join(os.tmpdir(), 'void-verify-perf'));
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.m3u8': 'application/vnd.apple.mpegurl' };

function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
function serve(port) {
  const srv = http.createServer((req, res) => {
    try {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let f = path.join(ROOT, u);
      if (!f.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      if (!fs.existsSync(f)) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(res);
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r(srv)));
}
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
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

const summary = { page: null, exceptions: [], consoleErrors: [], wall: null, reels: null, screenshots: [] };

// Counts decoders the way the platform sees them, and samples real decoded FPS over
// a window: getVideoPlaybackQuality().totalVideoFrames is the only honest source —
// a video can be "playing" and still be handing over 8 frames a second.
const PROBE_DECODERS = `(async()=>{
  const w=ms=>new Promise(r=>setTimeout(r,ms));
  const vids=[...document.querySelectorAll('video')];
  const near=v=>{const r=v.getBoundingClientRect();return r.bottom>-100&&r.top<innerHeight+100&&r.width>0;};
  const q=v=>{try{return v.getVideoPlaybackQuality().totalVideoFrames;}catch(e){return (v.webkitDecodedFrameCount||0);}};
  const before=vids.map(v=>({v,n:q(v),near:near(v)}));
  const t0=performance.now();
  await w(3000);
  const dt=(performance.now()-t0)/1000;
  const rows=before.map(({v,n,near})=>({
    near, playing:!v.paused&&!v.ended&&v.readyState>2,
    parked:!!(v.closest('.gl-tile,.csg-tile,.search-live-slot')||{}).__parked,
    fps:+(((q(v)-n)/dt)).toFixed(1),
    w:Math.round(v.getBoundingClientRect().width),
    h:v.videoHeight||0
  }));
  const playing=rows.filter(r=>r.playing);
  const nearPlaying=playing.filter(r=>r.near);
  const fpsList=nearPlaying.map(r=>r.fps).filter(f=>f>0).sort((a,b)=>a-b);
  return {
    videos:rows.length,
    playing:playing.length,
    playingOffscreen:playing.filter(r=>!r.near).length,
    parked:rows.filter(r=>r.parked).length,
    iframes:document.querySelectorAll('iframe[src*="youtube"]').length,
    budget:(typeof LIVE_MAX_DECODING!=='undefined'?LIVE_MAX_DECODING:null),
    nearPlaying:nearPlaying.length,
    fpsMin:fpsList[0]??null,
    fpsMedian:fpsList.length?fpsList[Math.floor(fpsList.length/2)]:null,
    fpsAll:nearPlaying.map(r=>r.fps),
    heights:[...new Set(nearPlaying.map(r=>r.h))].sort((a,b)=>a-b),
    tileWidths:[...new Set(nearPlaying.map(r=>r.w))].sort((a,b)=>a-b)
  };
})()`;

async function main() {
  const port = await freePort(), dbgPort = await freePort();
  const srv = await serve(port);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'void-perf-'));
  const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${profile}`,
    '--autoplay-policy=no-user-gesture-required', '--window-size=412,915', `--user-agent=${UA}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio', '--disk-cache-size=1', '--media-cache-size=1',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  const cleanup = async () => { cdp?.close(); try { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); else chrome.kill(); } catch {} srv.close(); await sleep(1200); for (let i = 0; i < 5; i++) { try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(800); } } };
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try { const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json(); target = list.find(t => t.type === 'page'); } catch {}
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('Chrome page target not found');
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    cdp.on(msg => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        summary.exceptions.push({ text: d.exception?.description || d.text, line: d.lineNumber + 1 });
      } else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
        const text = msg.params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
        if (/reels|hls|void/i.test(text)) summary.consoleErrors.push(text.slice(0, 300));
      }
    });
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
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
      const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 55 });
      const f = path.join(OUT, `${name}.jpg`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); summary.screenshots.push(f); return f;
    };

    for (let i = 0; i < 60; i++) { if (await ev(`document.readyState==='complete' && typeof openCountry==='function'`) === true) break; await sleep(500); }
    await sleep(2500);
    await ev(`(()=>{try{if(typeof signInAnon==='function')signInAnon();}catch(e){}return 1})()`);
    await sleep(3000);

    if (ONLY === 'all' || ONLY === 'wall') {
      await ev(`(()=>{try{switchTab('globe');if(typeof setGlobeMode==='function')setGlobeMode('globe',1);}catch(e){}return 1})()`);
      await sleep(WAIT_S * 1000);
      // Scroll the wall deep: this is what used to leave 30+ decoders running.
      for (let i = 0; i < SCROLLS; i++) {
        await ev(`(()=>{const s=document.getElementById('gl-grid')?.parentElement||document.scrollingElement;(s.scrollBy?s:window).scrollBy(0,innerHeight*1.5);return 1})()`);
        await sleep(1200);
      }
      await sleep(8000);
      summary.wall = { afterScroll: await ev(PROBE_DECODERS, true) };
      await shot('wall');
      // Leaving the surface must stop the wall decoding, not just flag it.
      await ev(`(()=>{try{switchTab('void');}catch(e){}return 1})()`);
      await sleep(3500);
      summary.wall.afterLeavingTab = await ev(PROBE_DECODERS, true);
      await ev(`(()=>{try{switchTab('globe');}catch(e){}return 1})()`);
      await sleep(4000);
      summary.wall.afterReturning = await ev(PROBE_DECODERS, true);
    }

    if (ONLY === 'all' || ONLY === 'reels') {
      await ev(`(()=>{try{switchTab('globe');setGlobeMode('reels',1);}catch(e){return String(e)}return 1})()`);
      // Reels have to reach a PLAYING card on their own; poll rather than assume.
      let reel = null;
      for (let i = 0; i < 30; i++) {
        reel = await ev(`(()=>{
          const ct=document.getElementById('greel-container');if(!ct)return{err:'no container'};
          const items=[...ct.querySelectorAll('.vw-item')];
          const vids=items.map(el=>el.querySelector('.vw-vid')).filter(Boolean);
          return {
            items:items.length,
            empty:(ct.querySelector('.greel-empty')||{}).textContent||'',
            ready:vids.filter(v=>v.readyState>2).length,
            playing:vids.filter(v=>!v.paused&&v.readyState>2).length,
            attached:vids.filter(v=>v.dataset.ready).length,
            wallPlaying:[...document.querySelectorAll('.gl-tile video')].filter(v=>!v.paused).length
          };
        })()`);
        if (reel && reel.playing > 0) break;
        await sleep(1000);
      }
      summary.reels = { firstCard: reel };
      await shot('reels');
      // Swipe to the next card: the warmed item should take over quickly.
      await ev(`(()=>{const ct=document.getElementById('greel-container');if(ct)ct.scrollBy({top:ct.clientHeight});return 1})()`);
      await sleep(6000);
      summary.reels.afterSwipe = await ev(`(()=>{
        const ct=document.getElementById('greel-container');if(!ct)return null;
        const vids=[...ct.querySelectorAll('.vw-vid')];
        return {
          playing:vids.filter(v=>!v.paused&&v.readyState>2).length,items:vids.length,
          scrollTop:Math.round(ct.scrollTop),cardH:Math.round(ct.clientHeight),
          cards:vids.map(v=>({
            src:String(v.dataset.src||'').slice(0,60),
            ready:!!v.dataset.ready, want:!!v.__want, gone:!!v.__gone,
            paused:v.paused, rs:v.readyState, net:v.networkState,
            err:v.error?v.error.code:0, hls:!!v.__hls,
            top:Math.round(v.getBoundingClientRect().top)
          }))
        };
      })()`);
      summary.reels.fps = await ev(PROBE_DECODERS, true);
    }

    await cleanup();
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  } catch (e) {
    await cleanup();
    console.error('verify-perf failed:', e && e.stack || e);
    process.exit(1);
  }
}
main();
