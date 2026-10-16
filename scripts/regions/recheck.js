#!/usr/bin/env node
// Runs on a rented box in one region: probe every stream in master.json the same way the
// full build does (https + CORS + playable variant) and write the urls that played.
//   node scripts/regions/recheck.js master.json alive.json
'use strict';
const fs = require('fs');
const { probe, pool } = require('../build-iptv-sources.js');

const [, , input, output] = process.argv;
const master = JSON.parse(fs.readFileSync(input, 'utf8'));
const urls = [...new Set(Object.values(master.sources).flat().map((s) => s.url))];

(async () => {
  const t0 = Date.now();
  const alive = (await pool(urls, async (u) => {
    let r = await probe(u);
    if (r === 'error') { await new Promise((res) => setTimeout(res, 1500)); r = await probe(u); }
    return typeof r === 'number' ? u : null;
  }, 24)).filter(Boolean);
  fs.writeFileSync(output, JSON.stringify({ at: new Date().toISOString(), checked: urls.length, alive }));
  console.log(`alive ${alive.length}/${urls.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
})();
