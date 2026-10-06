#!/usr/bin/env node
// How long do the wall's streams actually keep running ON THE PHONE?
//
// Nothing is added to the app: it reads the device over adb. A tile is "moving" when
// its pixels change between two frames captured ~1.2s apart - the only honest signal
// from outside the app, since a stream can be "playing" on a frozen picture.
// Also samples the app's memory and the frame jank the user is feeling.
//
//   node scripts/soak-phone.mjs [--minutes=15] [--every=60] [--pkg=com.thevoid.app]
//
// Leave the phone on the globe tab with the wall visible.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const run = promisify(execFile);
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const PKG = args.pkg || 'com.thevoid.app';
const MINUTES = Number(args.minutes || 15);
const EVERY = Number(args.every || 60);
const ADB = args.adb || [
  process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
].find(p => p && fs.existsSync(p)) || 'adb';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sh = async (...a) => (await run(ADB, a, { maxBuffer: 1 << 28 })).stdout;

/** One raw screen grab: adb screencap with no -p gives w,h,format then RGBA rows. */
function grab() {
  return new Promise((res, rej) => {
    const p = spawn(ADB, ['exec-out', 'screencap'], { maxBuffer: 1 << 28 });
    const out = []; p.stdout.on('data', d => out.push(d));
    p.on('error', rej);
    p.on('close', () => {
      const b = Buffer.concat(out);
      if (b.length < 16) return rej(new Error('short screencap'));
      const w = b.readUInt32LE(0), h = b.readUInt32LE(4);
      // Android 11+ writes a 16-byte header (w,h,format,colorSpace); older is 12.
      const px = b.length - w * h * 4;
      if (px !== 12 && px !== 16) return rej(new Error(`unexpected screencap layout w=${w} h=${h} len=${b.length}`));
      res({ w, h, off: px, buf: b });
    });
  });
}
/** Mean absolute pixel difference over a rectangle, 0-255. */
function diffRect(a, b, x0, y0, x1, y1) {
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y += 3) {
    let ia = a.off + (y * a.w + x0) * 4, ib = b.off + (y * b.w + x0) * 4;
    for (let x = x0; x < x1; x += 3, ia += 12, ib += 12) {
      sum += Math.abs(a.buf[ia] - b.buf[ib]) + Math.abs(a.buf[ia + 1] - b.buf[ib + 1]) + Math.abs(a.buf[ia + 2] - b.buf[ib + 2]);
      n += 3;
    }
  }
  return n ? sum / n : 0;
}
/** The wall grid: 2 columns of 16:9 tiles under the globe, as laid out by LiveWall. */
function tiles(w, h, top) {
  const PAD = 20, GAP = 16, cols = 2;
  const tw = Math.floor((w - PAD * 2 - GAP) / cols), th = Math.round(tw * 9 / 16);
  const out = [];
  for (let row = 0; row * (th + GAP) + top < h - 60; row++) {
    for (let c = 0; c < cols; c++) {
      const x0 = PAD + c * (tw + GAP), y0 = top + row * (th + GAP);
      if (y0 + th > h - 60) break;
      out.push({ id: `r${row}c${c}`, x0, y0, x1: x0 + tw, y1: y0 + th });
    }
  }
  return out;
}

async function main() {
  const meminfo = async () => {
    const t = await sh('shell', 'dumpsys', 'meminfo', PKG).catch(() => '');
    const m = t.match(/TOTAL(?:\s+PSS)?:?\s+(\d+)/); return m ? Math.round(Number(m[1]) / 1024) : null;
  };
  const jank = async () => {
    const t = await sh('shell', 'dumpsys', 'gfxinfo', PKG).catch(() => '');
    const tot = Number((t.match(/Total frames rendered:\s*(\d+)/) || [])[1] || 0);
    const jn = Number((t.match(/Janky frames:\s*(\d+)/) || [])[1] || 0);
    await sh('shell', 'dumpsys', 'gfxinfo', PKG, 'reset').catch(() => {});
    return { frames: tot, jankyPct: tot ? Math.round((jn / tot) * 100) : null };
  };
  const first = await grab();
  // The wall starts under the globe; find it from the first frame by taking the
  // topmost row whose two tiles are not both flat black.
  const TOP = Number(args.top || 765);
  const rects = tiles(first.w, first.h, TOP);
  console.log(`[soak-phone] ${first.w}x${first.h}, ${rects.length} tile slots, every ${EVERY}s for ${MINUTES}m`);
  const seen = new Map();   // tile -> {movingSamples, lastMoving, firstMoving, stillRun}
  const timeline = [];
  const t0 = Date.now(), end = t0 + MINUTES * 60000;
  await sh('shell', 'dumpsys', 'gfxinfo', PKG, 'reset').catch(() => {});
  while (Date.now() < end) {
    const a = await grab(); await sleep(1200); const b = await grab();
    const now = Date.now();
    let moving = 0, still = 0;
    for (const r of rects) {
      const d = diffRect(a, b, r.x0, r.y0, r.x1, r.y1);
      const isMoving = d > 1.2;                       // measured: a live tile is 3-40, a frozen one <0.3
      const st = seen.get(r.id) || { movingSamples: 0, firstMoving: null, lastMoving: null, gaps: 0, wasMoving: false };
      if (isMoving) {
        moving++; st.movingSamples++; st.firstMoving ??= now; st.lastMoving = now;
        if (!st.wasMoving && st.movingSamples > 1) st.gaps++;
        st.wasMoving = true;
      } else { still++; st.wasMoving = false; }
      seen.set(r.id, st);
    }
    const [mem, jk] = [await meminfo(), await jank()];
    const row = { min: +((now - t0) / 60000).toFixed(1), moving, still, memMB: mem, ...jk };
    timeline.push(row);
    console.log(`[${row.min}m] moving ${moving}/${rects.length}  mem ${mem}MB  frames ${jk.frames}  janky ${jk.jankyPct}%`);
    await sleep(Math.max(0, EVERY * 1000 - (Date.now() - now)));
  }
  const per = [...seen.entries()].filter(([, s]) => s.firstMoving).map(([id, s]) => ({
    tile: id, runMin: +(((s.lastMoving - s.firstMoving) / 60000) + EVERY / 60).toFixed(1),
    movingSamples: s.movingSamples, gaps: s.gaps, endedStill: !s.wasMoving,
  })).sort((a, b) => b.runMin - a.runMin);
  const out = {
    minutes: MINUTES, sampleEvery: EVERY,
    tilesEverMoving: per.length,
    ranWholeSoak: per.filter(p => p.runMin >= MINUTES - EVERY / 60 && !p.endedStill).length,
    endedStill: per.filter(p => p.endedStill).length,
    memStartMB: timeline[0]?.memMB, memEndMB: timeline.at(-1)?.memMB,
    jankyPctMedian: (() => { const v = timeline.map(t => t.jankyPct).filter(x => x != null).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; })(),
    perTile: per, timeline,
  };
  const f = path.join(process.env.TEMP || '.', 'void-soak-phone.json');
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
  const { perTile, timeline: _t, ...head } = out;
  console.log(JSON.stringify(head, null, 2));
  console.log('per tile:', JSON.stringify(perTile));
  console.log('full report:', f);
}
main().catch(e => { console.error('soak-phone failed:', e.message); process.exit(1); });
