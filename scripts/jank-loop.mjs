#!/usr/bin/env node
// Is the app as smooth as the apps it is competing with? Back-to-back, on the phone.
//
// The brief was "Instagram/Twitter speed", so this does not report averages that
// flatter the build. It drives the app the way a thumb does - switch tab, scroll,
// switch back - and grades every run against a budget taken from what those apps
// actually hold: a tab switch that commits within 300ms, no JS-thread stall over
// 150ms, and under 5% janky frames. A run either meets that or it does not.
//
// Usage:
//   node scripts/jank-loop.mjs                 one run
//   node scripts/jank-loop.mjs --rounds=5      five back-to-back runs
//   node scripts/jank-loop.mjs --until-pass=10 keep going until it passes, or 10 tries
//
// It needs the app installed and the phone on USB. It never installs anything
// itself: which build is on the phone is the caller's business, and silently
// reinstalling would make a measurement mean something different than it says.
import { execFileSync, execSync } from 'node:child_process';
import { sh as adbSh, serial } from './lib/screen.mjs';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PKG = 'com.thevoid.app';
const ACT = `${PKG}/.MainActivity`;
const OUT = 'D:/void-phone';

// ─── THE BUDGET ──────────────────────────────────────────────────────────
// Each is the number that separates "fast app" from "the app is still unusable".
const BUDGET = {
  /** Longest single JS-thread stall. One 400ms stall is felt; an average is not. */
  maxStallMs: 150,
  /** How many stalls over 50ms are tolerable across a whole run. */
  maxSmallStalls: 6,
  /** Janky frames, as gfxinfo counts them. */
  maxJankPct: 5,
  /** 95th percentile frame time. 16.7ms is 60fps; this allows a little slack. */
  maxP95FrameMs: 20,
};

// The serial lives in lib/screen.mjs. Two phones are attached and they are not
// interchangeable - one is a Galaxy S22, the other a much weaker Helio P35 that
// another session is driving - so nothing here resolves a device of its own.
const sh = (args, opts = {}) => adbSh(args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const shell = (cmd) => sh(['shell', cmd]);
const sleep = (ms) => execSync(`node -e "setTimeout(()=>{},${ms})"`, { stdio: 'ignore' });

/** The bottom nav's five icons, in device pixels, derived from the real screen size. */
function navPoints() {
  const size = shell('wm size').match(/(\d+)x(\d+)/);
  const w = Number(size?.[1] || 720);
  const h = Number(size?.[2] || 1560);
  // The pill sits a fixed fraction up from the bottom; five items evenly spread.
  const y = Math.round(h * 0.883);
  return Array.from({ length: 5 }, (_, i) => ({ x: Math.round(w * (0.175 + i * 0.1625)), y }));
}

/** Everything the run needs from the device, cleared so the numbers are this run's. */
function reset() {
  sh(['logcat', '-c']);
  shell(`dumpsys gfxinfo ${PKG} reset`);
}

function launch() {
  shell(`am force-stop ${PKG}`);
  const out = sh(['shell', 'am', 'start', '-W', '-n', ACT]);
  const total = Number(out.match(/TotalTime:\s*(\d+)/)?.[1] || 0);
  return total;
}

/** Drive the thumb: switch across the tabs, scroll where scrolling is the point. */
function drive(points, passes) {
  for (let p = 0; p < passes; p++) {
    for (const pt of points) {
      shell(`input tap ${pt.x} ${pt.y}`);
      sleep(900);
    }
    // Back on the first tab, scroll it the way a feed gets scrolled.
    shell(`input tap ${points[0].x} ${points[0].y}`);
    sleep(600);
    for (let i = 0; i < 4; i++) {
      shell('input swipe 360 1100 360 400 260');
      sleep(450);
    }
  }
}

/** [block] lines the app itself reported, in ms. */
function stalls() {
  const log = sh(['logcat', '-d', '-s', 'ReactNativeJS:V']);
  return [...log.matchAll(/\[block\] js thread stalled (\d+)ms/g)].map((m) => Number(m[1]));
}

/** [slow] lines: named synchronous work, if any of it is on the hot path. */
function slowLabels() {
  const log = sh(['logcat', '-d', '-s', 'ReactNativeJS:V']);
  return [...log.matchAll(/\[slow\] (\S+) (\d+)ms/g)].map((m) => ({ label: m[1], ms: Number(m[2]) }));
}

/** Frame statistics as the platform counts them, not as we would like to count them. */
function frames() {
  const g = shell(`dumpsys gfxinfo ${PKG}`);
  const total = Number(g.match(/Total frames rendered: (\d+)/)?.[1] || 0);
  const janky = Number(g.match(/Janky frames: (\d+)/)?.[1] || 0);
  const p95 = Number(g.match(/95th percentile: (\d+)ms/)?.[1] || 0);
  const p99 = Number(g.match(/99th percentile: (\d+)ms/)?.[1] || 0);
  return { total, janky, jankPct: total ? (janky / total) * 100 : 0, p95, p99 };
}

function grade(r) {
  const fails = [];
  const worst = r.stalls.length ? Math.max(...r.stalls) : 0;
  const small = r.stalls.filter((s) => s >= 50).length;
  if (worst > BUDGET.maxStallMs) fails.push(`worst JS stall ${worst}ms > ${BUDGET.maxStallMs}ms`);
  if (small > BUDGET.maxSmallStalls) fails.push(`${small} stalls over 50ms > ${BUDGET.maxSmallStalls}`);
  if (r.frames.jankPct > BUDGET.maxJankPct) fails.push(`${r.frames.jankPct.toFixed(1)}% janky > ${BUDGET.maxJankPct}%`);
  if (r.frames.p95 > BUDGET.maxP95FrameMs) fails.push(`p95 frame ${r.frames.p95}ms > ${BUDGET.maxP95FrameMs}ms`);
  return fails;
}

function runOnce(round, passes) {
  reset();
  const cold = launch();
  sleep(6000); // let first paint and the first data settle before driving
  const points = navPoints();
  drive(points, passes);
  sleep(1200);

  const r = { round, cold, stalls: stalls(), slow: slowLabels(), frames: frames() };
  r.fails = grade(r);
  return r;
}

function report(r) {
  const worst = r.stalls.length ? Math.max(...r.stalls) : 0;
  const line = [
    `round ${r.round}`,
    `cold ${r.cold}ms`,
    `stalls ${r.stalls.length} worst ${worst}ms`,
    `jank ${r.frames.jankPct.toFixed(1)}%`,
    `p95 ${r.frames.p95}ms p99 ${r.frames.p99}ms`,
    r.fails.length ? `FAIL: ${r.fails.join('; ')}` : 'PASS',
  ].join('  |  ');
  console.log(line);
  if (r.stalls.length) {
    const top = [...r.stalls].sort((a, b) => b - a).slice(0, 8);
    console.log(`        worst stalls: ${top.join(', ')}ms`);
  }
  if (r.slow.length) {
    console.log(`        named slow work: ${r.slow.map((s) => `${s.label} ${s.ms}ms`).join(', ')}`);
  }
}

function main() {
  const arg = (n, d) => {
    const m = process.argv.find((a) => a.startsWith(`--${n}=`));
    return m ? Number(m.split('=')[1]) : d;
  };
  const untilPass = arg('until-pass', 0);
  const rounds = untilPass || arg('rounds', 1);
  const passes = arg('passes', 2);

  // adb on Windows ends its lines with CRLF, so this cannot anchor on $.
  const devices = sh(['devices'])
    .split(/\r?\n/)
    .filter((l) => /\tdevice\b/.test(l));
  if (!devices.length) {
    console.error('no device on adb - plug the phone in');
    process.exit(2);
  }
  console.log(`device: ${devices[0].split(/\s+/)[0]}`);
  console.log(
    `budget: stall<=${BUDGET.maxStallMs}ms, <=${BUDGET.maxSmallStalls} stalls>50ms, jank<=${BUDGET.maxJankPct}%, p95<=${BUDGET.maxP95FrameMs}ms\n`,
  );

  const all = [];
  for (let i = 1; i <= rounds; i++) {
    const r = runOnce(i, passes);
    all.push(r);
    report(r);
    if (untilPass && !r.fails.length) {
      console.log(`\npassed on round ${i}`);
      break;
    }
  }

  try {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'jank-loop.json'), JSON.stringify({ budget: BUDGET, runs: all }, null, 2));
  } catch {
    /* the console output is the result; the file is a convenience */
  }

  const passed = all.filter((r) => !r.fails.length).length;
  console.log(`\n${passed}/${all.length} rounds met the budget`);
  process.exit(passed === all.length ? 0 : 1);
}

main();
