#!/usr/bin/env node
// Test the moves that are broken, not the one that works.
//
// The old driver tapped across all five tabs in order and then scrolled the void
// feed, over and over. But scrolling the void feed is the one thing reported as
// fine - so the harness was spending most of its time confirming that, and the
// same fixed pattern every round never touched the states things actually break
// in. It was a loop, not a test.
//
// This drives the four moves that are named as catastrophic, and drives each of
// them in several different ways, because "slow" and "slow the second time" and
// "slow when you interrupt it" are different bugs:
//
//   cold        first time this session - pays for whatever is built lazily
//   warm        again, after it has been built once
//   rapid       pressed again before the last one settled
//   returning   away and back, which is where re-entry bugs live
//   resumed     after the app has been backgrounded and brought back
//
// Every measurement is the time until the screen stops changing, which is what a
// person means by "how long did it take", and it counts empty-loader time that a
// first-frame measurement would wave through.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { text, shell, sleep, grab, fingerprint, changedFraction, navPoints, serial } from './lib/screen.mjs';
import { dumpUi, screenText } from './lib/ui.mjs';

const PKG = 'com.thevoid.app';
const ACT = `${PKG}/.MainActivity`;
const OUT = 'D:/void-phone';

const SETTLE_FRACTION = 0.06;
const POLL_MS = 110;
const CAP_MS = 20000;

// What each move has to come in under. These are the numbers a person stops
// noticing at, not numbers this build can currently reach.
const BUDGET_MS = 600;

const alive = () => shell('dumpsys activity activities').includes(PKG);

/** Wait until the screen stops changing. Returns ms, or the cap if it never does. */
function settle(from = Date.now()) {
  let prev = null;
  let quietSince = null;
  while (Date.now() - from < CAP_MS) {
    const fp = fingerprint(grab());
    if (prev) {
      if (changedFraction(prev, fp) < SETTLE_FRACTION) {
        if (quietSince == null) quietSince = Date.now();
        if (Date.now() - quietSince >= POLL_MS) return { ms: quietSince - from, fp };
      } else quietSince = null;
    }
    prev = fp;
    sleep(POLL_MS);
  }
  return { ms: CAP_MS, fp: prev, timedOut: true };
}

const tap = (p) => shell(`input tap ${p.x} ${p.y}`);
const swipeLeft = () => shell('input swipe 600 780 120 780 180');
const swipeRight = () => shell('input swipe 120 780 600 780 180');

/** Is the globe actually drawn, or is it an empty canvas? */
function globeDrawn() {
  const fp = fingerprint(grab(), 0.12, 0.16, 0.88, 0.58);
  const seen = new Set();
  let sum = 0;
  for (const v of fp) {
    seen.add(v >> 3);
    sum += v;
  }
  return { variety: seen.size, mean: sum / fp.length };
}

const results = [];
function record(move, variant, ms, extra = {}) {
  const row = { move, variant, ms, over: ms > BUDGET_MS, ...extra };
  results.push(row);
  const flag = row.crashed ? 'CRASHED' : row.timedOut ? 'NEVER SETTLED' : row.over ? 'SLOW' : 'ok';
  console.log(
    `  ${move.padEnd(16)} ${variant.padEnd(10)} ${String(ms + 'ms').padStart(8)}  ${flag}${
      extra.note ? '  ' + extra.note : ''
    }`,
  );
}

/** One transition, timed from the gesture to the screen settling. */
function move(name, variant, gesture, extra = () => ({})) {
  const t0 = Date.now();
  try {
    gesture();
  } catch (e) {
    record(name, variant, 0, { note: "device went away: " + String(e).split("\n")[0].slice(0, 60) });
    return { ms: 0, aborted: true };
  }
  const s = settle(t0);
  const more = extra();
  record(name, variant, s.ms, { timedOut: !!s.timedOut, crashed: !alive(), ...more });
  return s;
}

// A run that dies halfway has still learned something. Every move is wrapped so a
// dropped cable or a crashed app ends that one row, not the whole run, and the
// summary at the bottom is printed from whatever was collected.
function safely(fn, label) {
  try {
    return fn();
  } catch (e) {
    record(label, "aborted", 0, { note: String(e).split("\n")[0].slice(0, 80) });
    return null;
  }
}

function main() {
  const devices = text(['devices']).split(/\r?\n/).filter((l) => /\tdevice\b/.test(l));
  if (!devices.length) {
    console.error('no device on adb');
    process.exit(2);
  }
  console.log(`transitions on ${(serial || devices[0].split(/\s+/)[0])}  (budget ${BUDGET_MS}ms)\n`);

  shell(`am force-stop ${PKG}`);
  text(['shell', 'am', 'start', '-W', '-n', ACT]);
  sleep(9000);

  const ui = dumpUi();
  if (/JUMP INTO THE VOID|CLAIM A SIGNAL|IDENTITY ·/.test(screenText(ui))) {
    console.error('still on onboarding - run scripts/onboard.mjs first');
    process.exit(3);
  }

  const [voidTab, globeTab, searchTab] = navPoints();
  const home = () => {
    tap(voidTab);
    sleep(2200);
  };

  // ── void -> globe ─────────────────────────────────────────────────────
  home();
  move('void->globe', 'cold', () => tap(globeTab), () => {
    const g = globeDrawn();
    return { note: `globe variety ${g.variety} mean ${g.mean.toFixed(1)}`, globeBlank: g.variety < 8 };
  });
  home();
  move('void->globe', 'warm', () => tap(globeTab), () => {
    const g = globeDrawn();
    return { note: `globe variety ${g.variety}`, globeBlank: g.variety < 8 };
  });

  // Pressed again before it has settled: the case a fixed-cadence driver never hits.
  home();
  move('void->globe', 'rapid', () => {
    tap(globeTab);
    sleep(220);
    tap(voidTab);
    sleep(220);
    tap(globeTab);
  });

  // Away and back. Re-entry is where the globe has regressed before.
  move('void->globe', 'returning', () => {
    tap(voidTab);
    sleep(1500);
    tap(globeTab);
  }, () => {
    const g = globeDrawn();
    return { note: `globe variety ${g.variety}`, globeBlank: g.variety < 8 };
  });

  // After the app has been away entirely.
  shell('input keyevent KEYCODE_HOME');
  sleep(2500);
  move('void->globe', 'resumed', () => {
    shell(`am start -n ${ACT}`);
    sleep(2500);
    tap(globeTab);
  }, () => {
    const g = globeDrawn();
    return { note: `globe variety ${g.variety}`, globeBlank: g.variety < 8 };
  });

  // ── globe <-> reels ───────────────────────────────────────────────────
  tap(globeTab);
  sleep(2500);
  move('globe->reels', 'cold', swipeLeft);
  move('reels->globe', 'cold', swipeRight, () => {
    const g = globeDrawn();
    return { note: `globe variety ${g.variety}`, globeBlank: g.variety < 8 };
  });
  move('globe->reels', 'warm', swipeLeft);
  move('reels->globe', 'warm', swipeRight);

  // ── leaving the globe ─────────────────────────────────────────────────
  tap(globeTab);
  sleep(2000);
  move('globe->void', 'cold', () => tap(voidTab));
  tap(globeTab);
  sleep(2000);
  move('globe->search', 'cold', () => tap(searchTab));

  // ── search ────────────────────────────────────────────────────────────
  home();
  move('void->search', 'cold', () => tap(searchTab));
  home();
  move('void->search', 'warm', () => tap(searchTab));
  home();
  move('void->search', 'rapid', () => {
    tap(searchTab);
    sleep(200);
    tap(voidTab);
    sleep(200);
    tap(searchTab);
  });

  // ── the summary ───────────────────────────────────────────────────────
  const slow = results.filter((r) => r.over || r.timedOut || r.crashed || r.globeBlank);
  console.log('');
  const worst = [...results].sort((a, b) => b.ms - a.ms).slice(0, 3);
  console.log(`worst: ${worst.map((r) => `${r.move}/${r.variant} ${r.ms}ms`).join(', ')}`);
  const blank = results.filter((r) => r.globeBlank);
  if (blank.length) console.log(`globe drew nothing on: ${blank.map((r) => r.variant).join(', ')}`);
  console.log(`${results.length - slow.length}/${results.length} transitions within ${BUDGET_MS}ms`);

  try {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'transitions.json'), JSON.stringify({ at: new Date().toISOString(), budgetMs: BUDGET_MS, results }, null, 2));
  } catch {
    /* ignore */
  }
  process.exit(slow.length ? 1 : 0);
}

main();
