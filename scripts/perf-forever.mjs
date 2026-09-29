#!/usr/bin/env node
// The phone is never idle.
//
// Builds take half an hour. Waiting for one is half an hour of the device
// telling us nothing, and a single round is a single sample of a number that
// moves. So this runs rounds back to back, forever, and appends every one to a
// log. It is the thing that keeps going between builds.
//
// Usage:
//   node scripts/perf-forever.mjs              run until stopped
//   node scripts/perf-forever.mjs --smoke-every=4
//
// PAUSING: the installer needs the phone to itself. Create the file
// D:/void-phone/PAUSE and this finishes its round and waits; delete it and it
// carries on. That beats killing the process, which would lose the round in
// flight and leave the app force-stopped halfway through a measurement.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'D:/void-phone';
const LOG = join(OUT, 'perf-forever.log');
const JSONL = join(OUT, 'perf-forever.jsonl');
const PAUSE = join(OUT, 'PAUSE');

const arg = (n, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${n}=`));
  return m ? Number(m.split('=')[1]) : d;
};
const smokeEvery = arg('smoke-every', 4);

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

function run(script, args) {
  const r = spawnSync(process.execPath, [join('scripts', script), ...args], {
    encoding: 'utf8',
    cwd: 'D:/void-audit',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/** Pull the one line worth keeping out of a jank round. */
function summarise(out) {
  const line = out.split('\n').find((l) => /^round \d+/.test(l.trim()));
  return line ? line.trim() : out.trim().split('\n').slice(-2).join(' ');
}

function waitWhilePaused() {
  let said = false;
  while (existsSync(PAUSE)) {
    if (!said) {
      say('paused (D:/void-phone/PAUSE exists) - waiting for the installer');
      said = true;
    }
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},5000)']);
  }
  if (said) say('resumed');
}

let round = 0;
say(`perf-forever started, smoke every ${smokeEvery} rounds`);
// No exit condition on purpose: whoever started this decides when it is done.
for (;;) {
  waitWhilePaused();
  round++;

  const jank = run('jank-loop.mjs', ['--rounds=1', '--passes=2']);
  const summary = summarise(jank.out);
  say(`#${round} ${summary}`);

  let smoke = null;
  if (round % smokeEvery === 0) {
    waitWhilePaused();
    smoke = run('smoke-phone.mjs', []);
    const failed = smoke.out.split('\n').filter((l) => /FAIL/.test(l));
    const tally = smoke.out.split('\n').find((l) => /checks passed/.test(l));
    say(`#${round} smoke: ${tally ? tally.trim() : 'no result'}`);
    for (const f of failed) say(`      ${f.trim()}`);
  }

  try {
    appendFileSync(
      JSONL,
      JSON.stringify({
        at: new Date().toISOString(),
        round,
        jankExit: jank.code,
        summary,
        smokeExit: smoke ? smoke.code : null,
      }) + '\n',
    );
  } catch {
    /* ignore */
  }

  // A round where the device dropped off USB produces no data, not bad data.
  // Say so and keep going rather than filling the log with identical noise.
  if (jank.code === 2) {
    say('      device not reachable - waiting 60s before the next round');
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},60000)']);
  }
}
