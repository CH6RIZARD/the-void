#!/usr/bin/env node
/**
 * inject-iptv.js — splice the verified HLS pool into void2-final.html.
 *
 * Writes/replaces a single delimited block declaring IPTV_SOURCES, and makes
 * wallSlots() merge it with CAM_SOURCES + RAW_FOOTAGE. Idempotent: re-running
 * replaces the block rather than stacking copies.
 *
 * These sources are DEMOTED below the curated ones on purpose. CAM_SOURCES and
 * RAW_FOOTAGE are hand-picked, place-specific cameras (a Kyiv skyline, a Gaza
 * street). IPTV is broadcast television — reliable and genuinely global, but
 * generic. The wall should still lead with the specific thing and fall back to
 * the reliable thing, not the other way round.
 *
 *   node scripts/build-iptv-sources.js   # refresh + verify the pool
 *   node scripts/inject-iptv.js          # splice it in
 *   node build.js                        # regenerate all 3 builds
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'void2-final.html');
const GEN = path.join(__dirname, 'iptv-sources.generated.json');

const START = '/* ==== IPTV_SOURCES:GENERATED:START ==== */';
const END   = '/* ==== IPTV_SOURCES:GENERATED:END ==== */';

const data = JSON.parse(fs.readFileSync(GEN, 'utf8'));
let html = fs.readFileSync(SRC, 'utf8');
const nl = html.includes('\r\n') ? '\r\n' : '\n';

const block = [
  START,
  `// ${data.count} HLS streams across ${data.countries} countries, generated`,
  `// ${data.generated} by scripts/build-iptv-sources.js and PROBED — each one`,
  '// served #EXTM3U at generation time. Regenerate with that script; do not',
  '// hand-edit, this block is overwritten.',
  '//',
  '// Why HLS: the wall was ~96% YouTube, and most non-YouTube entries answer',
  '// X-Frame-Options: SAMEORIGIN so they can never render. An .m3u8 needs CORS,',
  '// not embed permission, and hls.js is already wired into attemptSource.',
  'const IPTV_SOURCES = ' + JSON.stringify(data.sources) + ';',
  END,
].join(nl);

// 1. block
if (html.includes(START)) {
  const a = html.indexOf(START);
  const b = html.indexOf(END) + END.length;
  html = html.slice(0, a) + block + html.slice(b);
  console.log('replaced existing IPTV_SOURCES block');
} else {
  const anchor = 'const RAW_FOOTAGE = {';
  const at = html.indexOf(anchor);
  if (at < 0) throw new Error('anchor "const RAW_FOOTAGE = {" not found');
  html = html.slice(0, at) + block + nl + html.slice(at);
  console.log('inserted IPTV_SOURCES block before RAW_FOOTAGE');
}

// 2. wallSlots must actually read it, or the block is dead weight
const oldSrc = 'src:shuffle([...(CAM_SOURCES[n]||[]),...(RAW_FOOTAGE[n]||[])])';
const newSrc = 'src:shuffle([...(CAM_SOURCES[n]||[]),...(RAW_FOOTAGE[n]||[])])' +
               '.concat(shuffle([...((typeof IPTV_SOURCES!=="undefined"&&IPTV_SOURCES[n])||[])]))';
if (html.includes(newSrc)) {
  console.log('wallSlots already merges IPTV_SOURCES');
} else if (html.includes(oldSrc)) {
  html = html.replace(oldSrc, newSrc);
  console.log('wallSlots now merges IPTV_SOURCES (appended, so curated cams still lead)');
} else {
  console.warn('WARN: wallSlots source-list pattern not found — block written but NOT wired');
}

fs.writeFileSync(SRC, html);

// 3. prove it still parses
const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
let m, n = 0, bad = 0;
while ((m = re.exec(html))) { n++; try { new Function(m[1]); } catch (e) { bad++; console.error('PARSE:', e.message); } }
console.log(`void2-final.html: ${n} inline scripts, ${bad} errors`);
if (bad) process.exit(1);
