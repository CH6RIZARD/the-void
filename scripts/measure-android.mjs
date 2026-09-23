#!/usr/bin/env node
// The §8 "after" row, measured the same way the baseline was: cold start, per-screen
// jank, PSS, ANRs, APK size. Nothing is added to the app; everything is read over adb.
//
//   node scripts/measure-android.mjs --apk=D:/void-build/current/the-void-apk/the-void.apk
//
// Drives the app itself (force-stop, launch, tab taps, scrolls) so the numbers are
// produced the same way every run.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const run = promisify(execFile);
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const PKG = args.pkg || 'com.thevoid.app';
const APK = args.apk;
const COLD_RUNS = Number(args.runs || 5);
const ADB = args.adb || [
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
].find(p => p && fs.existsSync(p)) || 'adb';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sh = async (...a) => (await run(ADB, a, { maxBuffer: 1 << 26 })).stdout;
const shell = (...a) => sh('shell', ...a);

const median = xs => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };

async function coldStart() {
  const times = [];
  for (let i = 0; i < COLD_RUNS; i++) {
    await shell('am', 'force-stop', PKG).catch(() => {});
    await sleep(2500);
    const out = await shell('am', 'start', '-W', '-n', `${PKG}/.MainActivity`).catch(e => String(e));
    const total = Number((out.match(/TotalTime:\s*(\d+)/) || [])[1] || 0);
    const wait = Number((out.match(/WaitTime:\s*(\d+)/) || [])[1] || 0);
    times.push(total || wait || null);
    await sleep(6000);
  }
  return { runs: times, median: median(times.filter(Boolean)) };
}

/** gfxinfo for one screen, after driving it. Returns janky % and frame-time p90/p95. */
async function screenJank(label, drive) {
  await shell('dumpsys', 'gfxinfo', PKG, 'reset').catch(() => {});
  await drive();
  const t = await shell('dumpsys', 'gfxinfo', PKG).catch(() => '');
  const num = re => Number((t.match(re) || [])[1] || 0);
  const frames = num(/Total frames rendered:\s*(\d+)/);
  const janky = num(/Janky frames:\s*(\d+)/);
  const pct = s => { const m = t.match(new RegExp(s + '\\s+([\\d.]+)ms')); return m ? Number(m[1]) : null; };
  return {
    screen: label, frames, jankyPct: frames ? Math.round((janky / frames) * 100) : null,
    p50: pct('50th percentile:'), p90: pct('90th percentile:'), p95: pct('95th percentile:'), p99: pct('99th percentile:'),
  };
}

async function pss() {
  const t = await shell('dumpsys', 'meminfo', PKG).catch(() => '');
  const total = Number((t.match(/TOTAL(?:\s+PSS)?:?\s+(\d+)/) || [])[1] || 0);
  const egl = Number((t.match(/EGL mtrack\s+(\d+)/) || [])[1] || 0);
  const gl = Number((t.match(/GL mtrack\s+(\d+)/) || [])[1] || 0);
  return { pssMB: Math.round(total / 1024), eglMB: Math.round(egl / 1024), glMB: Math.round(gl / 1024) };
}

async function anrsSince(sinceMs) {
  const t = await shell('dumpsys', 'dropbox', '--print', 'data_app_anr').catch(() => '');
  const stamps = [...t.matchAll(/^Time:\s*(.+)$/gm)].map(m => Date.parse(m[1].trim())).filter(Boolean);
  return stamps.filter(s => s >= sinceMs).length;
}

const tap = (x, y) => shell('input', 'tap', String(x), String(y));
const swipe = (x1, y1, x2, y2, ms = 300) => shell('input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(ms));

async function main() {
  const out = { device: (await shell('getprop', 'ro.product.model')).trim(), when: new Date().toISOString() };
  if (APK) out.apkMB = +(fs.statSync(APK).size / 1048576).toFixed(1);

  if (APK && !args['no-install']) {
    // Clean install: uninstall first. Builds from different branches are signed with
    // different keys, so `install -r` fails and silently leaves the OLD app in place.
    await shell('pm', 'uninstall', PKG).catch(() => {});
    await run(ADB, ['install', APK], { maxBuffer: 1 << 26 });
    const p = (await shell('pm', 'path', PKG)).trim().replace('package:', '');
    const onPhone = (await shell('md5sum', p)).trim().split(/\s+/)[0];
    const local = (await run('certutil', ['-hashfile', APK.replace(/\//g, '\\'), 'MD5']).then(r => r.stdout.split('\n')[1].replace(/\s/g, '')).catch(() => ''));
    out.install = { onPhone, local, match: !local || onPhone === local };
  }

  const started = Date.now();
  await shell('svc', 'power', 'stayon', 'usb').catch(() => {});
  out.coldStart = await coldStart();

  // Feed: the app opens here. Scroll it like a reader.
  out.feed = await screenJank('feed', async () => {
    await sleep(12000);
    for (let i = 0; i < 6; i++) { await swipe(360, 1100, 360, 400, 300); await sleep(1200); }
  });
  out.feedMem = await pss();

  // Globe + wall: tab 2 of the nav pill, then let the wall connect and scroll it.
  out.globe = await screenJank('globe+wall', async () => {
    await tap(243, 1378); await sleep(25000);
    for (let i = 0; i < 4; i++) { await swipe(360, 1200, 360, 600, 300); await sleep(1500); }
  });
  await sleep(20000);
  out.globeMem = await pss();

  // Off the wall: memory and WebView CPU must fall.
  await tap(125, 1378); await sleep(20000);
  out.offWallMem = await pss();
  const top = await shell('top', '-b', '-n', '1', '-H', '-p', (await shell('pidof', PKG)).trim()).catch(() => '');
  out.webviewCpuOffWall = [...top.matchAll(/(\d+[.\d]*)\s+\S+\s+\S+\s+\S+\s+(Chrome_InProc|CrRendererMain|sandboxed_proc)/g)].map(m => m[1]);

  out.anrsThisRun = await anrsSince(started);
  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { console.error('measure failed:', e.message); process.exit(1); });
