#!/usr/bin/env node
/**
 * inject-life.js — splice the verified walking-tour / daily-life / live-cam
 * pool into void2-final.html.
 *
 * Replaces the single delimited block that declares LIFE_JSON. Idempotent:
 * re-running replaces the block rather than stacking copies. Unlike
 * inject-iptv.js it never INSERTS the block and never rewires wallSlots — the
 * placeholder and lifeFor() are hand-written in the source (right after the
 * IPTV_SOURCES:GENERATED:END marker), so this script only ever swaps the data.
 * If the markers are missing it stops and says so rather than guessing where a
 * block of JavaScript should go.
 *
 * Emitted as a STRING, not an object literal, for the same reason as IPTV_JSON:
 * a large literal is parsed eagerly on every launch; a string costs nothing at
 * boot and lifeFor() JSON.parses it once, lazily.
 *
 *   node scripts/build-life-sources.js   # refresh + verify the pool
 *   node scripts/inject-life.js          # splice it in
 *   node build.js                        # regenerate all 3 builds
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'void2-final.html');
const GEN = path.join(__dirname, 'life-sources.generated.json');

const START = '/* ==== LIFE_SOURCES:GENERATED:START ==== */';
const END   = '/* ==== LIFE_SOURCES:GENERATED:END ==== */';

if (!fs.existsSync(GEN)) {
  console.error('FAILED:', path.relative(ROOT, GEN), 'not found — run node scripts/build-life-sources.js first');
  process.exit(1);
}
const raw = JSON.parse(fs.readFileSync(GEN, 'utf8'));
// Accept either the plain {country:[entries]} map or a {sources:{...}} wrapper.
const data = raw && raw.sources && typeof raw.sources === 'object' && !Array.isArray(raw.sources) ? raw.sources : raw;

// Never splice in something the app would choke on or an empty pool.
const pool = {};
let count = 0;
for (const [country, list] of Object.entries(data || {})) {
  if (!Array.isArray(list)) continue;
  const ok = list.filter(e => e && e.type === 'youtube' && /^[\w-]{11}$/.test(e.id || '') &&
                              ['walk', 'life', 'livecam'].includes(e.kind))
                 .map(e => ({ type: 'youtube', id: e.id, label: String(e.label || ''), kind: e.kind }));
  if (ok.length) { pool[country] = ok; count += ok.length; }
}
if (!count) {
  console.error('FAILED: generated pool is empty — refusing to inject');
  process.exit(1);
}

let html = fs.readFileSync(SRC, 'utf8');
const nl = html.includes('\r\n') ? '\r\n' : '\n';

const a = html.indexOf(START);
const e = html.indexOf(END);
if (a < 0 || e < 0 || e < a) {
  console.error('FAILED: LIFE_SOURCES markers not found in void2-final.html.');
  console.error('Add this placeholder right after the IPTV_SOURCES:GENERATED:END marker, then re-run:');
  console.error('  ' + START);
  console.error('  const LIFE_JSON = "{}";');
  console.error('  ' + END);
  process.exit(1);
}

const block = [
  START,
  'const LIFE_JSON = ' + JSON.stringify(JSON.stringify(pool)) + ';',
  END,
].join(nl);

html = html.slice(0, a) + block + html.slice(e + END.length);
console.log(`replaced LIFE_SOURCES block: ${count} videos across ${Object.keys(pool).length} countries`);

if (!/lifeFor\s*\(/.test(html)) {
  console.warn('WARN: no lifeFor() found — block written but nothing reads LIFE_JSON');
}

fs.writeFileSync(SRC, html);

// prove it still parses
const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
let m, n = 0, bad = 0;
while ((m = re.exec(html))) { n++; try { new Function(m[1]); } catch (err) { bad++; console.error('PARSE:', err.message); } }
console.log(`void2-final.html: ${n} inline scripts, ${bad} errors`);
if (bad) process.exit(1);
