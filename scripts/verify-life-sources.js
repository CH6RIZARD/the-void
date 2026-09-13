#!/usr/bin/env node
/**
 * verify-life-sources.js — check every "life" source baked into void2-final.html.
 *
 * WHY THIS EXISTS
 * CAM_SOURCES (live cams) and RAW_FOOTAGE (walking tours / day-in-the-life) are
 * hand-harvested lists of YouTube ids and a few iframe/HLS URLs. They rot
 * silently: a video gets deleted, made private, or its owner turns embedding
 * off, and the tile can then only sit on an error card or time out. The app runs
 * from file:// and cannot ask YouTube anything (no CORS), so, as with
 * resolve-live.js, the check happens HERE, ahead of time.
 *
 * HOW
 *   youtube, 11-char id   -> oEmbed on watch?v=<id>
 *                            200 alive, 401 embedding disabled (dead),
 *                            400/404 removed or private (dead)
 *   youtube, UC...        -> channel id: "channel (not checked)"
 *   youtube, PL/UU/OLAK.. -> oEmbed on playlist?list=<id>
 *   hls                   -> range GET, body must start with #EXTM3U
 *   iframe                -> GET, read X-Frame-Options / CSP frame-ancestors;
 *                            SAMEORIGIN/DENY (or restrictive ancestors) = dead
 * Network errors, timeouts, 403, 429 and 5xx are retried once and then reported
 * as "unknown" — throttling is NOT evidence a source is dead. The one exception:
 * an oEmbed 403 on a video is confirmed against the watch page, because 403 is
 * also how oEmbed reports a PRIVATE video.
 *
 * TLS "UNABLE_TO_VERIFY_LEAF_SIGNATURE" on some municipal CDNs is Node's CA
 * store missing an intermediate; `node --use-system-ca` may help. Unknown, not dead.
 *
 * The object literals are extracted by string-aware brace matching from the
 * `const X = {` start and evaluated in a vm sandbox; entries are never regexed.
 * LIFE_JSON (the generated block, if present) is verified too but never edited
 * by --write — regenerate it instead.
 *
 * Run from a NORMAL network. From a datacenter IP YouTube throttles oEmbed and
 * you would get a wall of "unknown" (or worse, bake false deaths in).
 *
 *   node scripts/verify-life-sources.js           # report only
 *   node scripts/verify-life-sources.js --write   # drop dead entries from
 *                                                 # CAM_SOURCES / RAW_FOOTAGE
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'void2-final.html');
const OUT = path.join(__dirname, 'life-sources.verify.json');

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const WRITE       = process.argv.includes('--write');
const CONCURRENCY = parseInt(arg('concurrency', '6'), 10);
const TIMEOUT_MS  = parseInt(arg('timeout', '10000'), 10);

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

/* ------------------------------------------------------------------ parsing */

/**
 * Index of the bracket closing the one at `open`, skipping string literals and
 * comments so a "{" inside a label cannot throw the count off.
 */
function matchBracket(src, open) {
  const pairs = { '{': '}', '[': ']', '(': ')' };
  const stack = [];
  for (let k = open; k < src.length; k++) {
    const c = src[k];
    if (c === '"' || c === "'" || c === '`') {
      for (k++; k < src.length && src[k] !== c; k++) if (src[k] === '\\') k++;
      continue;
    }
    if (c === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); if (k < 0) return -1; continue; }
    if (c === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k + 2); if (k < 0) return -1; k++; continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === '}' || c === ']' || c === ')') {
      if (stack.pop() !== c) throw new Error('unbalanced bracket at ' + k);
      if (!stack.length) return k;
    }
  }
  return -1;
}

/** { start, end, value } for `const NAME = {...}`, or null if absent. */
function extractObject(html, name) {
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*\\{').exec(html);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  const end = matchBracket(html, start);
  if (end < 0) throw new Error('could not brace-match ' + name);
  const value = vm.runInNewContext('(' + html.slice(start, end + 1) + ')', {}, { timeout: 2000 });
  return { start, end, value };
}

/** LIFE_JSON is a JSON *string* literal inside the generated markers. */
function extractLifeJson(html) {
  const m = /const\s+LIFE_JSON\s*=\s*/.exec(html);
  if (!m) return null;
  const i = m.index + m[0].length;
  const q = html[i];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  let k = i + 1;
  for (; k < html.length && html[k] !== q; k++) if (html[k] === '\\') k++;
  const str = vm.runInNewContext(html.slice(i, k + 1), {}, { timeout: 2000 });
  try { return JSON.parse(str || '{}'); } catch (e) { throw new Error('LIFE_JSON is not valid JSON: ' + e.message); }
}

/** App country names from the C array, so coverage is measured against the globe. */
function appCountries(html) {
  const m = /const\s+C\s*=\s*\[/.exec(html);
  if (!m) return [];
  const start = m.index + m[0].length - 1;
  const arr = vm.runInNewContext('(' + html.slice(start, matchBracket(html, start) + 1) + ')', {}, { timeout: 2000 });
  return arr.map(c => c.n).filter(Boolean);
}

/** Every {type,...} descriptor under a country key, however deeply nested. */
function collect(obj, source) {
  const out = [];
  const walk = (v, country) => {
    if (Array.isArray(v)) return v.forEach(x => walk(x, country));
    if (v && typeof v === 'object') {
      if (typeof v.type === 'string' && (v.id || v.url)) return out.push({ source, country, ...v });
      for (const [k, x] of Object.entries(v)) walk(x, country || k);
    }
  };
  for (const [country, v] of Object.entries(obj || {})) {
    if (country.startsWith('_')) continue;
    walk(v, country);
  }
  return out;
}

/* ------------------------------------------------------------------- probes */

const RETRYABLE = s => s === 403 || s === 429 || s >= 500;

async function fetchOnce(url, opts = {}) {
  return fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), ...opts,
    headers: { ...UA, ...(opts.headers || {}) } });
}

/** One retry on network error or retryable status. Returns {r} or {err}. */
async function fetchRetry(url, opts) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetchOnce(url, opts);
      if (RETRYABLE(r.status) && attempt === 0) {
        last = { r }; await r.body?.cancel().catch(() => {});
        await new Promise(res => setTimeout(res, 1500 + Math.random() * 1500));
        continue;
      }
      return { r };
    } catch (e) {
      last = { err: e.name === 'TimeoutError' ? 'timeout' : (e.cause?.code || e.message) };
      if (attempt === 0) await new Promise(res => setTimeout(res, 1000));
    }
  }
  return last;
}

function youtubeKind(id) {
  if (/^[\w-]{11}$/.test(id)) return 'video';
  if (/^UC[\w-]{22}$/.test(id)) return 'channel';
  if (/^(PL|UU|OLAK|FL|RD|LL)[\w-]+$/.test(id)) return 'playlist';
  return 'invalid';
}

async function checkYoutube(item) {
  const kind = youtubeKind(item.id);
  if (kind === 'channel') return { status: 'unchecked', reason: 'channel (not checked)' };
  if (kind === 'invalid') return { status: 'dead', reason: 'malformed youtube id' };
  const target = kind === 'video'
    ? 'https://www.youtube.com/watch?v=' + item.id
    : 'https://www.youtube.com/playlist?list=' + item.id;
  const url = 'https://www.youtube.com/oembed?url=' + encodeURIComponent(target) + '&format=json';
  const { r, err } = await fetchRetry(url);
  if (err) return { status: 'unknown', reason: 'network: ' + err };
  const code = r.status;
  let title = null;
  if (code === 200) {
    try { title = (await r.json()).title || null; } catch { /* consent page etc. */ }
    if (!title && /consent\./.test(r.url)) return { status: 'unknown', reason: 'consent redirect', http: code };
    return { status: 'alive', http: code, title, kind };
  }
  await r.body?.cancel().catch(() => {});
  if (code === 403 && kind === 'video') return disambiguate403(item.id);
  if (code === 401) return { status: 'dead', http: code, kind, reason: 'embedding disabled (oEmbed 401)' };
  if (code === 404) return { status: 'dead', http: code, kind, reason: 'removed or private (oEmbed 404)' };
  if (code === 400) return { status: 'dead', http: code, kind, reason: 'invalid/removed (oEmbed 400)' };
  return { status: 'unknown', http: code, kind, reason: 'oEmbed HTTP ' + code + (RETRYABLE(code) ? ' (throttled/blocked, after retry)' : '') };
}

/**
 * oEmbed answers 403 for PRIVATE videos, but 403 is also what a blocked client
 * gets. Measured 2026-09-13: the 403 ids stayed 403 across retries while their
 * neighbours returned 200, and the watch page said "Private video". So a 403 is
 * confirmed against the watch page's playabilityStatus before it counts as dead.
 */
async function disambiguate403(id) {
  const base = { http: 403, kind: 'video' };
  const { r, err } = await fetchRetry('https://www.youtube.com/watch?v=' + id);
  if (err || !r.ok) return { status: 'unknown', ...base, reason: 'oEmbed 403, watch page ' + (err || 'HTTP ' + r.status) };
  const t = await r.text();
  const m = /"playabilityStatus":\{"status":"([A-Z_]+)"(?:,"reason":"([^"]*)")?/.exec(t);
  if (!m) return { status: 'unknown', ...base, reason: 'oEmbed 403 (throttled/blocked?), no playabilityStatus' };
  const why = 'oEmbed 403, watch page ' + m[1] + (m[2] ? ' "' + m[2] + '"' : '');
  if (m[1] === 'ERROR' || m[1] === 'UNPLAYABLE' || /private/i.test(m[2] || '')) return { status: 'dead', ...base, reason: why };
  return { status: 'unknown', ...base, reason: why };
}

async function checkHls(item) {
  const { r, err } = await fetchRetry(item.url, { headers: { Range: 'bytes=0-2047' } });
  if (err) return { status: 'unknown', reason: 'network: ' + err };
  if (!r.ok) {
    await r.body?.cancel().catch(() => {});
    if (RETRYABLE(r.status)) return { status: 'unknown', http: r.status, reason: 'HTTP ' + r.status };
    return { status: 'dead', http: r.status, reason: 'HTTP ' + r.status };
  }
  const body = (await r.text()).replace(/^﻿/, '').trimStart();
  if (!body.startsWith('#EXTM3U')) return { status: 'dead', http: r.status, reason: 'not a playlist (no #EXTM3U)' };
  return { status: 'alive', http: r.status, cors: r.headers.get('access-control-allow-origin') || null };
}

/** Parse CSP frame-ancestors; returns null when absent, else whether '*' is allowed. */
function frameAncestors(csp) {
  if (!csp) return null;
  const d = csp.split(';').map(s => s.trim()).find(s => /^frame-ancestors\b/i.test(s));
  if (!d) return null;
  const vals = d.split(/\s+/).slice(1);
  return { raw: d, open: vals.includes('*') };
}

async function checkIframe(item) {
  const { r, err } = await fetchRetry(item.url);
  if (err) return { status: 'unknown', reason: 'network: ' + err };
  await r.body?.cancel().catch(() => {});
  const xfo = r.headers.get('x-frame-options');
  const fa = frameAncestors(r.headers.get('content-security-policy'));
  const info = { http: r.status, xfo: xfo || null, frameAncestors: fa ? fa.raw : null };
  if (xfo && /deny|sameorigin/i.test(xfo)) return { status: 'dead', ...info, reason: 'unframeable: X-Frame-Options ' + xfo };
  if (fa && !fa.open) return { status: 'dead', ...info, reason: 'unframeable: CSP ' + fa.raw };
  if (r.status === 404 || r.status === 410) return { status: 'dead', ...info, reason: 'HTTP ' + r.status };
  if (!r.ok) return { status: 'unknown', ...info, reason: 'HTTP ' + r.status };
  return { status: 'alive', ...info };
}

function check(item) {
  if (item.type === 'youtube') return checkYoutube(item);
  if (item.type === 'hls') return checkHls(item);
  if (item.type === 'iframe') return checkIframe(item);
  return Promise.resolve({ status: 'unchecked', reason: 'type ' + item.type + ' not checked' });
}

async function pool(items, fn, n) {
  const out = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i]); }
      catch (e) { out[i] = { status: 'unknown', reason: 'probe crashed: ' + e.message }; }
      if (++done % 25 === 0) process.stderr.write('  ' + done + '/' + items.length + '\n');
    }
  }));
  return out;
}

/* -------------------------------------------------------------------- write */

/**
 * Remove one entry object from the literal spanning html[start..end]. The entry
 * is located by brace-matching each `{` inside the country's array and
 * comparing its evaluated fields, then deleted with its separating comma (and
 * its whole line when it sits alone on one). Returns the new html or null.
 */
function removeEntry(html, lit, entry) {
  const key = JSON.stringify(entry.country);
  const keyAt = html.indexOf(key, lit.start);
  if (keyAt < 0 || keyAt > lit.end) return null;
  const arrOpen = html.indexOf('[', keyAt);
  const arrClose = matchBracket(html, arrOpen);
  for (let k = arrOpen + 1; k < arrClose; k++) {
    const c = html[k];
    if (c === '"' || c === "'" || c === '`') { for (k++; html[k] !== c; k++) if (html[k] === '\\') k++; continue; }
    if (c !== '{') continue;
    const e = matchBracket(html, k);
    let obj;
    try { obj = vm.runInNewContext('(' + html.slice(k, e + 1) + ')', {}, { timeout: 500 }); } catch { k = e; continue; }
    if (!(obj && obj.type === entry.type && (obj.id || null) === (entry.id || null) && (obj.url || null) === (entry.url || null))) { k = e; continue; }

    let t = e + 1; while (/[ \t]/.test(html[t])) t++;
    let p = k - 1; while (p > arrOpen && /\s/.test(html[p])) p--;
    let a, b;
    if (html[t] === ',') {
      // `{...},` — take the entry and its trailing comma
      a = k; b = t + 1;
    } else if (html[p] === ',') {
      // last element — take the comma before it; the newline before `]` stays
      a = p; b = e + 1;
    } else {
      a = k; b = e + 1; // only element
    }
    if (a === k) {
      // entry alone on its line -> remove the whole line, newline included
      const ls = html.lastIndexOf('\n', k - 1) + 1;
      let le = b; while (/[ \t\r]/.test(html[le])) le++;
      if (/^[ \t]*$/.test(html.slice(ls, k)) && html[le] === '\n') { a = ls; b = le + 1; }
    }
    return html.slice(0, a) + html.slice(b);
  }
  return null;
}

/* --------------------------------------------------------------------- main */

(async () => {
  const html = fs.readFileSync(SRC, 'utf8');
  const cams = extractObject(html, 'CAM_SOURCES');
  const raw = extractObject(html, 'RAW_FOOTAGE');
  const life = extractLifeJson(html);
  if (!cams) throw new Error('CAM_SOURCES not found in void2-final.html');
  if (!raw) throw new Error('RAW_FOOTAGE not found in void2-final.html');

  const items = [
    ...collect(cams.value, 'CAM_SOURCES'),
    ...collect(raw.value, 'RAW_FOOTAGE'),
    ...collect(life, 'LIFE_JSON'),
  ];
  const bySrc = s => items.filter(i => i.source === s).length;
  console.log('CAM_SOURCES ' + bySrc('CAM_SOURCES') + ', RAW_FOOTAGE ' + bySrc('RAW_FOOTAGE') +
    ', LIFE_JSON ' + (life ? bySrc('LIFE_JSON') : 'absent'));
  console.log('probing ' + items.length + ' items (concurrency ' + CONCURRENCY + ', timeout ' + TIMEOUT_MS + 'ms)...\n');

  const t0 = Date.now();
  const res = await pool(items, check, CONCURRENCY);
  const results = items.map((it, i) => ({ ...it, ...res[i] }));

  // ---- aggregate
  const blank = () => ({ alive: 0, dead: 0, unknown: 0, unchecked: 0 });
  const totals = { all: blank() };
  const countries = {};
  for (const r of results) {
    (totals[r.source] ||= blank())[r.status]++;
    totals.all[r.status]++;
    const c = (countries[r.country] ||= { CAM_SOURCES: blank(), RAW_FOOTAGE: blank(), LIFE_JSON: blank(), alive: 0 });
    c[r.source][r.status]++;
    if (r.status === 'alive') c.alive++;
  }

  const cell = b => (b.alive + '/' + b.dead + '/' + b.unknown + (b.unchecked ? '+' + b.unchecked + 'ch' : '')).padEnd(12);
  console.log('COUNTRY'.padEnd(26) + 'CAMS a/d/u'.padEnd(12) + 'RAW a/d/u'.padEnd(12) + 'LIFE a/d/u'.padEnd(12) + 'ALIVE');
  for (const [name, c] of Object.entries(countries).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(name.slice(0, 25).padEnd(26) + cell(c.CAM_SOURCES) + cell(c.RAW_FOOTAGE) + cell(c.LIFE_JSON) + c.alive);
  }

  console.log('\nTOTALS (alive / dead / unknown / channel-not-checked)');
  for (const [k, b] of Object.entries(totals)) {
    console.log('  ' + k.padEnd(12) + b.alive + ' / ' + b.dead + ' / ' + b.unknown + ' / ' + b.unchecked);
  }

  const dead = results.filter(r => r.status === 'dead');
  const unknown = results.filter(r => r.status === 'unknown');
  const appNames = appCountries(html);
  const uncovered = appNames.filter(n => !countries[n]);
  const zero = Object.entries(countries).filter(([, c]) => c.alive === 0).map(([n]) => n).sort();

  console.log('\nDEAD (' + dead.length + ')');
  for (const r of dead) console.log('  ' + r.source.padEnd(12) + r.country.padEnd(24) + (r.id || r.url) + '  ' + r.reason + '  — ' + (r.label || ''));
  if (unknown.length) {
    console.log('\nUNKNOWN (' + unknown.length + ')');
    for (const r of unknown) console.log('  ' + r.source.padEnd(12) + r.country.padEnd(24) + (r.id || r.url) + '  ' + r.reason);
    const throttled = unknown.filter(r => r.http === 429 || r.http === 403 || /timeout|network/.test(r.reason || '')).length;
    if (throttled > items.length * 0.2) console.log('\n!! ' + throttled + ' probes throttled/blocked/timed out — the network is likely rate-limited; do not trust this run for --write.');
  }
  console.log('\nAPP COUNTRIES (C array) WITH NO LIFE ENTRIES AT ALL (' + uncovered.length + '/' + appNames.length + '): ' + (uncovered.join(', ') || 'none'));
  console.log('\nCOUNTRIES WITH ZERO ALIVE LIFE SOURCES (' + zero.length + '): ' + (zero.join(', ') || 'none'));

  const report = {
    _verifiedAt: new Date().toISOString(),
    _elapsedMs: Date.now() - t0,
    lifeJsonPresent: !!life,
    totals, countries, zeroAlive: zero, noEntries: uncovered,
    dead: dead.map(({ source, country, type, id, url, label, reason, http }) => ({ source, country, type, id, url, label, reason, http })),
    results,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log('\nreport -> ' + path.relative(ROOT, OUT));

  if (!WRITE) { console.log('(report only — pass --write to remove dead entries from void2-final.html)'); return; }

  // ---- --write: CAM_SOURCES / RAW_FOOTAGE only; LIFE_JSON is generated.
  let out = html, removed = 0;
  const editable = dead.filter(r => r.source !== 'LIFE_JSON' && ['youtube', 'iframe', 'hls'].includes(r.type));
  for (const r of editable) {
    const lit = extractObject(out, r.source); // re-locate: offsets shift after each removal
    const next = removeEntry(out, lit, r);
    if (next === null) { console.warn('  could not locate ' + r.source + ' / ' + r.country + ' / ' + (r.id || r.url)); continue; }
    out = next; removed++;
  }
  // sanity: both literals must still evaluate and have shrunk by exactly `removed`
  const after = collect(extractObject(out, 'CAM_SOURCES').value, 'CAM_SOURCES').length +
                collect(extractObject(out, 'RAW_FOOTAGE').value, 'RAW_FOOTAGE').length;
  const before = bySrc('CAM_SOURCES') + bySrc('RAW_FOOTAGE');
  if (after !== before - removed) throw new Error('write sanity check failed (' + before + ' - ' + removed + ' != ' + after + '); nothing written');
  fs.writeFileSync(SRC, out);
  console.log('\nremoved ' + removed + ' dead entries from void2-final.html. Run `node build.js` next.');
})().catch(e => { console.error(e); process.exit(1); });
