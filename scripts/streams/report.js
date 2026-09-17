#!/usr/bin/env node
/**
 * report.js — what the stream pool actually covers, and what it costs to ship.
 *
 * Two questions this answers, which the builders do not:
 *
 *   1. COVERAGE. Not "how many streams" but how many NATIONS sit at each depth.
 *      A pool of 3,000 that leaves 40 nations empty is worse than it sounds, and
 *      a total alone hides that completely.
 *
 *   2. WEIGHT. inject-iptv.js bakes the pool into void2-final.html as a string,
 *      shipped to every user on every load whether or not they open a stream.
 *      At 508 streams that block was ~66KB of an 800KB file. The pool is now
 *      much larger, so this prints what baking it would cost and what capping
 *      per nation would save — the input to deciding what to bake vs serve.
 *
 *   node scripts/streams/report.js
 *   node scripts/streams/report.js --pool scripts/iptv-sources.generated.json
 *   node scripts/streams/report.js --want 30        # target per nation
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const POOL = path.resolve(ROOT, arg('pool', 'scripts/iptv-sources.generated.json'));
const LIFE = path.resolve(ROOT, arg('life', 'scripts/life-sources.generated.json'));
const WANT = parseInt(arg('want', '30'), 10);

const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

const nationsFile = path.join(__dirname, 'nations.generated.json');
const nations = read(nationsFile);
if (!nations) { console.error('run build-nations.js first — no nations.generated.json'); process.exit(1); }
const allNames = Object.values(nations.nations).map(n => n.name);

const pool = read(POOL);
const sources = pool && pool.sources ? pool.sources : {};
const life = read(LIFE) || {};

const liveCount = n => (sources[n] || []).length;
// Only live cams count as live from the LIFE pool; walking tours are recorded.
const lifeLive = n => (life[n] || []).filter(e => e && e.kind === 'livecam').length;
const total = n => liveCount(n) + lifeLive(n);

const rows = allNames.map(n => ({ n, tv: liveCount(n), cam: lifeLive(n), all: total(n) }))
  .sort((a, b) => a.all - b.all || a.n.localeCompare(b.n));

const sum = rows.reduce((a, r) => a + r.all, 0);
const at = v => rows.filter(r => r.all >= v).length;
const empty = rows.filter(r => !r.all);

console.log('POOL       :', path.relative(ROOT, POOL));
console.log('nations    :', allNames.length, '(from the C array via build-nations.js)');
console.log('live streams:', sum, ` (${sum - rows.reduce((a, r) => a + r.cam, 0)} broadcast + ${rows.reduce((a, r) => a + r.cam, 0)} live cams)`);
console.log('');
console.log('COVERAGE');
for (const v of [40, WANT, 20, 10, 5, 1]) {
  const c = at(v);
  console.log(`  >= ${String(v).padStart(2)} streams : ${String(c).padStart(3)} nations  ${'#'.repeat(Math.round(c / allNames.length * 40))}`);
}
console.log(`  ZERO          : ${String(empty.length).padStart(3)} nations`);
console.log('');
console.log(`SHORT OF ${WANT} (thinnest 40)`);
const short = rows.filter(r => r.all < WANT);
console.log('  ' + (short.slice(0, 40).map(r => `${r.n}:${r.all}`).join('  ') || 'none'));
if (short.length > 40) console.log(`  … and ${short.length - 40} more`);
console.log('');

// What baking it costs. Mirrors inject-iptv.js: JSON.stringify of the sources
// object, embedded as a JS string literal.
const bakedAll = JSON.stringify(JSON.stringify(sources)).length;
const appPath = path.join(ROOT, 'void2-final.html');
const appSize = fs.existsSync(appPath) ? fs.statSync(appPath).size : 0;
console.log('WEIGHT  (inject-iptv.js bakes this into void2-final.html)');
console.log(`  whole pool baked : ${(bakedAll / 1024).toFixed(0)}KB  -> app ~${((appSize + bakedAll) / 1024).toFixed(0)}KB`);
for (const cap of [10, 12, 15, 20]) {
  const capped = {};
  for (const [k, v] of Object.entries(sources)) capped[k] = v.slice(0, cap);
  const b = JSON.stringify(JSON.stringify(capped)).length;
  const kept = Object.values(capped).reduce((a, v) => a + v.length, 0);
  console.log(`  cap ${String(cap).padStart(2)}/nation   : ${String((b / 1024).toFixed(0)).padStart(4)}KB  keeps ${kept} of ${sum} streams`);
}
console.log('');
console.log('  Baking the whole pool ships every stream to every user on every load,');
console.log('  whether or not they ever open one, and freezes it — IPTV URLs rot in');
console.log('  weeks. Cap what is baked; serve the rest.');
