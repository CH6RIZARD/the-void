#!/usr/bin/env node
// The master stream list behind the 5-region re-check (runs on the coordinator box).
//
//   node merge.js prep state.json pool.json master.json
//     adds streams the proxy has that the master lacks (the PC scout's new finds), writes
//     the list the regions should probe.
//   node merge.js apply state.json push.json alive-*.json
//     a stream that played from ANY region stays; one that failed everywhere gets a strike,
//     and two strikes in a row drop it. A one-region network blip can't wipe a nation.
//     Needs at least 3 regions back, else it changes nothing (exit 3).
'use strict';
const fs = require('fs');
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const MIN_REGIONS = 3;

function prep(state, pool) {
  const have = new Set(Object.values(state.sources).flat().map((s) => s.url));
  let added = 0;
  for (const [nation, list] of Object.entries(pool.sources || {})) {
    for (const s of list) {
      if (have.has(s.url)) continue;
      (state.sources[nation] = state.sources[nation] || []).push(s);
      have.add(s.url); added++;
    }
  }
  return added;
}

function apply(state, regions) {
  const hits = {};
  for (const r of regions) for (const u of r.alive) hits[u] = (hits[u] || 0) + 1;
  const push = {};
  let dropped = 0, count = 0;
  for (const [nation, list] of Object.entries(state.sources)) {
    state.sources[nation] = list.filter((s) => {
      if (hits[s.url]) { delete state.strikes[s.url]; return true; }
      state.strikes[s.url] = (state.strikes[s.url] || 0) + 1;
      if (state.strikes[s.url] >= 2) { delete state.strikes[s.url]; dropped++; return false; }
      return true;
    });
    const live = state.sources[nation].filter((s) => hits[s.url]).sort((a, b) => hits[b.url] - hits[a.url]);
    if (live.length) { push[nation] = live; count += live.length; }
  }
  return { push, count, dropped };
}

const [cmd, ...a] = process.argv.slice(2);
if (cmd === 'prep') {
  const state = read(a[0], { sources: {}, strikes: {} });
  const added = prep(state, read(a[1], {}));
  fs.writeFileSync(a[0], JSON.stringify(state));
  fs.writeFileSync(a[2], JSON.stringify({ sources: state.sources }));
  console.log(`prep: +${added} from the proxy, ${Object.values(state.sources).flat().length} to check`);
} else if (cmd === 'apply') {
  const state = read(a[0], { sources: {}, strikes: {} });
  const regions = a.slice(2).map((f) => read(f, null)).filter((r) => r && Array.isArray(r.alive));
  if (regions.length < MIN_REGIONS) { console.log(`apply: only ${regions.length} regions back, nothing changed`); process.exit(3); }
  const { push, count, dropped } = apply(state, regions);
  fs.writeFileSync(a[0], JSON.stringify(state));
  fs.writeFileSync(a[1], JSON.stringify({ generated: new Date().toISOString(), sources: push }));
  console.log(`apply: ${regions.length} regions, ${count} streams live, ${dropped} dropped after two misses`);
} else if (cmd === 'test') {
  const st = { sources: { X: [{ url: 'a' }, { url: 'b' }] }, strikes: {} };
  require('assert').strictEqual(prep(st, { sources: { X: [{ url: 'b' }, { url: 'c' }] } }), 1);
  let r = apply(st, [{ alive: ['a'] }, { alive: ['a', 'c'] }, { alive: [] }]);
  require('assert').deepStrictEqual(r.push.X.map((s) => s.url), ['a', 'c']);
  require('assert').strictEqual(st.strikes.b, 1);       // one miss: kept, not pushed
  r = apply(st, [{ alive: ['a'] }, { alive: [] }, { alive: [] }]);
  require('assert').strictEqual(r.dropped, 1);          // b: second miss in a row drops it
  require('assert').deepStrictEqual(st.sources.X.map((s) => s.url), ['a', 'c']);
  console.log('merge selftest ok');
}
