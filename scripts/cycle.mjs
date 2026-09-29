#!/usr/bin/env node
// The actual cycle: newest build -> clean install -> measure -> repeat.
//
// perf-forever ran the tests over and over against whatever happened to be on the
// phone, which for most of one morning was a binary from hours earlier. It
// faithfully reported "still slow" about code that had already been changed four
// times. Measuring was never the bottleneck; getting the new build onto the phone
// was, and nothing was doing that.
//
// So this owns the whole loop. Every pass:
//   1. ask GitHub for the newest SUCCESSFUL preview build of the branch
//   2. if it is not the one installed, download it, uninstall, install clean,
//      and verify the md5 against the local file
//   3. get past onboarding, which a clean install always starts on
//   4. smoke (features), journey (the four moves), jank (frames and stalls)
//   5. write the numbers against the commit they belong to, and say plainly
//      whether they moved
//
// Measurements are keyed to a commit. A pass that finds no new build says so and
// waits rather than filling the log with another identical row.
//
//   node scripts/cycle.mjs                  run until stopped
//   node scripts/cycle.mjs --once           a single pass
//   node scripts/cycle.mjs --branch=<name>
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG = 'com.thevoid.app';
const ACT = `${PKG}/.MainActivity`;
const REPO = 'c:/the void/the-void';
const WORK = 'D:/void-audit';
const BUILDS = 'D:/void-build';
const OUT = 'D:/void-phone';
const LOG = join(OUT, 'cycle.log');
const JSONL = join(OUT, 'cycle.jsonl');
const STATE = join(OUT, 'cycle-state.json');

const arg = (n, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${n}=`));
  return m ? m.split('=').slice(1).join('=') : d;
};
const BRANCH = arg('branch', 'fix/tab-switch');
// Resolved once: spawning without a shell means the name has to be findable.
const GH = process.platform === 'win32' ? 'gh.exe' : 'gh';
const ONCE = process.argv.includes('--once');

const adb = (() => {
  const g = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe') : null;
  return g && existsSync(g) ? g : 'adb';
})();
const sh = (args, opts = {}) => execFileSync(adb, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
const shell = (cmd) => sh(['shell', cmd]);
const sleep = (ms) => spawnSync(process.execPath, ['-e', `setTimeout(()=>{},${ms})`]);

function say(line) {
  const stamped = `${new Date().toISOString().slice(11, 19)}  ${line}`;
  console.log(stamped);
  try {
    mkdirSync(OUT, { recursive: true });
    appendFileSync(LOG, stamped + '\n');
  } catch {
    /* the log is a convenience; the run is the point */
  }
}

function gh(args) {
  // shell:true is what broke the JSON query: Windows re-parses the arguments and
  // strips quoting out of anything with backslashes in it. Spawned directly, the
  // arguments arrive exactly as written.
  const r = spawnSync(GH, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function node(script, args = []) {
  const r = spawnSync(process.execPath, [join('scripts', script), ...args], {
    cwd: WORK,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const md5Local = (p) => {
  const r = spawnSync(process.execPath, ['-e', `const c=require('crypto'),f=require('fs');process.stdout.write(c.createHash('md5').update(f.readFileSync(process.argv[1])).digest('hex'))`, p], { encoding: 'utf8' });
  return (r.stdout || '').trim();
};

function installedMd5() {
  try {
    const path = shell(`pm path ${PKG}`).trim().replace(/\r/g, '').replace('package:', '');
    if (!path) return null;
    return shell(`md5sum ${path}`).trim().split(/\s+/)[0];
  } catch {
    return null;
  }
}

// NO JQ. The first version passed gh a -q expression full of quotes and
// backslashes through a Windows shell, which ate them: gh then returned nothing
// and this reported "no successful build" fifty-two times in a row while three
// builds sat there finished. Ask for plain JSON and pick it apart here, where
// nothing can rewrite the string on the way.
/** The newest run of the build workflow that finished successfully on this branch. */
function newestBuild() {
  const r = gh([
    'run', 'list',
    '--workflow=android-aab.yml',
    '--branch', BRANCH,
    '-L', '15',
    '--json', 'databaseId,status,conclusion,headSha,createdAt',
  ]);
  if (r.code !== 0 || !r.out) {
    say('      gh run list failed: ' + (r.err.split('\n')[0] || 'exit ' + r.code));
    return null;
  }
  let runs;
  try {
    runs = JSON.parse(r.out);
  } catch {
    say('      could not parse gh output');
    return null;
  }
  const ok = runs.filter((x) => x.conclusion === 'success' && x.headSha);
  if (!ok.length) return null;
  ok.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const top = ok[0];
  return { id: String(top.databaseId), sha: top.headSha, at: top.createdAt };
}

/**
 * Download and clean-install. Returns the md5 actually on the phone, or null.
 * The uninstall is not optional: `install -r` over a build signed with a
 * different key silently leaves the old one in place, which has produced a
 * whole session of measurements of the wrong binary before now.
 */
function install(build) {
  const dir = join(BUILDS, `r${build.sha.slice(0, 7)}`);
  let apk = null;
  if (existsSync(dir)) apk = findApk(dir);
  if (!apk) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    const d = gh(['run', 'download', build.id, '-D', dir]);
    if (d.code !== 0) {
      say(`      download failed: ${d.err.split('\n')[0] || d.code}`);
      return null;
    }
    apk = findApk(dir);
  }
  if (!apk) {
    // A run built with the default profile emits an .aab, which cannot be
    // installed. Worth naming, because it looks like a successful build.
    say('      that build has no APK in it (built without profile=preview?)');
    return null;
  }
  try {
    sh(['uninstall', PKG]);
  } catch {
    /* not installed yet is fine */
  }
  const r = spawnSync(adb, ['install', '-r', apk], { encoding: 'utf8' });
  if (!/Success/.test(r.stdout || '')) {
    say(`      install failed: ${((r.stdout || '') + (r.stderr || '')).split('\n').filter(Boolean).pop()}`);
    return null;
  }
  const want = md5Local(apk);
  const got = installedMd5();
  if (want !== got) {
    say(`      md5 mismatch after install: local ${want}, phone ${got}`);
    return null;
  }
  return got;
}

function findApk(dir) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try {
      entries = require('node:fs').readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith('.apk')) return p;
    }
  }
  return null;
}

// ─── ONBOARDING ──────────────────────────────────────────────────────────
// A clean install always lands on the Jump In flow, and Android restores app
// data on reinstall, so this is the one state the harness cannot assume away.
// Every measurement taken on a pass that had just reinstalled was really a
// measurement of the sign-in card, reported as the globe tab.
//
// onboard.mjs drives it from the view tree, tapping only nodes it can actually
// see and only inside our own package. An earlier attempt tapped guessed
// coordinates and landed in a different app on the phone, which is why that
// rule exists. Anonymous throughout: no account, nothing typed.
function pastOnboarding() {
  const r = node('onboard.mjs', []);
  if (r.code === 0) return true;
  const why = r.out.trim().split(/\n/).pop();
  say('      onboarding: ' + (why || 'exit ' + r.code));
  return false;
}

function summarise(out, re) {
  return out.split('\n').map((l) => l.trim()).filter((l) => re.test(l));
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return {};
  }
}
function saveState(s) {
  try {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(STATE, JSON.stringify(s, null, 2));
  } catch {
    /* ignore */
  }
}

function pass(n) {
  const state = loadState();
  const build = newestBuild();
  if (!build) {
    say(`#${n} no successful build on ${BRANCH} yet`);
    return { waited: true };
  }

  const have = installedMd5();
  let md5 = have;
  if (state.sha !== build.sha || !have || state.md5 !== have) {
    say(`#${n} installing ${build.sha.slice(0, 7)} (run ${build.id})`);
    md5 = install(build);
    if (!md5) return { waited: true };
    say(`      installed, md5 ${md5.slice(0, 12)}`);
    saveState({ sha: build.sha, md5, id: build.id });
  } else {
    say(`#${n} ${build.sha.slice(0, 7)} already on the phone - measuring it again`);
  }

  shell(`am force-stop ${PKG}`);
  sh(['shell', 'am', 'start', '-W', '-n', ACT]);
  sleep(9000);
  if (!pastOnboarding()) {
    say('      could not get past onboarding - the numbers below would be of the sign-in card, so skipping');
    return { waited: true };
  }

  const smoke = node('smoke-phone.mjs', []);
  const smokeTally = summarise(smoke.out, /checks passed/)[0] || 'no result';
  say(`      smoke: ${smokeTally}`);
  for (const l of summarise(smoke.out, /FAIL/)) say(`        ${l}`);

  const jr = node('journey.mjs', []);
  for (const l of summarise(jr.out, /SLOW|NO STREAMS|CRASHED|\bok\b/)) if (!/^move /.test(l)) say(`        ${l}`);

  const jank = node('jank-loop.mjs', ['--rounds=1', '--passes=1']);
  const jankLine = summarise(jank.out, /^round \d+/)[0] || '';
  say(`      jank: ${jankLine}`);

  try {
    appendFileSync(
      JSONL,
      JSON.stringify({
        at: new Date().toISOString(),
        pass: n,
        sha: build.sha,
        runId: build.id,
        md5,
        smoke: smokeTally,
        smokeExit: smoke.code,
        journey: summarise(jr.out, /SLOW|NO STREAMS|\bok\b/),
        journeyExit: jr.code,
        jank: jankLine,
        jankExit: jank.code,
      }) + '\n',
    );
  } catch {
    /* ignore */
  }
  return { sha: build.sha, ok: smoke.code === 0 && jr.code === 0 && jank.code === 0 };
}

function main() {
  const devices = sh(['devices']).split(/\r?\n/).filter((l) => /\tdevice\b/.test(l));
  if (!devices.length) {
    console.error('no device on adb');
    process.exit(2);
  }
  say(`cycle started on ${devices[0].split(/\s+/)[0]}, branch ${BRANCH}`);
  for (let n = 1; ; n++) {
    let r;
    try {
      r = pass(n);
    } catch (e) {
      say(`#${n} pass threw: ${String(e).split('\n')[0]}`);
      r = { waited: true };
    }
    if (r.ok) {
      say('every budget met - stopping');
      return;
    }
    if (ONCE) return;
    // Nothing new to install means waiting for a build, not hammering the phone.
    if (r.waited) sleep(120000);
  }
}

main();
