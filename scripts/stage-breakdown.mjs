// WHICH PART OF THE FRAME IS LATE.
//
// jank-loop and device-watch report that a frame took 400ms. They do not say
// WHERE, and the three candidate fixes for the sparkle loaders repair three
// different places:
//
//   animation  - the drivers. 170 Animated.Views each interpolating two props.
//                A shared clock or one worklet fixes this and nothing else.
//   traversal  - measure/layout over a tree with 170 extra leaf nodes.
//                Fewer VIEWS fixes this; a shared clock does not.
//   draw       - recording display lists for 170 absolutely-positioned dots.
//                One canvas or one baked image fixes this.
//   gpu        - compositing 170 semi-transparent layers over six video
//                surfaces. Only removing the LAYERS fixes this.
//
// framestats carries a timestamp at every stage boundary, so the breakdown is
// already on the device. Guessing between the three would be a day of work on a
// 50/50 bet; this is a minute.
//
// Usage: node stage-breakdown.mjs [serial]
import { execFileSync } from 'node:child_process';

const ADB = 'D:/android-sdk/platform-tools/adb.exe';
const SERIAL = process.argv[2] || 'R5CYA0GF6FP';
const PKG = 'com.thevoid.app';
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
const sh = (c) => adb('shell', c);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// NEVER DRIVE A PHONE THAT IS SHOWING SOMETHING ELSE. Screenshots of this
// device have caught a banking app and a mail inbox before.
const fg = sh('dumpsys activity activities | grep -m1 mResumedActivity');
if (!fg.includes(PKG)) {
  console.log('The Void is not in the foreground - refusing to touch the phone.');
  console.log(fg.trim());
  process.exit(2);
}

const size = sh('wm size').match(/(\d+)x(\d+)/);
const W = +size[1], H = +size[2];

sh(`dumpsys gfxinfo ${PKG} reset`);

// A slow drag across the middle of the screen: the globe gesture if the globe
// is up, a scroll if the wall is. Either way it is the case the user reports.
const DRAGS = 6;
for (let i = 0; i < DRAGS; i++) {
  const y = Math.round(H * 0.45);
  const x1 = Math.round(W * (i % 2 ? 0.25 : 0.75));
  const x2 = Math.round(W * (i % 2 ? 0.75 : 0.25));
  sh(`input swipe ${x1} ${y} ${x2} ${y} 600`);
  await sleep(250);
}

const raw = sh(`dumpsys gfxinfo ${PKG} framestats`);

// The header names the columns, so this does not care which Android version
// added GpuCompleted or the dequeue/queue durations.
const head = raw.split('\n').find((l) => l.startsWith('Flags,'));
if (!head) { console.log('no framestats - is hardware rendering on?'); process.exit(1); }
const col = {};
head.trim().replace(/,$/, '').split(',').forEach((n, i) => (col[n] = i));

const rows = raw.split('\n')
  .filter((l) => /^\d/.test(l.trim()))
  .map((l) => l.trim().replace(/,$/, '').split(',').map(Number))
  .filter((r) => r[col.Flags] === 0); // flag != 0 means the frame is not comparable

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
console.log(`${rows.length} comparable frames, ${SERIAL}`);
console.log(`total   p50 ${pct(total, 0.5).toFixed(1)}ms  p90 ${pct(total, 0.9).toFixed(1)}ms  worst ${Math.max(...total).toFixed(1)}ms`);
console.log(`janky   ${((total.filter((t) => t > 16.7).length / total.length) * 100).toFixed(0)}% over 16.7ms`);
console.log('');

// Ranked, because the point of this is to pick ONE thing to fix.
const ranked = STAGES.map(([name, a, b]) => {
  const xs = rows.map((r) => ms(r, a, b)).filter((x) => Number.isFinite(x) && x >= 0);
  return { name, p50: pct(xs, 0.5), p90: pct(xs, 0.9), worst: Math.max(...xs) };
}).sort((x, y) => y.p90 - x.p90);

for (const s of ranked) {
  const bar = '#'.repeat(Math.min(40, Math.round(s.p90)));
  console.log(`${s.name.padEnd(10)} p50 ${s.p50.toFixed(1).padStart(6)}  p90 ${s.p90.toFixed(1).padStart(6)}  worst ${s.worst.toFixed(1).padStart(7)}  ${bar}`);
}
console.log('');
console.log(`worst stage at p90: ${ranked[0].name}`);
