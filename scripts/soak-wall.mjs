#!/usr/bin/env node
// Long-running wall soak: open the globe wall, leave it alone, and watch how long
// each stream actually keeps running. Headless Chrome over CDP, phone-sized, zero deps.
//
// "Running" means the picture is moving: currentTime advanced AND new frames were
// decoded since the last sample. A <video> can sit in the 'playing' state on a
// frozen frame, so the state flag alone is not trusted.
//
// Usage: node scripts/soak-wall.mjs [--minutes=20] [--every=30] [--chrome=path] [--out=dir]
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
const MINUTES = Number(args.minutes || 20);
const EVERY_S = Number(args.every || 30);
const CHROME = args.chrome || process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve(args.out || path.join(os.tmpdir(), 'void-soak'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
function serve(port) {
  const srv = http.createServer((req, res) => {
    try {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const f = path.join(ROOT, u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404).end(); return; }
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

// One sample of every wall tile that is on screen. Runs in the page.
const SAMPLE = `(()=>{
  const tiles=[...document.querySelectorAll('#gl-grid .gl-tile')];
  const q=v=>{try{return v.getVideoPlaybackQuality().totalVideoFrames;}catch(e){return v.webkitDecodedFrameCount||0;}};
  const onScreen=el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.width>0;};
  return {
    t:Date.now(),
    tiles:tiles.map((c,i)=>{
      const v=c.querySelector('video'),f=c.querySelector('iframe');
      const lbl=(c.querySelector('.csg-tile-label,.gl-tile-label')||{}).textContent||'';
      return {
        i, vis:onScreen(c),
        kind:v?'hls':f?'yt':(c.classList.contains('csg-offline')?'offline':'connecting'),
        key:(v&&v.__src&&(v.__src.url||v.__src.label))||(f&&f.src&&f.src.split('?')[0])||'',
        label:lbl.trim().slice(0,40),
        parked:!!c.__parked, healing:!!c.__healing,
        paused:v?v.paused:null, rs:v?v.readyState:null,
        ct:v?+v.currentTime.toFixed(2):null, frames:v?q(v):null,
        err:v&&v.error?v.error.code:0,
        yt:f?(f.__ytState??null):null,
        h:v?v.videoHeight:0
      };
    })
  };
})()`;

async function main() {
  const port = await freePort(), dbgPort = await freePort();
  const srv = await serve(port);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'void-soak-'));
  const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${profile}`,
    '--autoplay-policy=no-user-gesture-required', '--window-size=412,915', `--user-agent=${UA}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  const exceptions = [];
  const cleanup = async () => { cdp?.close(); try { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); else chrome.kill(); } catch {} srv.close(); await sleep(1500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} };
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try { target = (await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
      if (!target) await sleep(250);
    }
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    cdp.on(m => { if (m.method === 'Runtime.exceptionThrown') exceptions.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 200)); });
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Performance.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/void2-final.html` });
    const ev = async expr => { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.exceptionDetails ? { __error: r.exceptionDetails.text } : r.result.value; };
    for (let i = 0; i < 60; i++) { if (await ev(`document.readyState==='complete'&&typeof switchTab==='function'`) === true) break; await sleep(500); }
    await sleep(2500);
    await ev(`(()=>{try{if(typeof signInAnon==='function')signInAnon();}catch(e){}return 1})()`);
    await sleep(2500);
    await ev(`(()=>{try{switchTab('globe');setGlobeMode('globe',1);}catch(e){return String(e)}return 1})()`);

    // Per-stream history: when it was first seen running, the last time it was seen
    // running, how many samples it ran/froze, and whether it ever came back.
    const streams = new Map();
    const timeline = [];
    let prev = new Map();
    const t0 = Date.now(), tEnd = t0 + MINUTES * 60000;
    let n = 0;
    while (Date.now() < tEnd) {
      await sleep(EVERY_S * 1000);
      n++;
      const s = await ev(SAMPLE);
      const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
      const now = s.t, dt = prev.size ? (now - prev.get('__t')) / 1000 : EVERY_S;
      let running = 0, frozen = 0, parked = 0, offline = 0, connecting = 0, yt = 0, fpsList = [];
      for (const tile of s.tiles.filter(x => x.vis)) {
        if (tile.kind === 'offline') { offline++; continue; }
        if (tile.kind === 'connecting') { connecting++; continue; }
        if (tile.kind === 'yt') { yt++; continue; }                 // cross-origin: no frame counter
        if (tile.parked) { parked++; continue; }
        const was = prev.get(tile.i);
        const same = was && was.key === tile.key;
        const moved = same && tile.ct > was.ct + 0.5 && tile.frames > was.frames;
        const fps = same ? (tile.frames - was.frames) / dt : null;
        const st = streams.get(tile.key) || { label: tile.label, firstRun: null, lastRun: null, runSamples: 0, frozenSamples: 0, recoveries: 0, wasFrozen: false, h: tile.h };
        if (same) {
          if (moved) { running++; fpsList.push(fps); st.runSamples++; st.lastRun = now; st.firstRun ??= now; if (st.wasFrozen) { st.recoveries++; st.wasFrozen = false; } }
          else { frozen++; st.frozenSamples++; st.wasFrozen = true; }
        }
        streams.set(tile.key, st);
      }
      fpsList.sort((a, b) => a - b);
      const row = {
        min: +((now - t0) / 60000).toFixed(1), running, frozen, parked, yt, connecting, offline,
        fpsMedian: fpsList.length ? +fpsList[Math.floor(fpsList.length / 2)].toFixed(1) : null,
        heapMB: +(metrics.JSHeapUsedSize / 1048576).toFixed(0), nodes: metrics.Nodes,
      };
      timeline.push(row);
      console.log(`[soak ${row.min}m] running ${running}  frozen ${frozen}  parked ${parked}  yt ${yt}  connecting ${connecting}  offline ${offline}  fps~${row.fpsMedian}  heap ${row.heapMB}MB  nodes ${row.nodes}`);
      prev = new Map(s.tiles.map(x => [x.i, x])); prev.set('__t', now);
      if (n % 4 === 0) { try { const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 50 }); fs.writeFileSync(path.join(OUT, `wall-${row.min}m.jpg`), Buffer.from(r.data, 'base64')); } catch {} }
    }
    // Per-stream verdict: how long did each one keep running, from first to last
    // moving sample, and did it freeze without coming back?
    const per = [...streams.values()].filter(s => s.firstRun).map(s => ({
      label: s.label, runMin: +(((s.lastRun - s.firstRun) / 60000) + EVERY_S / 60).toFixed(1),
      frozenSamples: s.frozenSamples, recoveries: s.recoveries, endedFrozen: s.wasFrozen, height: s.h,
    })).sort((a, b) => b.runMin - a.runMin);
    const summary = {
      minutes: MINUTES, sampleEvery: EVERY_S, exceptions: exceptions.slice(0, 10),
      streamsSeenRunning: per.length,
      ranWholeSoak: per.filter(p => p.runMin >= MINUTES - EVERY_S / 60 * 2 && !p.endedFrozen).length,
      diedAndStayedDead: per.filter(p => p.endedFrozen).length,
      recoveredFromFreeze: per.filter(p => p.recoveries > 0).length,
      medianRunMin: per.length ? per.map(p => p.runMin).sort((a, b) => a - b)[Math.floor(per.length / 2)] : 0,
      heapStartMB: timeline[0]?.heapMB, heapEndMB: timeline.at(-1)?.heapMB,
      perStream: per, timeline,
    };
    fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(summary, null, 2));
    await cleanup();
    console.log(JSON.stringify({ ...summary, timeline: undefined, perStream: summary.perStream.slice(0, 15) }, null, 2));
    console.log('full report:', path.join(OUT, 'soak.json'));
    process.exit(0);
  } catch (e) { await cleanup(); console.error('soak failed:', e && e.stack || e); process.exit(1); }
}
main();
