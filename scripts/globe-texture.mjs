#!/usr/bin/env node
// Regenerate src/features/globe/earthTexture.ts from assets/globe/earth-night.jpg.
// The globe map must reach GL as raw bytes: expo-gl uploads a bundled file through a
// native path that some drivers refuse (MT6762: GL error 1282), so the PNG travels in
// the JS bundle and is decoded by the app (frameSample.decodePngRGBA).
//
//   node scripts/globe-texture.mjs [width=768] [height=384]
// Needs Chrome (headless) to resize and re-encode; no dependencies.
import fs from 'node:fs'; import net from 'node:net'; import http from 'node:http'; import path from 'node:path'; import os from 'node:os'; import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'void-app/assets/globe/earth-night.jpg');
const OUT = path.join(ROOT, 'void-app/src/features/globe/earthTexture.ts');
const W = Number(process.argv[2] || 768), H = Number(process.argv[3] || 384);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = await new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const dbg = await new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = http.createServer((q, s) => { if (q.url === '/') { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end('<!doctype html><title>x</title>'); return; } s.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' }); fs.createReadStream(SRC).pipe(s); }).listen(port);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'png-'));
const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
let t; for (let i = 0; i < 60 && !t; i++) { try { t = (await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json()).find(x => x.type === 'page'); } catch {} if (!t) await sleep(250); }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/' }); await sleep(800);
const b64 = await ev(`(async()=>{const img=new Image();img.crossOrigin='anonymous';img.src='http://127.0.0.1:${port}/e.jpg';await img.decode();
  const c=document.createElement('canvas');c.width=${W};c.height=${H};const x=c.getContext('2d');x.drawImage(img,0,0,${W},${H});
  return c.toDataURL('image/png').split(',')[1];})()`);
const head = [
  '// The night-lights map as a base64 PNG, ' + W + 'x' + H + ', decoded in JS at runtime.',
  '// Regenerate with scripts/globe-texture.mjs. See textures.ts for why it lives here.',
  'export const EARTH_PNG_B64 =',
  "  '" + b64 + "';",
  '',
].join('
');
fs.writeFileSync(OUT, head);
console.log('wrote', OUT, Math.round(head.length / 1024) + 'KB', W + 'x' + H);
try { spawn('taskkill', ['/pid', String(ch.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} srv.close(); process.exit(0);
