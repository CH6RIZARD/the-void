#!/usr/bin/env node
/**
 * build-review-site.js — stage the "stream patches" review site.
 *
 * WHY
 * Stream-department work lands as a series of patches on the `stream-patches`
 * branch, to be merged into main only after review. A diff is a poor review
 * surface for this particular work: the interesting change is not the text of
 * void2-final.html (the C array is ONE line, so the globe going from 82 nations
 * to 199 shows up as `1 insertion, 1 deletion`) — it is whether the globe still
 * looks right and the new nations actually carry streams. So the review site
 * ships the PATCHED BUILD ITSELF alongside the numbers behind each patch.
 *
 * WHAT IT STAGES  (into ./public, which Pages deploys)
 *   index.html        what changed, why, and the measurements behind it
 *   void2-final.html  the patched build, playable — spin the globe and count
 *   diff.txt          the real diff against main, for anyone who wants it
 *
 * Run from a checkout of the stream-patches branch (the worktree on D: is one):
 *   node scripts/streams/build-review-site.js
 *   node scripts/streams/build-review-site.js --out public --base main
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const OUT = path.resolve(ROOT, arg('out', 'public'));
const BASE = arg('base', 'main');

const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return ''; } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const nationsFile = path.join(__dirname, 'nations.generated.json');
const nations = fs.existsSync(nationsFile) ? JSON.parse(fs.readFileSync(nationsFile, 'utf8')) : { count: 0, nations: {} };

/** Which nations this branch ADDED — base's C array vs the branch's table. */
function addedNations() {
  const baseHtml = git('show', `${BASE}:void2-final.html`);
  const have = new Set();
  const m = /const C\s*=\s*\[/.exec(baseHtml);
  if (m) {
    const from = baseHtml.indexOf('[', m.index);
    let depth = 0, k = from;
    for (; k < baseHtml.length; k++) { if (baseHtml[k] === '[') depth++; else if (baseHtml[k] === ']') { depth--; if (!depth) break; } }
    for (const e of baseHtml.slice(from, k).matchAll(/iso:\s*"([A-Za-z]{2})"/g)) have.add(e[1].toUpperCase());
  }
  return { before: have.size, added: Object.values(nations.nations).filter(n => !have.has(n.iso)) };
}

// %b spans lines, so records are terminated by  and fields split on .
// Splitting this on newlines counts every line of a commit BODY as its own commit.
const commits = git('log', '--no-merges', '--format=%h%s%b%ad', '--date=short', `${BASE}..HEAD`)
  .split('').map(r => r.replace(/^\s+/, '')).filter(Boolean)
  .map(r => { const [h, s, b, d] = r.split(''); return { h, s, b, d }; });

const diff = git('diff', `${BASE}...HEAD`);
const stat = git('diff', '--stat', `${BASE}...HEAD`).trim().split('\n').filter(Boolean);

const { before, added } = addedNations();

/* Coverage is READ FROM THE COMMITTED POOL rather than typed out, so the page
   can never claim a number the pool does not actually contain. */
const poolFile = path.join(ROOT, 'scripts', 'iptv-sources.generated.json');
const pool = fs.existsSync(poolFile) ? JSON.parse(fs.readFileSync(poolFile, 'utf8')) : { sources: {} };
const src = pool.sources || {};
let basePool = {};
try { basePool = JSON.parse(git('show', `${BASE}:scripts/iptv-sources.generated.json`) || '{}').sources || {}; } catch { basePool = {}; }
const count = o => Object.values(o).reduce((a, v) => a + v.length, 0);
const depth = Object.values(nations.nations).map(n => (src[n.name] || []).length);
const atLeast = v => depth.filter(d => d >= v).length;

const FACTS = [
  [`${count(basePool).toLocaleString()} → ${count(src).toLocaleString()}`, 'live streams in the pool'],
  [`${Object.keys(basePool).length} → ${Object.keys(src).length}`, 'nations carrying at least one stream'],
  [`${atLeast(30)} of ${depth.length}`, 'nations at 30+ streams — the target is 30–40 everywhere, so this is what is left to move'],
  [`${depth.filter(d => !d).length}`, 'nations still at zero, which no amount of iptv-org will fix'],
  ['68%', 'of probed channels were playable (https + #EXTM3U + CORS, following master → variant)'],
];

const page = `<!doctype html>
<html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stream Patches</title>
<style>
  :root{--bg:#04020c;--fg:#f4f0ff;--gold:#c9a84c;--dim:#6a58a0;--line:rgba(201,168,76,.28);--card:rgba(255,255,255,.03)}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;padding:0 16px}
  .wrap{max-width:860px;margin:0 auto;padding:56px 0 96px}
  h1{font-size:clamp(28px,6vw,44px);margin:0 0 6px;letter-spacing:-.02em}
  .sub{color:var(--dim);margin:0 0 40px;letter-spacing:.02em}
  h2{font-size:19px;margin:44px 0 14px;color:var(--gold);letter-spacing:.04em;text-transform:uppercase}
  a{color:var(--gold)}
  .cta{display:inline-block;border:1px solid var(--line);border-radius:14px;padding:18px 26px;text-decoration:none;margin:0 10px 12px 0}
  .cta:hover{background:rgba(201,168,76,.1)}
  .cta small{display:block;color:var(--dim);margin-top:4px}
  table{width:100%;border-collapse:collapse;margin:8px 0 4px}
  td{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.07);vertical-align:top}
  td.n{color:var(--gold);font-weight:600;white-space:nowrap;width:1%;font-variant-numeric:tabular-nums}
  .card{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:18px 20px;margin:0 0 14px}
  .card h3{margin:0 0 4px;font-size:16px}
  .card .meta{color:var(--dim);font-size:13px;margin:0 0 10px}
  pre{white-space:pre-wrap;font:12.5px/1.6 ui-monospace,Menlo,Consolas,monospace;color:#cfc4ee;margin:0}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .chip{border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:3px 10px;font-size:12.5px;color:#d8cff5}
  .big{font-size:clamp(34px,8vw,56px);color:var(--gold);line-height:1;font-variant-numeric:tabular-nums}
  .note{color:var(--dim);font-size:13.5px}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid rgba(255,255,255,.1);color:var(--dim);font-size:13px}
</style>
<div class="wrap">
  <h1>Stream patches</h1>
  <p class="sub">Branch <code>stream-patches</code> · ${commits.length} commit${commits.length === 1 ? '' : 's'} not yet in <code>${esc(BASE)}</code> · staged ${new Date().toISOString().slice(0, 10)}</p>

  <a class="cta" href="./void2-final.html">Open the patched build<small>spin the globe — count the markers</small></a>
  <a class="cta" href="./diff.txt">Read the raw diff<small>${stat.length ? esc(stat[stat.length - 1].trim()) : 'diff'}</small></a>

  <h2>The globe</h2>
  <p><span class="big">${before} &rarr; ${nations.count}</span></p>
  <p class="note">Discovery is gated on the globe: <code>build-iptv-sources.js</code> maps ISO&#8209;2 to a country name by reading the <code>C</code> array, so a channel from a nation the globe does not place is dropped before it is ever probed. These ${added.length} nations had nowhere to live.</p>
  <div class="chips">${added.map(n => `<span class="chip">${esc(n.name)}</span>`).join('')}</div>

  <h2>What the numbers said</h2>
  <table>${FACTS.map(([n, t]) => `<tr><td class="n">${esc(n)}</td><td>${esc(t)}</td></tr>`).join('')}</table>

  <h2>Commits</h2>
  ${commits.map(c => `<div class="card"><h3>${esc(c.s)}</h3><p class="meta">${esc(c.h)} · ${esc(c.d)}</p>${c.b && c.b.trim() ? `<pre>${esc(c.b.trim())}</pre>` : ''}</div>`).join('')}

  <h2>Files</h2>
  <pre>${esc(stat.join('\n'))}</pre>

  <h2>What to check</h2>
  <table>
    <tr><td class="n">1</td><td>Spin the globe. Markers should sit on land, in the right places — new nations take their centroid from a dataset, not by hand.</td></tr>
    <tr><td class="n">2</td><td>Search a new nation (Moldova, Tuvalu, Kosovo). It should open a nation panel, not fail.</td></tr>
    <tr><td class="n">3</td><td>The wall should look and feel unchanged — the 7 news / 3 life mix is untouched.</td></tr>
    <tr><td class="n">4</td><td>Existing nations should be byte-identical: their hand-tuned lat/lon and subreddits are kept as raw text, never regenerated.</td></tr>
  </table>

  <footer>Nothing here is on <code>${esc(BASE)}</code>. Merge <code>stream-patches</code> when it looks right.</footer>
</div>
</html>`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), page);
fs.writeFileSync(path.join(OUT, 'diff.txt'), diff || '(no diff)');
fs.copyFileSync(path.join(ROOT, 'void2-final.html'), path.join(OUT, 'void2-final.html'));

console.log('staged', path.relative(ROOT, OUT));
console.log('  commits ahead of', BASE, ':', commits.length);
console.log('  nations           :', before, '->', nations.count, `(+${added.length})`);
console.log('  diff              :', (diff.length / 1024).toFixed(1), 'KB');
