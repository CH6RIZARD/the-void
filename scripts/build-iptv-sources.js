#!/usr/bin/env node
/**
 * build-iptv-sources.js — generate a verified, non-YouTube live source pool.
 *
 * WHY
 * The wall is ~96% YouTube in practice. Of 240 declared sources, 209 are
 * YouTube; and 11 of 16 probed non-YouTube sources answer
 * X-Frame-Options: SAMEORIGIN, meaning they can NEVER render in an iframe
 * (every skylinewebcams entry — Ukraine, Israel, Palestine, Lebanon, Iran,
 * Iraq, Pakistan). One provider's policy change takes the whole wall down, and
 * 9 of 13 news channels were dark when probed.
 *
 * HLS sidesteps framing policy entirely: an .m3u8 needs CORS, not embed
 * permission, and hls.js is already wired into attemptSource.
 *
 * iptv-org publishes a maintained country-tagged catalogue. Measured:
 *   17,968 streams / 40,963 channels
 *   15,291 usable .m3u8 carrying a country, across 178 countries
 *   1,680 news-category
 *
 * WHAT IT DOES
 *   1. pull the catalogue
 *   2. map ISO-2 -> the app's own country names (read from the C array)
 *   3. cap per country so the US (3,247) cannot swamp the globe
 *   4. prefer news/documentary, keep the rest as a lower tier
 *   5. PROBE every candidate — liveness is an HTTP fact, not a guess
 *   6. write scripts/iptv-sources.generated.json
 *
 * Run from a NORMAL network. From a datacenter IP many broadcasters geo-block
 * or rate-limit and you will bake "everything is dead" into the build — the
 * same trap resolve-live.js warns about.
 *
 *   node scripts/build-iptv-sources.js
 *   node scripts/build-iptv-sources.js --target 600 --per-country 5
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API = 'https://raw.githubusercontent.com/iptv-org/api/gh-pages/';
const OUT = path.join(__dirname, 'iptv-sources.generated.json');

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const TARGET      = parseInt(arg('target', '600'), 10);
const PER_COUNTRY = parseInt(arg('per-country', '5'), 10);
const CONCURRENCY = parseInt(arg('concurrency', '24'), 10);
const PROBE_MS    = parseInt(arg('timeout', '6000'), 10);

const PREFERRED = new Set(['news', 'documentary', 'politics', 'legislative', 'weather']);

/** ISO-2 -> app country names, read from the real C array so they always match. */
function appCountries() {
  const html = fs.readFileSync(path.join(ROOT, 'void2-final.html'), 'utf8');
  const i = html.search(/const C\s*=\s*\[/);
  if (i < 0) throw new Error('could not find the C country array in void2-final.html');
  let depth = 0; const j = html.indexOf('[', i); let k = j;
  for (; k < html.length; k++) {
    if (html[k] === '[') depth++;
    else if (html[k] === ']') { depth--; if (!depth) break; }
  }
  const map = {};
  const body = html.slice(j, k + 1);
  for (const m of body.matchAll(/n:\s*['"]([^'"]+)['"][^}]*?iso:\s*['"]([A-Za-z]{2})['"]/g)) {
    map[m[2].toUpperCase()] = m[1];
  }
  return map;
}

async function getJSON(name) {
  const r = await fetch(API + name, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(name + ' HTTP ' + r.status);
  return r.json();
}

/**
 * Alive = serves a playlist now. Range-limited GET rather than HEAD: many CDNs
 * answer HEAD with 405 while serving GET fine, so HEAD would report healthy
 * streams as dead.
 */
async function probe(url) {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_MS),
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-2047' },
    });
    if (!r.ok && r.status !== 206) return false;
    return (await r.text()).slice(0, 2048).includes('#EXTM3U');
  } catch { return false; }
}

async function pool(items, worker, n) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const at = i++; out[at] = await worker(items[at]); }
  }));
  return out;
}

(async () => {
  const iso2name = appCountries();
  console.log('app countries mapped from C array :', Object.keys(iso2name).length);

  const [streams, channels] = await Promise.all([getJSON('streams.json'), getJSON('channels.json')]);
  console.log('iptv-org streams / channels       :', streams.length, '/', channels.length);

  const byId = {};
  for (const c of channels) byId[c.id] = c;

  const byCountry = {}; const seen = new Set();
  for (const s of streams) {
    if (!s.url || !/\.m3u8/i.test(s.url) || seen.has(s.url)) continue;
    const ch = byId[s.channel];
    if (!ch || !ch.country || ch.is_nsfw) continue;
    const name = iso2name[String(ch.country).toUpperCase()];
    if (!name) continue;
    seen.add(s.url);
    (byCountry[name] = byCountry[name] || []).push({
      country: name, url: s.url, label: ch.name || s.channel,
      pref: (ch.categories || []).some(c => PREFERRED.has(c)) ? 0 : 1,
    });
  }
  console.log('countries the globe can place     :', Object.keys(byCountry).length);

  const queue = [];
  const lists = Object.values(byCountry).map(v => v.sort((a, b) => a.pref - b.pref));
  for (let rank = 0; rank < PER_COUNTRY; rank++) {
    for (const list of lists) if (list[rank]) queue.push(list[rank]);
  }
  console.log('candidates after per-country cap  :', queue.length, `(max ${PER_COUNTRY}/country)`);

  console.log(`\nprobing (concurrency ${CONCURRENCY}, ${PROBE_MS}ms)…`);
  const t0 = Date.now(); let done = 0;
  const results = await pool(queue, async (c) => {
    const ok = await probe(c.url);
    if (++done % 100 === 0) process.stdout.write(`  ${done}/${queue.length}\r`);
    return ok ? c : null;
  }, CONCURRENCY);

  const live = results.filter(Boolean);
  console.log(`  probed ${queue.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log('  ALIVE                           :', live.length,
              `(${Math.round(live.length / Math.max(1, queue.length) * 100)}%)`);

  // Keep the spread: rank 0 from every country before any country's rank 1.
  const grouped = {};
  for (const c of live) (grouped[c.country] = grouped[c.country] || []).push(c);
  const final = [];
  for (let rank = 0; final.length < TARGET; rank++) {
    let any = false;
    for (const k of Object.keys(grouped)) {
      const c = grouped[k][rank];
      if (c) { final.push(c); any = true; if (final.length >= TARGET) break; }
    }
    if (!any) break;
  }

  const out = {};
  for (const c of final) {
    (out[c.country] = out[c.country] || []).push({ type: 'hls', url: c.url, label: c.label });
  }
  fs.writeFileSync(OUT, JSON.stringify({
    generated: new Date().toISOString(),
    note: 'Generated by scripts/build-iptv-sources.js from iptv-org. Every URL served ' +
          '#EXTM3U at generation time. Re-run from a normal network to refresh.',
    count: final.length, countries: Object.keys(out).length, sources: out,
  }, null, 1));

  const news = final.filter(c => c.pref === 0).length;
  console.log('\nWROTE', path.relative(ROOT, OUT));
  console.log('  sources  :', final.length);
  console.log('  countries:', Object.keys(out).length);
  console.log('  news/doc :', news, `(${Math.round(news / Math.max(1, final.length) * 100)}%)`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
