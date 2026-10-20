// Records demo.html driving watcher.js frame by frame: out/watcher-demo.mp4 (1280x720, 30 fps). node record.mjs
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const ff = spawn(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-r', '30', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', path.join(here, 'out', 'watcher-demo.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] });
const closed = new Promise((r) => ff.on('close', r));
const b = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME || undefined });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]); // Windows with animations off reports reduce
await p.goto(pathToFileURL(path.join(here, 'demo.html')).href);
await p.evaluate(() => { Watcher.manual = true; Watcher.restart(0); });
const box = await p.evaluate(() => Object.fromEntries(['hero', 'v1', 'v2', 'v3'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [id, [r.left + r.width / 2, r.top + r.height / 2]]; })));
// a cursor drawn into the page so the viewer sees what the eyes follow
await p.evaluate(() => { const c = document.createElement('div'); c.id = 'cur'; c.style.cssText = 'position:fixed;left:0;top:0;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px #0008;pointer-events:none;z-index:9;transform:translate(-50%,-50%)'; document.body.append(c); });
const lerp = (a, b, t) => a + (b - a) * t, sm = (t) => t * t * (3 - 2 * t);
const T = 9, N = T * 30;
for (let k = 0; k < N; k++) {
  const t = k / 30;
  let x = 640, y = 620, hover = null;
  if (t >= 1.6 && t < 4.6) { const a = (t - 1.6) / 3 * Math.PI * 2; x = 330 + 260 * Math.cos(a); y = 360 + 220 * Math.sin(a * 2) * 0.6; }
  else if (t >= 4.6 && t < 6.2) { const u = sm(Math.min(1, (t - 4.6) / 0.5)); x = lerp(590, box.hero[0] + 20, u); y = lerp(360, box.hero[1], u); if (u >= 1) hover = 'hero'; }
  else if (t >= 6.2) { const u = sm(Math.min(1, (t - 6.2) / 0.7)); x = lerp(box.hero[0] + 20, box.v2[0], u); y = lerp(box.hero[1], box.v2[1], u); if (u >= 1) hover = 'v2'; }
  await p.evaluate((x, y, hover, ms) => {
    document.getElementById('cur').style.left = x + 'px'; document.getElementById('cur').style.top = y + 'px';
    Watcher.point(x, y);
    for (const id of ['hero', 'v1', 'v2', 'v3']) { const e = document.getElementById(id); Watcher.hover(e, id === hover); if (id !== 'hero') e.style.color = id === hover ? '#c9a84c' : ''; }
    Watcher.frame(ms);
  }, x, y, hover, t * 1000);
  ff.stdin.write(await p.screenshot({ type: 'png' }));
}
ff.stdin.end();
await b.close();
await closed;
console.log('recorded', N, 'frames');
