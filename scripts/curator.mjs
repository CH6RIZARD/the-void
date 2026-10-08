#!/usr/bin/env node
/**
 * curator.mjs — the standing clip-labeling agent for the reels wall.
 *
 * The proxy's /reels is a firehose: whatever Bluesky and X surfaced as video in
 * the last day, ranked by raw engagement. Engagement does not know a bodycam
 * clip from a cat video, and the wall is a news-and-current-events feed, so
 * something has to look at each clip once and say what it is. That is this
 * agent, run in a loop on the local box:
 *
 *   1. SCOUT  the proxy's /reels, two Bluesky video feed generators and a
 *             48h top-posts search for incident words. Sequential, 8s each,
 *             polite UA - these are public endpoints with soft rate limits.
 *   2. KEY    each clip by its content (video cid for bsky, url otherwise), so
 *             the same clip reposted by a second account is one clip, and a
 *             clip judged once is never judged again.
 *   3. LABEL  the new ones with a local LLM (Ollama, qwen2.5:3b, JSON output,
 *             temperature 0): genre, topic, how much it is the kind of fresh
 *             real-world clip people share and argue about, graphic or not,
 *             and one clean caption. Measured: one warm 5-clip batch is tens
 *             of seconds on this CPU, so a pass labels at most 6 batches and
 *             the rest wait for the next pass.
 *   4. STORE  scripts/curated.json (everything labeled, 72h window) and
 *             scripts/curated.public.json (the top 60 by fit, likes and
 *             freshness) which the proxy serves. Writes are tmp+rename so a
 *             reader never sees half a file.
 *
 * Run it:
 *
 *   node scripts/curator.mjs              # loop, every 5 min
 *   node scripts/curator.mjs --once       # one pass
 *   node scripts/curator.mjs --once --dry # label, write nothing
 *
 * Env: OLLAMA_URL, CURATOR_MODEL, PROXY_BASE, CURATOR_EVERY_MS.
 * Ollama down -> logged once, scouting still runs, labeling waits.
 */
import { readFileSync, writeFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STORE = path.join(ROOT, 'scripts', 'curated.json');
const PUBLIC = path.join(ROOT, 'scripts', 'curated.public.json');
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
// Nothing else keeps the server up: the tray app was stopped because it re-warms
// the model into RAM during builds, and the install on D: sat on a drive that
// went write-protected. The server runs in its own scheduled task (VoidOllama ->
// E:\Ollama\serve.cmd, at logon); a pass that finds it down fires that task. It
// is not spawned from here: a child of this process died with the pass.
const OLLAMA_TASK = process.env.OLLAMA_TASK || 'VoidOllama';

const ollamaUp = () => fetch(OLLAMA + '/api/tags').then(r => r.ok).catch(() => false);
async function ensureOllama() {
  if (await ollamaUp()) return true;
  try { execFileSync('schtasks', ['/run', '/tn', OLLAMA_TASK], { stdio: 'ignore', timeout: 20000 }); }
  catch (e) { log('  could not run task ' + OLLAMA_TASK + ': ' + e.message); return false; }
  for (let i = 0; i < 30; i++) { // the server answers within a few seconds; the model loads on first use
    await new Promise(r => setTimeout(r, 1000));
    if (await ollamaUp()) { log('  started ollama via task ' + OLLAMA_TASK); return true; }
  }
  return false;
}
const MODEL = process.env.CURATOR_MODEL || 'qwen2.5:3b';
const PROXY = process.env.PROXY_BASE || 'https://void-proxy-production.up.railway.app';
const EVERY = parseInt(process.env.CURATOR_EVERY_MS, 10) || 5 * 60 * 1000;
const UA = 'void-curator/1';
const FEEDS = [
  'at://did:plc:muhesxre7yfcuqi5ss2fskjc/app.bsky.feed.generator/aaaouj7mhcsuq',
  'at://did:plc:6i6n57nrkq6xavqbdo6bvkqr/app.bsky.feed.generator/og-videos-kps',
];
const TERMS = ['footage', 'police', 'protest', 'breaking'];
const BATCH = 5, MAX_BATCHES = 6, KEEP_MS = 72 * 3600e3, PUBLIC_N = 60;

const args = process.argv.slice(2);
const ONCE = args.includes('--once');
const DRY = args.includes('--dry');
const log = (m) => console.log(new Date().toISOString() + ' ' + m);

async function getJSON(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(r.status + ' ' + (await r.text().catch(() => '')).slice(0, 80));
    return await r.json();
  } catch (e) { log(`  fetch failed ${url.slice(0, 80)}: ${e.message}`); return null; }
  finally { clearTimeout(t); }
}

// ─── 1. scout ───────────────────────────────────────────────────────────────
// Everything is normalised to one shape so the labeler and the store never
// care where a clip came from.
function fromBskyPost(post) {
  const e = post && post.embed;
  if (!e || !e.playlist) return null;
  return {
    platform: 'bluesky',
    text: (post.record && post.record.text) || '',
    createdAt: (post.record && post.record.createdAt) || post.indexedAt || new Date().toISOString(),
    likes: post.likeCount || 0, reposts: post.repostCount || 0,
    video: e.playlist, thumb: e.thumbnail || '',
    url: post.uri && post.author ? `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split('/').pop()}` : '',
    graphic: (post.labels || []).some(l => /graphic|gore|corpse|violence|nudity|porn|sexual/i.test(l.val || '')),
  };
}

async function scout() {
  const out = [];
  const reels = await getJSON(`${PROXY}/reels?limit=30`);
  for (const it of (reels && reels.items) || []) {
    const v = (it.media || []).find(m => m.type === 'video' && m.url);
    if (!v) continue;
    out.push({ platform: it.platform || 'x', text: it.text || '', createdAt: it.createdAt, likes: (it.metrics && it.metrics.score) || 0, reposts: 0, video: v.url, thumb: v.thumb || '', url: it.url || '', graphic: !!it.graphic });
  }
  for (const f of FEEDS) {
    const d = await getJSON(`https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=${encodeURIComponent(f)}&limit=50`);
    for (const fi of (d && d.feed) || []) { const c = fromBskyPost(fi.post); if (c) out.push(c); }
  }
  const since = new Date(Date.now() - 48 * 3600e3).toISOString();
  for (const q of TERMS) {
    const d = await getJSON(`https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${q}&sort=top&since=${since}&limit=50`);
    for (const p of (d && d.posts) || []) { const c = fromBskyPost(p); if (c) out.push(c); }
  }
  return out;
}

// ─── 2. key ─────────────────────────────────────────────────────────────────
function keyOf(video) {
  const m = /\/watch\/[^/]+\/([a-z0-9]{20,})\//i.exec(video);
  return m ? 'cid:' + m[1] : video.split('?')[0];
}

// ─── 3. label ───────────────────────────────────────────────────────────────
const SYSTEM = `You label short video clips for a news-and-current-events feed. Reply JSON only: {"items":[{"i":<n>,"genre":"news"|"politics"|"conflict"|"crime"|"accident"|"protest"|"sport"|"entertainment"|"hobby"|"art"|"animals"|"other","topic":"<short phrase>","viral_news_fit":<0-1, how much this is a fresh real-world incident clip people share and argue about: bodycam, caught on camera, strikes, protests, breaking>,"graphic":<true|false: blood, death, serious injury, war footage>,"caption":"<one clean line, max 110 chars>"}]}. One entry per numbered input line.`;

async function labelBatch(batch) {
  const lines = batch.map((c, i) => `${i}. ${c.platform} | ${c.text.replace(/\s+/g, ' ').slice(0, 240)} | likes ${c.likes} | age ${Math.max(0, Math.round((Date.now() - Date.parse(c.createdAt)) / 3600e3))}h`).join('\n');
  // keep_alive 2m: the model leaves RAM between passes. On this 16 GB laptop a
  // resident 2 GB model made release builds take 35 min; the reload is ~10 s a pass.
  const body = { model: MODEL, stream: false, format: 'json', keep_alive: '2m', options: { temperature: 0, num_ctx: 2048 }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: lines }] };
  // A complete answer returns at once; an incomplete one is retried once and
  // the fuller of the two is kept. The old all-or-nothing rule threw away 3-4
  // good labels whenever the 3B model dropped one index, which on this CPU it
  // did in 4 of 6 batches (20 errors, 5 labels a pass, 2026-10-08). What is
  // missing is simply left for the next pass.
  // A refused connection is Ollama going away mid-pass (it crash-loops when
  // D: drops its blob store), not a bad answer: that returns 'down' so the
  // pass stops labeling instead of burning every remaining clip as an error.
  let best = null;
  for (let t = 0; t < 2; t++) {
    let r;
    try { r = await fetch(OLLAMA + '/api/chat', { method: 'POST', body: JSON.stringify(body) }); }
    catch { return 'down'; }
    try {
      const out = JSON.parse((await r.json()).message.content);
      const by = new Map((out.items || []).map(x => [Number(x.i), x]));
      if (batch.every((_, i) => by.has(i))) return by;
      if (!best || by.size > best.size) best = by;
      log(`  label batch incomplete (${t + 1}/2): ${by.size}/${batch.length}`);
    } catch (e) { log(`  label batch failed (${t + 1}/2): ${e.message}`); }
  }
  return best && best.size ? best : null;
}

// ─── 4. store ───────────────────────────────────────────────────────────────
function writeAtomic(file, data) { writeFileSync(file + '.tmp', JSON.stringify(data)); renameSync(file + '.tmp', file); }

function rank(c, now) {
  const fresh = Math.max(0, 1 - (now - Date.parse(c.createdAt)) / KEEP_MS); // 1 now -> 0 at 72h
  return c.fit * 0.6 + Math.log10(1 + c.likes) * 0.1 + fresh;
}

const KEY_FILE = process.env.CURATOR_KEY_FILE || 'E:/tmp/curator.key';
function curatorKey() {
  if (process.env.CURATOR_KEY) return process.env.CURATOR_KEY;
  try { return readFileSync(KEY_FILE, 'utf8').trim(); } catch { return ''; }
}
async function pushCurated(items) {
  const key = curatorKey();
  if (!key) { log('push skipped: no CURATOR_KEY (env or ' + KEY_FILE + ')'); return; }
  try {
    const r = await fetch(PROXY + '/curated/ingest', { method: 'POST', headers: { 'content-type': 'application/json', 'x-curator-key': key, 'user-agent': 'void-curator/1' }, body: JSON.stringify({ generated: new Date().toISOString(), items }), signal: AbortSignal.timeout(45000) }); // 60 clips over a slow uplink timed out at 15 s
    const t = await r.text();
    log('push ' + r.status + ' ' + t.slice(0, 80));
  } catch (e) { log('push failed: ' + (e && e.message)); }
}

const LOCK = path.join(ROOT, 'scripts', '.curator.lock');
function takeLock() {
  try {
    const st = statSync(LOCK);
    // The lock names its pass; a pass that was killed (a manual run ended with
    // its shell, 2026-10-08) leaves a lock its pid no longer answers for, and
    // that blocked every scheduled pass for the two hours the age rule allowed.
    const pid = Number(readFileSync(LOCK, 'utf8')) || 0;
    let alive = false;
    try { process.kill(pid, 0); alive = pid > 0; } catch { /* no such process */ }
    if (alive && Date.now() - st.mtimeMs < 2 * 60 * 60 * 1000) return false; // a live pass; a 2h-old lock is a crash
  } catch { /* no lock */ }
  writeFileSync(LOCK, String(process.pid));
  return true;
}
function dropLock() { try { unlinkSync(LOCK); } catch { /* */ } }

async function pass() {
  const t0 = Date.now();
  let store = { generated: '', items: {} };
  try { store = JSON.parse(readFileSync(STORE, 'utf8')); } catch {}
  const items = store.items || (store.items = {});

  const scouted = await scout();
  const fresh = new Map();
  for (const c of scouted) { const k = keyOf(c.video); if (!items[k] && !fresh.has(k)) fresh.set(k, { key: k, ...c }); }
  const queue = [...fresh.values()];

  let labeled = 0, errors = 0;
  const up = queue.length ? await ensureOllama() : true;
  if (!up) log('  ollama unreachable at ' + OLLAMA + ' - labeling skipped this pass');
  for (let b = 0; up && b < MAX_BATCHES && b * BATCH < queue.length; b++) {
    const batch = queue.slice(b * BATCH, (b + 1) * BATCH);
    const tb = Date.now();
    const by = await labelBatch(batch);
    if (by === 'down') { log(`  ollama went away during batch ${b + 1} - rest waits for next pass`); break; }
    log(`  batch ${b + 1}: ${batch.length} clips ${Date.now() - tb}ms ${by ? 'ok' : 'FAILED'}`);
    batch.forEach((c, i) => {
      const v = by && by.get(i);
      const now = new Date().toISOString();
      if (!v) {
        if (by && by.size) return; // dropped from a partial answer: not stored, so the next pass asks again
        errors++; items[c.key] = { ...c, error: true, labeledAt: now }; return; // a dead batch is remembered so it is not retried every pass
      }
      labeled++;
      items[c.key] = { ...c, caption: String(v.caption || c.text).slice(0, 110), genre: String(v.genre || 'other'), topic: String(v.topic || ''), fit: Math.min(1, Math.max(0, Number(v.viral_news_fit) || 0)), graphic: c.graphic || v.graphic === true, labeledAt: now };
    });
  }

  const now = Date.now();
  for (const k in items) if (now - Date.parse(items[k].createdAt) > KEEP_MS) delete items[k];
  const pub = Object.values(items).filter(c => !c.error).sort((a, b) => rank(b, now) - rank(a, now)).slice(0, PUBLIC_N);
  if (!DRY) {
    store.generated = new Date().toISOString();
    writeAtomic(STORE, store);
    writeAtomic(PUBLIC, { generated: store.generated, items: pub });
  }
  log(`pass: scouted ${scouted.length}, new ${queue.length}, labeled ${labeled}, errors ${errors}, store ${Object.keys(items).length}, public ${pub.length}, ${Date.now() - t0}ms${DRY ? ' (dry)' : ''}`);
  // PUSH, BECAUSE THE PROXY CANNOT READ THIS DISK. Railway serves /curated from
  // memory, replaced wholesale on each push and empty again after a redeploy, so
  // every pass re-sends the public set. The key lives in CURATOR_KEY (or
  // E:/tmp/curator.key on this PC); never in the repo. Missing key = no push,
  // the file is still written for a manual curl.
  if (!DRY && pub.length) await pushCurated(pub);
  if (DRY) for (const c of Object.values(items).filter(c => !c.error && c.labeledAt >= new Date(t0).toISOString()).slice(0, 3)) log(`  sample ${c.genre} fit=${c.fit} graphic=${c.graphic} "${c.caption}"`);
}

(async () => {
  log(`curator start (once=${ONCE} dry=${DRY} model=${MODEL})`);
  for (;;) {
    if (!takeLock()) { log('another pass is running - skipped'); if (ONCE) break; await new Promise(r => setTimeout(r, EVERY)); continue; }
    try { await pass(); } catch (e) { log('pass failed: ' + (e && e.message)); } finally { dropLock(); }
    if (ONCE) break;
    await new Promise(r => setTimeout(r, EVERY));
  }
})();
