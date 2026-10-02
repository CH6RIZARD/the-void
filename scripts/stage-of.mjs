// WHICH PART OF THE FRAME IS LATE - FOR A NAMED SURFACE.
//
// stage-breakdown.mjs measures whatever is under the finger. This one goes to a
// surface first and performs that surface's own gesture, so the globe, the wall
// and reels each get their own number and the three can be compared.
//
//   node stage-of.mjs globe   - turn the globe (horizontal drags across its face)
//   node stage-of.mjs wall    - scroll the live wall under the globe
//   node stage-of.mjs reels   - toggle to REELS and page through six clips
//
// Refuses unless The Void is already the resumed activity. Prints the same
// ranked stage table as stage-breakdown.mjs and one JSON line for scripts.
import { execFileSync } from 'node:child_process';

const ADB = 'D:/android-sdk/platform-tools/adb.exe';
const SERIAL = process.env.ANDROID_SERIAL || 'R5CYA0GF6FP';
const PKG = 'com.thevoid.app';
const which = (process.argv[2] || 'globe').toLowerCase();
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
const sh = (c) => adb('shell', c);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fg = sh('dumpsys activity activities | grep -m1 mResumedActivity');
if (!fg.includes(PKG)) {
  console.log('The Void is not in the foreground - refusing to touch the phone.');
  process.exit(2);
}
const size = sh('wm size').match(/(\d+)x(\d+)/);
const W = +size[1], H = +size[2];
const X = (f) => Math.round(W * f), Y = (f) => Math.round(H * f);

// Layout on the 720x1560 clone, from screenshots: GLOBE/REELS toggle at y≈120
// (GLOBE x≈295, REELS x≈425); globe face centred ≈(360,400); the wall starts
// ≈y700; the nav pill sits ≈y1380.
const TOGGLE_Y = Y(120 / 1560);
const GLOBE_X = X(295 / 720), REELS_X = X(425 / 720);
const swipe = (x1, y1, x2, y2, ms) => sh(`input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`);
const tap = (x, y) => sh(`input tap ${x} ${y}`);

async function gesture() {
  if (which === 'globe') {
    for (let i = 0; i < 6; i++) {
      const y = Y(0.26);
      swipe(X(i % 2 ? 0.25 : 0.75), y, X(i % 2 ? 0.75 : 0.25), y, 600);
      await sleep(250);
    }
  } else if (which === 'wall') {
    for (let i = 0; i < 6; i++) {
      // down, down, down, then back up: both directions, and a scroll-back reconnect
      const down = i < 3;
      swipe(X(0.5), Y(down ? 0.8 : 0.5), X(0.5), Y(down ? 0.5 : 0.8), 450);
      await sleep(300);
    }
  } else if (which === 'reels') {
    tap(REELS_X, TOGGLE_Y);
    await sleep(1800); // let the first clip attach before the paging starts
    sh(`dumpsys gfxinfo ${PKG} reset`); // the toggle itself is not the subject
    for (let i = 0; i < 6; i++) {
      swipe(X(0.5), Y(0.78), X(0.5), Y(0.22), 220); // a quick flick, like a thumb
      await sleep(900); // "industry pace": the next clip should be up well inside this
    }
  } else {
    console.log('unknown surface: ' + which);
    process.exit(1);
  }
}

sh(`dumpsys gfxinfo ${PKG} reset`);
await gesture();
const raw = sh(`dumpsys gfxinfo ${PKG} framestats`);
if (which === 'reels') {
  tap(GLOBE_X, TOGGLE_Y); // leave the screen as it was found
}

const head = raw.split('\n').find((l) => l.startsWith('Flags,'));
if (!head) { console.log('no framestats'); process.exit(1); }
const col = {};
head.trim().replace(/,$/, '').split(',').forEach((n, i) => (col[n] = i));
const rows = raw.split('\n')
  .filter((l) => /^\d/.test(l.trim()))
  .map((l) => l.trim().replace(/,$/, '').split(',').map(Number))
  .filter((r) => r[col.Flags] === 0);
if (!rows.length) { console.log('no usable frames'); process.exit(1); }

const ms = (r, a, b) => (r[col[b]] - r[col[a]]) / 1e6;
const STAGES = [
  ['input', 'HandleInputStart', 'AnimationStart'],
  ['animation', 'AnimationStart', 'PerformTraversalsStart'],
  ['traversal', 'PerformTraversalsStart', 'DrawStart'],
  ['draw', 'DrawStart', 'SyncQueued'],
  ['sync', 'SyncStart', 'IssueDrawCommandsStart'],
  ['gpu', 'IssueDrawCommandsStart', 'SwapBuffers'],
];
const pct = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
const total = rows.map((r) => ms(r, 'IntendedVsync', 'FrameCompleted'));
const out = {
  surface: which,
  frames: rows.length,
  p50: +pct(total, 0.5).toFixed(1),
  p90: +pct(total, 0.9).toFixed(1),
  worst: +Math.max(...total).toFixed(1),
  jankPct: Math.round((total.filter((t) => t > 16.7).length / total.length) * 100),
  over10Pct: Math.round((total.filter((t) => t > 10).length / total.length) * 100),
  stages: {},
};
const ranked = STAGES.map(([name, a, b]) => {
  const xs = rows.map((r) => ms(r, a, b)).filter((x) => Number.isFinite(x) && x >= 0);
  return { name, p50: pct(xs, 0.5), p90: pct(xs, 0.9), worst: Math.max(...xs) };
}).sort((x, y) => y.p90 - x.p90);
for (const s of ranked) out.stages[s.name] = { p50: +s.p50.toFixed(1), p90: +s.p90.toFixed(1), worst: +s.worst.toFixed(1) };

console.log(`[${which}] ${rows.length} frames · total p50 ${out.p50}ms p90 ${out.p90}ms worst ${out.worst}ms · ${out.jankPct}% over 16.7ms · ${out.over10Pct}% over 10ms`);
for (const s of ranked) console.log(`  ${s.name.padEnd(10)} p50 ${s.p50.toFixed(1).padStart(6)}  p90 ${s.p90.toFixed(1).padStart(6)}  worst ${s.worst.toFixed(1).padStart(7)}  ${'#'.repeat(Math.min(40, Math.round(s.p90)))}`);
console.log(`  worst stage at p90: ${ranked[0].name}`);
console.log('JSON ' + JSON.stringify(out));
