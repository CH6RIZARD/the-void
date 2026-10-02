#!/usr/bin/env node
/**
 * source-scout.mjs — the standing live-source agent.
 *
 * build-iptv-sources.js is a one-shot, rule-based prober: hard lists decide
 * which channels are "of" a nation and which are content, and whatever the
 * rules cannot classify is dropped. This agent is the judgment layer on top,
 * run on a schedule:
 *
 *   1. HARVEST  the iptv-org catalogue (same endpoints as the builder) and
 *               keep https .m3u8 streams for nations the globe knows, that the
 *               current pool does NOT already carry and that this agent has
 *               not already judged (state remembers every verdict).
 *   2. JUDGE    each candidate with a local LLM (Ollama, qwen2.5:3b, JSON
 *               output, temperature 0): is this a live picture OF that nation
 *               - news, public, local life, culture - and not movies / series /
 *               kids / shopping / sports rights / music video / an exile
 *               channel about somewhere else? Niche and local is wanted; a
 *               multinational brand's foreign feed is not.
 *   3. PROBE    survivors the way the browser will play them: https manifest
 *               serving #EXTM3U with a CORS header, and a master playlist's
 *               first variant serving #EXTINF - the builder's own bar - with
 *               the connect time recorded.
 *   4. MERGE    verified finds into scripts/iptv-sources.generated.json,
 *               fastest first, capped per country per run so one run can never
 *               flood a nation, then inject-iptv.js + build.js. With --ship it
 *               commits and pushes, and Cloudflare Pages deploys the web.
 *
 * State lives in D:\void-scout\state.json (every url ever judged, with the
 * verdict), the log in D:\void-scout\scout.log. Run it:
 *
 *   node scripts/source-scout.mjs --dry-run      # judge + probe, change nothing
 *   node scripts/source-scout.mjs --ship         # merge, rebuild, commit, push
 *   node scripts/source-scout.mjs --limit 120    # cap candidates this run
 *
 * Scheduled daily via Windows Task Scheduler (task "VoidSourceScout").
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GEN = path.join(ROOT, 'scripts', 'iptv-sources.generated.json');
// State prefers D:, but D: has gone read-only before (exFAT dirty bit), so a
// failed mkdir falls back to LocalAppData rather than killing a scheduled run.
const STATE_DIR = (() => {
  for (const d of [process.env.SCOUT_STATE || '', 'D:\\void-scout', path.join(process.env.LOCALAPPDATA || '.', 'void-scout')]) {
    if (!d) continue;
    try { mkdirSync(d, { recursive: true }); return d; } catch {}
  }
  return '.';
})();
const STATE = path.join(STATE_DIR, 'state.json');
const LOG = path.join(STATE_DIR, 'scout.log');
const API = 'https://raw.githubusercontent.com/iptv-org/api/gh-pages/';
const ORIGIN = 'https://thevoid.app';
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.SCOUT_MODEL || 'qwen2.5:3b';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const SHIP = args.includes('--ship');
const LIMIT = Math.max(10, parseInt(args[args.indexOf('--limit') + 1], 10) || 150);
const PER_COUNTRY_CAP = 4; // new streams one run may add to one nation


const log = (m) => { const line = new Date().toISOString() + ' ' + m; console.log(m); try { appendFileSync(LOG, line + '\n'); } catch {} };

// ─── the nations the globe knows, read from the app itself ──────────────────
function appCountries() {
  const html = readFileSync(path.join(ROOT, 'void2-final.html'), 'utf8');
  const m = html.match(/const C=\[([\s\S]*?)\];/);
  const names = new Map(); // iso2 -> app name
  for (const mm of m[1].matchAll(/\{n:"([^"]+)"[^}]*iso:"([A-Z]{2})"/g)) names.set(mm[2], mm[1]);
  names.set('UK', names.get('GB') ? 'United Kingdom' : 'United Kingdom'); // iptv-org spells GB "UK"
  return names;
}

async function j(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }

// ─── 2. the judge ───────────────────────────────────────────────────────────
const SYSTEM = `You curate live TV for a world-events app. For each channel decide if it is a LIVE PICTURE OF ITS OWN NATION: national/local news, public/legislative TV, local culture, city or daily-life programming. KEEP those. REJECT: movies, series, kids, cartoons, shopping, telenovelas, sports-rights channels, music video loops, religious shopping, adult, test cards, and channels ABOUT a different country than their own (exile/diaspora feeds, "X International" aimed abroad). Niche local beats big multinational: a small regional broadcaster is exactly what is wanted; a world feed of a global brand is not. Answer ONLY JSON: {"verdicts":[{"i":<index>,"keep":true|false,"kind":"news"|"public"|"life"|"culture"|"other","label":"<clean short display name>"}]}`;

async function judgeLLM(batch) {
  const lines = batch.map((c, i) => `${i}. name:"${c.name}" country:"${c.country}" categories:[${(c.categories || []).join(',')}] network:"${c.network || ''}"`).join('\n');
  const body = { model: MODEL, stream: false, format: 'json', options: { temperature: 0, num_ctx: 2048 }, messages: [ { role: 'system', content: SYSTEM }, { role: 'user', content: lines } ] };
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(OLLAMA + '/api/chat', { method: 'POST', body: JSON.stringify(body) });
      const d = await r.json();
      const out = JSON.parse(d.message.content);
      if (Array.isArray(out.verdicts)) return out.verdicts;
    } catch (e) { if (t === 2) log('  judge failed on a batch: ' + e.message); }
  }
  return [];
}

// The fallback judge: the builder's reject-lists as rules. It runs when Ollama
// is down or the model is missing, so a scheduled run degrades to the same
// judgment the one-shot builder applied instead of aborting; it keeps only
// what the rules can POSITIVELY place (news/public/legislative/culture/local),
// where the LLM also keeps the ambiguous-but-real local channels the rules
// cannot see. The LLM is the agent; this is the floor under it.
const RULE_REJECT = /movie|cine|film|series|novela|telenovela|kids|cartoon|anime|junior|shop|teleshop|venta|sport|futbol|football|racing|music|hits|radio|xxx|adult|test|promo|trailer|karaoke|lottery/i;
const RULE_FOREIGN = /international|world(?!news)|global|europe\b|usa\b|arabic|exile/i;
const RULE_KEEP = /news|noticias|haber|akhbar|info|public|parliament|senat|assembl|tv ?local|regional|culture|kultur|municipal/i;
function judgeRules(batch) {
  return batch.map((c, i) => {
    const hay = c.name + ' ' + (c.categories || []).join(' ');
    if (RULE_REJECT.test(hay) || RULE_FOREIGN.test(c.name)) return { i, keep: false };
    const cats = (c.categories || []).join(' ');
    const keep = RULE_KEEP.test(hay) || /news|general|legislative|culture/.test(cats);
    const kind = /news|noticias|haber|info/i.test(hay) ? 'news' : /parliament|public|senat/i.test(hay) ? 'public' : 'other';
    return { i, keep, kind, label: c.name };
  });
}

let _useLLM = null; // decided once per run
async function judge(batch) {
  if (_useLLM === null) {
    const tags = await fetch(OLLAMA + '/api/tags').then(r => r.json()).catch(() => null);
    _useLLM = !!(tags && tags.models && tags.models.some(m => m.name.startsWith(MODEL.split(':')[0])));
    log(_useLLM ? `judge: ${MODEL} via ollama` : 'judge: RULE FALLBACK (ollama/model unavailable) - run again with the model up to catch what rules miss');
  }
  if (_useLLM) {
    const v = await judgeLLM(batch);
    if (v.length) return v;
  }
  return judgeRules(batch);
}

// ─── 3. the probe: the builder's bar, measured ──────────────────────────────
async function probe(url) {
  const t0 = Date.now();
  const get = async (u) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
    try { const r = await fetch(u, { signal: ctl.signal, headers: { Origin: ORIGIN } }); clearTimeout(t); return r; }
    catch (e) { clearTimeout(t); return null; }
  };
  if (!/^https:/.test(url)) return null;                          // mixed content never plays
  const r = await get(url); if (!r || !r.ok) return null;
  const acao = r.headers.get('access-control-allow-origin');
  if (acao !== '*' && acao !== ORIGIN) return null;               // hls.js needs CORS
  const text = await r.text().catch(() => '');
  if (!text.includes('#EXTM3U')) return null;
  if (!text.includes('#EXTINF')) {                                // master: check first variant
    const v = text.split('\n').map(x => x.trim()).find(x => x && !x.startsWith('#'));
    if (!v) return null;
    const vu = new URL(v, url).href;
    const r2 = await get(vu); if (!r2 || !r2.ok) return null;
    const t2 = await r2.text().catch(() => '');
    if (!t2.includes('#EXTINF')) return null;
  }
  return Date.now() - t0;
}

// ─── main ───────────────────────────────────────────────────────────────────
(async () => {
  log(`scout run start (dry=${DRY} ship=${SHIP} limit=${LIMIT} model=${MODEL})`);
  const names = appCountries();
  // The generated file wraps the pool: {generated, note, count, countries, sources}.
  const gen = JSON.parse(readFileSync(GEN, 'utf8'));
  const pool = gen.sources || {};
  const have = new Set(); for (const c in pool) for (const s of pool[c]) have.add(s.url);
  let state = { judged: {} };
  try { state = JSON.parse(readFileSync(STATE, 'utf8')); } catch {}

  const [channels, streams] = await Promise.all([j(API + 'channels.json'), j(API + 'streams.json')]);
  const chById = new Map(channels.map(c => [c.id, c]));
  const candidates = [];
  for (const st of streams) {
    const u = st.url || '';
    if (!/^https:.*\.m3u8/.test(u) || have.has(u) || state.judged[u]) continue;
    const ch = chById.get(st.channel); if (!ch || ch.closed) continue;
    const iso = ch.country === 'UK' ? 'GB' : ch.country;
    const country = names.get(iso); if (!country) continue;
    candidates.push({ url: u, name: ch.name, country, categories: ch.categories, network: ch.network });
    if (candidates.length >= LIMIT) break;
  }
  log(`candidates new to the pool and never judged: ${candidates.length}`);

  // judge in batches of 8
  const kept = [];
  for (let i = 0; i < candidates.length; i += 8) {
    const batch = candidates.slice(i, i + 8);
    const verdicts = await judge(batch);
    for (const v of verdicts) {
      const c = batch[v.i]; if (!c) continue;
      state.judged[c.url] = { keep: !!v.keep, kind: v.kind || 'other', at: Date.now() };
      if (v.keep) kept.push({ ...c, kind: v.kind, label: (v.label || c.name).slice(0, 48) });
    }
    if (i % 40 === 0 && i) log(`  judged ${i}/${candidates.length}, kept so far ${kept.length}`);
  }
  log(`judge kept ${kept.length}/${candidates.length}`);

  // probe survivors, 6 at a time, fastest recorded
  const verified = []; let pi = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (pi < kept.length) {
      const c = kept[pi++];
      const ms = await probe(c.url);
      if (ms !== null) { verified.push({ ...c, ms }); log(`  LIVE ${ms}ms ${c.country} · ${c.label}`); }
      else state.judged[c.url].dead = Date.now();
    }
  }));
  log(`probe verified ${verified.length}/${kept.length}`);
  writeFileSync(STATE, JSON.stringify(state));

  if (DRY || !verified.length) { log('run end' + (DRY ? ' (dry)' : ' (nothing to merge)')); return; }

  // merge: fastest first, capped per country per run, news/life ahead of other
  const rank = { news: 0, public: 1, life: 2, culture: 3, other: 4 };
  verified.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || a.ms - b.ms);
  const added = {};
  for (const v of verified) {
    const list = pool[v.country] || (pool[v.country] = []);
    if ((added[v.country] || 0) >= PER_COUNTRY_CAP) continue;
    if (list.some(s => s.url === v.url || s.label === v.label)) continue;
    list.push({ type: 'hls', url: v.url, label: v.label });
    added[v.country] = (added[v.country] || 0) + 1;
  }
  const total = Object.values(added).reduce((a, b) => a + b, 0);
  if (!total) { log('run end (all verified were duplicates)'); return; }
  gen.sources = pool;
  gen.count = Object.values(pool).reduce((a, b) => a + b.length, 0);
  gen.countries = Object.keys(pool).length;
  gen.note = (gen.note || '') .replace(/( · scout\+\d+@[^ ]+)?$/, '') + ` · scout+${total}@${new Date().toISOString().slice(0,10)}`;
  writeFileSync(GEN, JSON.stringify(gen, null, 1));
  log(`merged ${total} new streams into ${Object.keys(added).length} nations: ` + Object.entries(added).map(([k, n]) => `${k}+${n}`).join(' '));

  const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString();
  run('node scripts/inject-iptv.js');
  run('node build.js');
  log('injected + rebuilt all three targets');
  if (SHIP) {
    run('git add scripts/iptv-sources.generated.json void2-final.html copy33thevoid.html void-app/assets/void.html void-proxy/public/void.html void-proxy/public/index.html');
    run(`git commit -m "Scout: ${total} new live sources (${Object.keys(added).slice(0, 6).join(', ')})" -m "Found by the standing source agent: iptv-org catalogue, judged by ${MODEL} (live picture of its own nation; niche local over multinational), probed browser-shaped (https + CORS + playable variant), merged fastest-first, capped +${PER_COUNTRY_CAP}/nation/run." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`);
    run('git push origin HEAD');
    log('shipped - Pages will deploy the web');
  }
  log('run end');
})().catch(e => { log('FATAL ' + (e && e.message)); process.exit(1); });
