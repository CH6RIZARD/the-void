#!/usr/bin/env node
// The four moves that are actually complained about, timed to when the screen
// stops moving rather than to when the tap lands.
//
//   void  -> globe    entering the globe tab
//   globe            the live streams on the globe wall arriving
//   void  -> search   search loading and rendering
//   globe -> reels    the globe/reels swap
//
// "Settled" here means: the screen has stopped changing. Each transition is
// polled by screenshot, and the clock stops when consecutive frames stop
// differing. That is what a person means by "how long it took", and it counts
// the empty-loader time that a first-frame measurement would let through.
//
// Streams are the exception and get their own rule: a wall of playing video
// NEVER settles, so the wall is judged the opposite way - the time until the
// screen starts changing a lot, which is video arriving. A wall that settles
// is a wall of frozen tiles, and that is reported as a failure, not a pass.
//
// Usage:
//   node scripts/journey.mjs             one pass
//   node scripts/journey.mjs --passes=3  three, with the spread reported
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { text, shell, sleep, grab, fingerprint, diff, changedFraction, variety, navPoints } from './lib/screen.mjs';

const PKG = 'com.thevoid.app';
const ACT = `${PKG}/.MainActivity`;
const OUT = 'D:/void-phone';

// What each move has to come in under to count as fast. These are the numbers a
// person stops noticing at, not numbers this build can currently reach.
const BUDGET = {
  'void->globe': 400,
  'globe streams appear': 2500,
  'void->search': 400,
  'globe->reels': 400,
};

// Settled means: almost none of the screen changed between two polls. Measured as
// a fraction of cells rather than an average, so one spinner turning on a finished
// screen does not read as a screen still loading. See changedFraction().
const SETTLE_FRACTION = 0.06;
const MOVING_FRACTION = 0.2;
const POLL_MS = 120;
const CAP_MS = 12000;

const alive = () => shell('dumpsys activity activities').includes(PKG);

/**
 * Tap, then watch until the screen stops changing.
 * Returns ms from the tap to the first of two consecutive quiet frames.
 */
function settleAfter(tap) {
  const t0 = Date.now();
  shell(`input tap ${tap.x} ${tap.y}`);
  let prev = null;
  let quietSince = null;
  let lastChange = t0;
  while (Date.now() - t0 < CAP_MS) {
    const fp = fingerprint(grab());
    const now = Date.now();
    if (prev) {
      const d = changedFraction(prev, fp);
      if (d < SETTLE_FRACTION) {
        if (quietSince == null) quietSince = now;
        // Two quiet polls in a row is a settled screen, not a pause mid-animation.
        if (now - quietSince >= POLL_MS) return { ms: quietSince - t0, fp, lastChange: lastChange - t0 };
      } else {
        quietSince = null;
        lastChange = now;
      }
    }
    prev = fp;
    sleep(POLL_MS);
  }
  return { ms: CAP_MS, fp: prev, lastChange: lastChange - t0, timedOut: true };
}

/**
 * Tap, then watch until the screen starts moving a lot and keeps moving.
 * This is how you time video arriving: it never settles, it comes alive.
 */
function motionAfter(tap, need = 3) {
  const t0 = Date.now();
  if (tap) shell(`input tap ${tap.x} ${tap.y}`);
  let prev = null;
  let moving = 0;
  let firstMotion = null;
  while (Date.now() - t0 < CAP_MS) {
    const fp = fingerprint(grab());
    if (prev) {
      const d = changedFraction(prev, fp);
      if (d > MOVING_FRACTION) {
        moving++;
        if (firstMotion == null) firstMotion = Date.now();
        if (moving >= need) return { ms: firstMotion - t0, fp, moving };
      } else {
        moving = 0;
        firstMotion = null;
      }
    }
    prev = fp;
    sleep(POLL_MS);
  }
  return { ms: CAP_MS, fp: prev, moving, timedOut: true };
}

function onePass(points) {
  const [voidTab, globeTab, searchTab] = points;
  const r = {};

  // Start from a known place every time, or the numbers measure the previous move.
  shell(`input tap ${voidTab.x} ${voidTab.y}`);
  sleep(2200);

  const toGlobe = settleAfter(globeTab);
  r['void->globe'] = { ms: toGlobe.ms, timedOut: !!toGlobe.timedOut, variety: variety(toGlobe.fp || []) };

  // Already on the globe: no tap, just wait for the wall to come alive.
  const streams = motionAfter(null);
  r['globe streams appear'] = { ms: streams.ms, timedOut: !!streams.timedOut, moving: streams.moving };

  shell(`input tap ${voidTab.x} ${voidTab.y}`);
  sleep(2000);
  const toSearch = settleAfter(searchTab);
  r['void->search'] = { ms: toSearch.ms, timedOut: !!toSearch.timedOut, variety: variety(toSearch.fp || []) };

  // Globe -> reels is a swap inside the globe tab, not a tab tap: the toggle sits
  // in the upper area of the globe screen. Enter the globe, then swipe across,
  // which is the gesture the screen is built around.
  shell(`input tap ${globeTab.x} ${globeTab.y}`);
  sleep(2400);
  const t0 = Date.now();
  shell('input swipe 600 780 120 780 180');
  let prev = null, quietSince = null;
  while (Date.now() - t0 < CAP_MS) {
    const fp = fingerprint(grab());
    if (prev && changedFraction(prev, fp) < SETTLE_FRACTION) {
      if (quietSince == null) quietSince = Date.now();
      if (Date.now() - quietSince >= POLL_MS) break;
    } else quietSince = null;
    prev = fp;
    sleep(POLL_MS);
  }
  r['globe->reels'] = { ms: (quietSince || Date.now()) - t0, timedOut: quietSince == null };

  r.crashed = !alive();
  return r;
}

function main() {
  const passesArg = process.argv.find((a) => a.startsWith('--passes='));
  const passes = passesArg ? Number(passesArg.split('=')[1]) : 1;

  const devices = text(['devices']).split(/\r?\n/).filter((l) => /\tdevice\b/.test(l));
  if (!devices.length) {
    console.error('no device on adb');
    process.exit(2);
  }
  console.log(`journey on ${devices[0].split(/\s+/)[0]}\n`);

  shell(`am force-stop ${PKG}`);
  text(['shell', 'am', 'start', '-W', '-n', ACT]);
  sleep(9000);

  const points = navPoints();
  const runs = [];
  for (let i = 0; i < passes; i++) {
    const r = onePass(points);
    runs.push(r);
    if (r.crashed) {
      console.log(`pass ${i + 1}: APP CRASHED mid-journey`);
      break;
    }
  }

  const keys = Object.keys(BUDGET);
  let failed = 0;
  console.log('move                      median   budget   verdict');
  for (const k of keys) {
    const vals = runs.map((r) => r[k]?.ms).filter((v) => typeof v === 'number').sort((a, b) => a - b);
    if (!vals.length) continue;
    const med = vals[Math.floor(vals.length / 2)];
    const budget = BUDGET[k];
    // A wall that never came alive is a wall with no video on it.
    const stuck = k === 'globe streams appear' && runs.some((r) => r[k]?.timedOut);
    const ok = med <= budget && !stuck;
    if (!ok) failed++;
    console.log(
      `${k.padEnd(24)}  ${String(med + 'ms').padStart(7)}  ${String(budget + 'ms').padStart(7)}  ${ok ? 'ok' : stuck ? 'NO STREAMS' : 'SLOW'}${vals.length > 1 ? `   (${vals.join(', ')})` : ''}`,
    );
  }
  if (runs.some((r) => r.crashed)) {
    console.log('\nthe app crashed during the journey');
    failed++;
  }

  try {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'journey.json'), JSON.stringify({ at: new Date().toISOString(), budget: BUDGET, runs }, null, 2));
  } catch {
    /* ignore */
  }
  console.log(`\n${keys.length - failed}/${keys.length} moves within budget`);
  process.exit(failed ? 1 : 0);
}

main();
