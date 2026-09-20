#!/usr/bin/env node
// How fast is each screen of the Android app, and why. Runs on the PC, reads the phone
// over adb. Nothing is added to the app. Zero dependencies.
//
//   node scripts/perf-android.mjs [--every=3] [--pkg=com.thevoid.app] [--adb=path]
//
// Use a release/preview APK, not a dev-client build (dev JS is several times slower).
// While it runs, type the screen you are on (e.g. `globe`) + Enter to label the rows.
// Ctrl+C prints a per-screen summary.
//
// Per interval it reports:
//   frames    what the user sees: frames drawn, % janky, frame-time percentiles (gfxinfo)
//   CPU       where the time went, per thread (100% = one core fully busy):
//               JS       mqt_*js      React, app logic, three.js scene updates
//               UI       main thread  layout, view creation, touch, native animations
//               Render   RenderThread drawing the UI (blur, shadows, big images)
//               WebView  sandboxed renderer processes (YouTube players)
//               other    the busiest remaining threads by name (expo-gl's globe
//                        thread is an unnamed `Thread-N`)
//   mem       total PSS of the app
//   why       the thread that is the bottleneck, in plain words
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const run = promisify(execFile);
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const PKG = args.pkg || 'com.thevoid.app';
const EVERY = Number(args.every || 3);
const ADB = args.adb || [
  process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
].find((p) => p && fs.existsSync(p)) || 'adb';
const HZ = 100; // Android USER_HZ

const sh = async (cmd) => (await run(ADB, ['shell', cmd], { maxBuffer: 32 << 20 })).stdout;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pidOf(name) {
  const out = (await sh(`pidof ${name}`).catch(() => '')).trim();
  return out ? Number(out.split(/\s+/)[0]) : 0;
}

// { tid: { name, ticks } } for every thread of pid
async function threadTicks(pid) {
  const out = await sh(`cat /proc/${pid}/task/*/stat 2>/dev/null`).catch(() => '');
  const res = {};
  for (const line of out.split('\n')) {
    const l = line.indexOf('('), r = line.lastIndexOf(')');
    if (l < 0 || r < 0) continue;
    const f = line.slice(r + 2).split(' ');
    res[line.slice(0, l).trim()] = { name: line.slice(l + 1, r), ticks: Number(f[11]) + Number(f[12]) };
  }
  return res;
}

// Total ticks of every WebView renderer process (YouTube players live there).
async function webviewTicks() {
  const out = await sh(`for p in $(ps -A -o PID,NAME | grep -iE 'sandboxed_process|webview' | awk '{print $1}'); do cat /proc/$p/stat 2>/dev/null; done`).catch(() => '');
  let t = 0;
  for (const line of out.split('\n')) {
    const r = line.lastIndexOf(')');
    if (r < 0) continue;
    const f = line.slice(r + 2).split(' ');
    t += Number(f[11]) + Number(f[12]);
  }
  return t;
}

async function frames() {
  const out = await sh(`dumpsys gfxinfo ${PKG} reset`).catch(() => '');
  const num = (re) => { const m = out.match(re); return m ? Number(m[1]) : 0; };
  const total = num(/Total frames rendered:\s*(\d+)/);
  if (!total) return { total: 0, jank: 0, p50: 0, p90: 0, p99: 0, idle: true };
  return {
    total,
    jank: num(/Janky frames:\s*\d+\s*\(([\d.]+)%\)/),
    p50: num(/50th percentile:\s*(\d+)ms/),
    p90: num(/90th percentile:\s*(\d+)ms/),
    p99: num(/99th percentile:\s*(\d+)ms/),
    idle: false,
  };
}

async function memMB() {
  const out = await sh(`dumpsys meminfo ${PKG}`).catch(() => '');
  const m = out.match(/TOTAL PSS:\s*(\d+)/) || out.match(/^\s*TOTAL\s+(\d+)/m);
  return m ? Math.round(Number(m[1]) / 1024) : 0;
}

function classify(name, tid, pid) {
  if (Number(tid) === pid) return 'UI';
  if (/^mqt_(v_)?js/.test(name)) return 'JS';
  if (/^RenderThread/.test(name)) return 'Render';
  return null;
}

function why(s) {
  if (s.idle) return 'nothing drew this interval (screen off, app in the background, or a static screen)';
  const r = [];
  if (s.JS >= 85) r.push('JS thread maxed: React re-renders, app logic or three.js work; taps and scrolling lag');
  if (s.UI >= 85) r.push('UI thread maxed: too many views being laid out or created at once');
  if (s.Render >= 70) r.push('RenderThread heavy: expensive drawing (blur views, shadows, large images, overdraw)');
  if (s.WebView >= 100) r.push(`WebView processes at ${s.WebView.toFixed(0)}%: YouTube players decoding video`);
  if (s.topOther && s.topOther.pct >= 60) r.push(`${s.topOther.name} at ${s.topOther.pct.toFixed(0)}%` + (/^Thread-/.test(s.topOther.name) ? ' (likely the expo-gl globe render thread)' : ''));
  if (!r.length && s.jank > 10) r.push('no CPU thread maxed, so it is likely GPU-bound (fill rate, MSAA, big textures)');
  return r.length ? r.join('; ') : 'smooth';
}

const f1 = (n) => n.toFixed(0).padStart(3);
const rows = [];
let labelNow = '-';

async function main() {
  const dev = (await run(ADB, ['devices'])).stdout.split('\n').slice(1).filter((l) => /\tdevice$/.test(l.trim() + ''));
  if (!dev.length) {
    console.error('No phone found. Plug it in via USB, enable USB debugging, accept the prompt, then retry.');
    process.exit(1);
  }
  let pid = await pidOf(PKG);
  if (!pid) {
    console.log(`${PKG} is not running; launching it…`);
    await sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`).catch(() => {});
    for (let i = 0; i < 20 && !pid; i++) { await sleep(500); pid = await pidOf(PKG); }
    if (!pid) { console.error('App did not start. Is the APK installed?'); process.exit(1); }
  }
  const ncpu = Number((await sh('nproc').catch(() => '8')).trim()) || 8;
  console.log(`Measuring ${PKG} (pid ${pid}, ${ncpu} cores) every ${EVERY}s. Type the screen name + Enter to label rows. Ctrl+C for summary.\n`);

  readline.createInterface({ input: process.stdin }).on('line', (l) => {
    labelNow = l.trim() || '-';
    console.log(`── screen: ${labelNow} ──`);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { summary(); process.exit(0); });

  await frames(); // reset the counters
  let prevT = await threadTicks(pid), prevW = await webviewTicks(), prevAt = Date.now();
  for (;;) {
    await sleep(EVERY * 1000);
    const [fr, curT, curW, mem] = await Promise.all([frames(), threadTicks(pid), webviewTicks(), memMB()]);
    const secs = (Date.now() - prevAt) / 1000;
    prevAt = Date.now();
    if (!Object.keys(curT).length) { console.log('app process gone (closed or crashed)'); break; }
    const pct = (d) => (d / HZ / secs) * 100;
    const s = { JS: 0, UI: 0, Render: 0, WebView: Math.max(0, pct(curW - prevW)), total: 0, others: [] };
    for (const tid in curT) {
      const d = curT[tid].ticks - (prevT[tid]?.ticks ?? curT[tid].ticks);
      const p = pct(d);
      s.total += p;
      const k = classify(curT[tid].name, tid, pid);
      if (k) s[k] += p;
      else if (p > 1) s.others.push({ name: curT[tid].name, pct: p });
    }
    s.others.sort((a, b) => b.pct - a.pct);
    s.topOther = s.others[0];
    prevT = curT;
    prevW = curW;
    s.jank = fr.jank;
    s.idle = fr.idle;
    const row = { label: labelNow, ...fr, mem, JS: s.JS, UI: s.UI, Render: s.Render, WebView: s.WebView, total: s.total };
    rows.push(row);
    const t = new Date().toTimeString().slice(0, 8);
    console.log(`[${t}] ${labelNow.padEnd(10)} ` + (fr.idle
      ? 'frames    0  (idle — nothing redrawn)                          '
      : `frames ${String(fr.total).padStart(4)}  jank ${fr.jank.toFixed(1).padStart(5)}%  p50 ${f1(fr.p50)}ms p90 ${f1(fr.p90)}ms p99 ${f1(fr.p99)}ms`) + `  mem ${mem || '?'}MB`);
    console.log(`           CPU  JS ${f1(s.JS)}%  UI ${f1(s.UI)}%  Render ${f1(s.Render)}%  WebView ${f1(s.WebView)}%  app total ${f1(s.total)}%/${ncpu * 100}%` +
      (s.others.length ? `  top: ${s.others.slice(0, 3).map((o) => `${o.name} ${o.pct.toFixed(0)}%`).join(', ')}` : ''));
    console.log(`           why  ${why(s)}\n`);
  }
  summary();
}

function summary() {
  if (!rows.length) return;
  const by = {};
  // Idle intervals would drag every average toward "perfect".
  for (const r of rows) if (!r.idle) (by[r.label] ??= []).push(r);
  if (!Object.keys(by).length) return;
  const avg = (a, k) => a.reduce((x, r) => x + r[k], 0) / a.length;
  console.log('\nPer-screen summary (averages)');
  console.log('screen      jank%   p90ms  p99ms   JS%   UI%  Rend%  WebV%  memMB');
  for (const [k, a] of Object.entries(by)) {
    console.log(`${k.padEnd(10)} ${avg(a, 'jank').toFixed(1).padStart(6)} ${f1(avg(a, 'p90')).padStart(6)} ${f1(avg(a, 'p99')).padStart(6)}  ${f1(avg(a, 'JS'))}  ${f1(avg(a, 'UI'))}   ${f1(avg(a, 'Render'))}    ${f1(avg(a, 'WebView'))}   ${f1(avg(a, 'mem'))}`);
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
