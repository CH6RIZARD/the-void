#!/usr/bin/env node
// Did the speed work break the app?
//
// The perf loop patches, builds and installs unattended, which is only safe if
// something checks that the app still does what it is for. This is that check.
// It is deliberately about features, not frame times: every tab opens, the globe
// draws, the feed has content, nothing crashes or ANRs. A perf build that fails
// this is not a faster app, it is a broken one, and it must not stay on the phone.
//
// Usage:
//   node scripts/smoke-phone.mjs              check the installed build
//   node scripts/smoke-phone.mjs --keep-shots leave the screenshots on disk
//
// Exit 0 = every check passed. Exit 1 = a feature regressed. Exit 2 = could not test.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const PKG = 'com.thevoid.app';
const ACT = `${PKG}/.MainActivity`;
const OUT = 'D:/void-phone/smoke';

const adb = (() => {
  const g = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe') : null;
  return g && existsSync(g) ? g : 'adb';
})();
const sh = (args, opts = {}) => execFileSync(adb, args, { maxBuffer: 256 * 1024 * 1024, ...opts });
const text = (args) => sh(args, { encoding: 'utf8' });
const shell = (cmd) => text(['shell', cmd]);
const sleep = (ms) => execFileSync(process.execPath, ['-e', `setTimeout(()=>{},${ms})`], { stdio: 'ignore' });

// ─── READING THE SCREEN ──────────────────────────────────────────────────
// screencap -p gives a plain 8-bit PNG, non-interlaced, so a small reader here
// beats adding an image dependency to a repo that has none. We only ever ask it
// two things: how bright is this region, and how varied is it. "Varied" is what
// separates a screen that drew something from a screen that is one flat colour,
// which is exactly the failure mode a broken globe or an empty feed produces.
function decodePng(buf) {
  let p = 8; // skip signature
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const row = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prior = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prior ? prior[x] : 0;
      const c = prior && x >= channels ? prior[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, channels, data: out };
}

/** Mean brightness and how many distinct brightness buckets appear, over a region. */
function regionStats(img, x0f, y0f, x1f, y1f) {
  const { w, h, channels, data } = img;
  const x0 = Math.floor(w * x0f), x1 = Math.floor(w * x1f);
  const y0 = Math.floor(h * y0f), y1 = Math.floor(h * y1f);
  const buckets = new Set();
  let sum = 0, n = 0;
  // Every 4th pixel: this is a smoke test, not a photograph.
  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      const i = y * w * channels + x * channels;
      const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      sum += lum;
      n++;
      buckets.add(lum >> 3); // 32 buckets
    }
  }
  return { mean: n ? sum / n : 0, variety: buckets.size, samples: n };
}

function screenshot(name, keep) {
  const png = sh(['exec-out', 'screencap', '-p']);
  if (keep) {
    try {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${name}.png`), png);
    } catch {
      /* the check is the point; saving it is a convenience */
    }
  }
  return decodePng(png);
}

function navPoints() {
  const m = shell('wm size').match(/(\d+)x(\d+)/);
  const w = Number(m?.[1] || 720), h = Number(m?.[2] || 1560);
  const y = Math.round(h * 0.883);
  return Array.from({ length: 5 }, (_, i) => ({ x: Math.round(w * (0.175 + i * 0.1625)), y }));
}

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/** Is the app still the thing on screen? */
const alive = () => shell('dumpsys activity activities').includes(PKG);

// A dead app fails every check after it dies, and a screenshot of the launcher
// looks exactly like a screen that failed to draw. Once the process is gone the
// remaining checks are not measuring the app at all, so say so once and stop
// pretending the rest are findings.
let died = false;
function checkScreen(name, ok, detail) {
  if (died) {
    checks.push({ name, ok: false, detail: 'not reached - app had already crashed' });
    console.log(`  ----  ${name}  (not reached - app had already crashed)`);
    return;
  }
  if (!alive()) {
    died = true;
    check(`${name} - APP CRASHED, no longer in the foreground`, false, detail);
    return;
  }
  check(name, ok, detail);
}

function main() {
  const keep = process.argv.includes('--keep-shots');
  const devices = text(['devices']).split(/\r?\n/).filter((l) => /\tdevice\b/.test(l));
  if (!devices.length) {
    console.error('no device on adb - cannot smoke test');
    process.exit(2);
  }
  console.log(`smoke test on ${devices[0].split(/\s+/)[0]}\n`);

  sh(['logcat', '-c']);
  try {
    shell('dumpsys dropbox --clear');
  } catch {
    /* not every build of Android allows it; the timestamp filter below covers us */
  }
  const startedAt = Date.now();

  shell(`am force-stop ${PKG}`);
  const start = text(['shell', 'am', 'start', '-W', '-n', ACT]);
  check('app launches', /Status:\s*ok/i.test(start) || /TotalTime/.test(start), start.match(/TotalTime:\s*\d+/)?.[0]);
  sleep(9000);

  // Still the app in the foreground? A crash on launch shows up here first.
  const fg = shell('dumpsys activity activities');
  check('app is in the foreground', fg.includes(PKG), fg.match(/mResumedActivity[^\n]*/)?.[0]?.slice(0, 80));

  // Whatever is on screen - onboarding or the feed - it must have drawn something.
  const first = screenshot('01-launch', keep);
  const fs = regionStats(first, 0.05, 0.1, 0.95, 0.75);
  checkScreen('first screen drew content', fs.variety >= 6, `variety ${fs.variety}, mean ${fs.mean.toFixed(1)}`);

  // Each tab in turn. The nav is the same five points the jank loop uses.
  const points = navPoints();
  const tabNames = ['void', 'globe', 'search', 'messages', 'profile'];
  const shots = {};
  points.forEach((pt, i) => {
    shell(`input tap ${pt.x} ${pt.y}`);
    sleep(2600);
    const img = screenshot(`02-tab-${tabNames[i]}`, keep);
    shots[tabNames[i]] = img;
    const body = regionStats(img, 0.05, 0.12, 0.95, 0.8);
    checkScreen(`${tabNames[i]} tab opens and draws`, body.variety >= 5, `variety ${body.variety}`);
  });

  // The globe is the screen that has regressed most often, and its failure mode is
  // specific: a flat or empty canvas. A drawn globe is bright in the middle of the
  // canvas and varied; a dead one is near-uniform.
  const globe = shots.globe;
  if (globe) {
    const disc = regionStats(globe, 0.15, 0.2, 0.85, 0.55);
    checkScreen('globe canvas is not blank', disc.variety >= 8 && disc.mean > 6, `variety ${disc.variety}, mean ${disc.mean.toFixed(1)}`);
  }

  // Scrolling the feed must not empty it.
  shell(`input tap ${points[0].x} ${points[0].y}`);
  sleep(1800);
  for (let i = 0; i < 3; i++) {
    shell('input swipe 360 1100 360 420 250');
    sleep(700);
  }
  const scrolled = screenshot('03-feed-scrolled', keep);
  const ss = regionStats(scrolled, 0.05, 0.12, 0.95, 0.8);
  checkScreen('feed still has content after scrolling', ss.variety >= 6, `variety ${ss.variety}`);

  // Nothing fatal, and nothing that made the system give up on us.
  const crash = text(['logcat', '-b', 'crash', '-d']);
  check('no fatal signal', !/Fatal signal|FATAL EXCEPTION/.test(crash));
  const js = text(['logcat', '-d', '-s', 'ReactNativeJS:V']);
  check('no JS exception reported', !/Unhandled JS Exception|Invariant Violation/.test(js));
  let anr = '';
  try {
    anr = shell('dumpsys dropbox --print data_app_anr');
  } catch {
    /* ignore */
  }
  const recentAnr = anr.includes(PKG) && anr.split('\n').some((l) => {
    const t = Date.parse(l.slice(0, 19).replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T'));
    return Number.isFinite(t) && t >= startedAt;
  });
  check('no ANR during the run', !recentAnr);

  // The globe re-entry path: leave the tab and come back. This has broken before
  // in a way that a single visit does not catch.
  shell(`input tap ${points[1].x} ${points[1].y}`);
  sleep(2400);
  shell(`input tap ${points[0].x} ${points[0].y}`);
  sleep(1600);
  shell(`input tap ${points[1].x} ${points[1].y}`);
  sleep(3000);
  const again = screenshot('04-globe-reentry', keep);
  const ag = regionStats(again, 0.15, 0.2, 0.85, 0.55);
  checkScreen('globe still draws after leaving and returning', ag.variety >= 8 && ag.mean > 6, `variety ${ag.variety}, mean ${ag.mean.toFixed(1)}`);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) console.log(`regressed: ${failed.map((c) => c.name).join('; ')}`);
  try {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'smoke.json'), JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
  } catch {
    /* ignore */
  }
  process.exit(failed.length ? 1 : 0);
}

main();
