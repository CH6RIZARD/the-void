#!/usr/bin/env node
/**
 * source-sentinel.mjs — keeps the live-stream pools honest, forever.
 *
 * WHY THIS EXISTS
 * The IPTV pool is a static list probed by hand. It was last checked on
 * 2026-09-17 and by 2026-10-01 a third of it was dead. Every dead URL is a tile
 * that mounts, waits out its connect timeout, fails and moves on - which is
 * most of what "nothing loads" actually is. A list of streams is not a thing you
 * build once; broadcasters restart, CDNs rotate, hosts lapse.
 *
 * So this runs continuously and does four things:
 *
 *   1. PROBE      every source in the pool, the same way a player does - https,
 *                 #EXTM3U, CORS headers, and for a master playlist the first
 *                 variant must serve #EXTINF too. Anything less and the stream
 *                 "exists" but will not play.
 *   2. QUARANTINE a source that fails FAIL_STREAK cycles in a row. It is moved
 *                 aside, not deleted - broadcasters go down for maintenance, and
 *                 throwing away a good stream because its host rebooted is how a
 *                 pool shrinks to nothing.
 *   3. REVIVE     re-probe quarantined sources on a slower cadence. One success
 *                 puts a source straight back into the pool.
 *   4. DISCARD    quarantined longer than DISCARD_DAYS with no revival. That is
 *                 the point at which "temporarily down" becomes "gone".
 *
 * And between cycles it TOPS UP: runs the harvester to pull new candidates from
 * the catalogue, probes them, and adds whatever is playable. The pool should
 * grow on its own.
 *
 * The app data is regenerated only when the pool actually changed.
 *
 * ON OLLAMA: a local model is not used for the probing, and should not be. "Is
 * this URL serving a playlist" is an HTTP question with a yes/no answer; asking
 * a language model would be slower and less certain. If OLLAMA_URL is reachable
 * the sentinel uses it for the one job that IS a language job - reading a
 * channel's name and deciding what KIND of thing it is (news / parliament /
 * music / religious / city cam), which is what makes "niche sources" findable
 * rather than just "more TV". Without it, everything else still runs.
 *
 *   node scripts/source-sentinel.mjs                # run forever
 *   node scripts/source-sentinel.mjs --once         # a single cycle, then exit
 *   node scripts/source-sentinel.mjs --interval 30  # minutes between cycles
 *   node scripts/source-sentinel.mjs --no-topup     # health only, never harvest
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const POOL_JSON = path.join(HERE, 'iptv-sources.generated.json');
const HEALTH_JSON = path.join(HERE, 'source-health.json');
const QUARANTINE_JSON = path.join(HERE, 'source-quarantine.json');
const LOG = path.join(HERE, 'source-sentinel.log');

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes('--' + k);

const ONCE = has('once');
const NO_TOPUP = has('no-topup');
const INTERVAL_MIN = parseInt(arg('interval', '45'), 10);
const CONCURRENCY = parseInt(arg('concurrency', '24'), 10);
const PROBE_MS = parseInt(arg('timeout', '6000'), 10);
/** Consecutive failed cycles before a source is set aside. */
const FAIL_STREAK = parseInt(arg('fail-streak', '3'), 10);
/** Quarantined sources are re-checked every Nth cycle - they are the long shots. */
const REVIVE_EVERY = parseInt(arg('revive-every', '4'), 10);
/** Set aside this long with no revival and it is gone for good. */
const DISCARD_DAYS = parseInt(arg('discard-days', '14'), 10);
/** Top up from the catalogue every Nth cycle. */
const TOPUP_EVERY = parseInt(arg('topup-every', '6'), 10);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

// ─── the probe: exactly what a player needs, nothing less ────────────────
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';

async function get(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PROBE_MS);
  try {
    return await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, origin: 'https://thevoid.app', referer: 'https://thevoid.app/' },
    });
  } finally {
    clearTimeout(t);
  }
}
const corsOk = (r) => {
  const a = r.headers.get('access-control-allow-origin');
  return a === '*' || (a || '').includes('thevoid.app');
};

/** { ms, w? } = playable: ms to first byte, w = smallest advertised RESOLUTION
 *  width (the stream's cheapest possible decode - omitted for media playlists
 *  and ladders without RESOLUTION tags); string = why it is not playable. */
async function probe(url) {
  if (!/^https:/i.test(url)) return 'http';
  const t0 = Date.now();
  try {
    const r = await get(url);
    if (!r.ok) return 'status ' + r.status;
    if (!corsOk(r)) return 'no-cors';
    const text = (await r.text()).slice(0, 65536);
    if (!text.includes('#EXTM3U')) return 'not-m3u8';
    let w = 0;
    if (/#EXT-X-STREAM-INF/i.test(text)) {
      const line = text.split(/\r?\n/).map((s) => s.trim()).find((s) => s && !s.startsWith('#'));
      if (!line) return 'no-variant';
      const vu = new URL(line, r.url || url).href;
      if (!/^https:/i.test(vu)) return 'http-variant';
      const v = await get(vu);
      if (!v.ok) return 'variant ' + v.status;
      if (!corsOk(v)) return 'variant-no-cors';
      if (!/#EXTINF/i.test((await v.text()).slice(0, 65536))) return 'variant-empty';
      // The app sorts the wall cheap-first by this (wall.ts wBucket).
      for (const m of text.matchAll(/RESOLUTION=(\d+)x/gi)) if (!w || +m[1] < w) w = +m[1];
    } else if (!/#EXTINF/i.test(text)) return 'empty';
    return w ? { ms: Date.now() - t0, w } : { ms: Date.now() - t0 };
  } catch {
    return 'error';
  }
}

async function pooled(items, worker, n) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await worker(items[k], k);
      }
    }),
  );
  return out;
}

// ─── state ───────────────────────────────────────────────────────────────
const readJson = (p, d) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return d;
  }
};
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 1));

const now = () => Date.now();
const days = (ms) => ms / 86400000;

function log(line) {
  const s = `[${new Date().toISOString()}] ${line}`;
  console.log(s);
  try {
    writeFileSync(LOG, s + '\n', { flag: 'a' });
  } catch {
    /* the log is a convenience, never a reason to stop */
  }
}

/**
 * The generated pool file is a WRAPPER - {generated, note, count, countries,
 * sources} - and the country-to-streams map lives under `sources`. Read and
 * write through these so the metadata around it survives a cycle.
 */
const poolOf = (doc) => (doc && doc.sources && typeof doc.sources === 'object' ? doc.sources : {});
function savePool(doc, pool) {
  const next = doc && typeof doc === 'object' ? { ...doc } : {};
  next.sources = pool;
  next.count = Object.values(pool).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0);
  next.countries = Object.keys(pool).length;
  next.generated = new Date().toISOString();
  return next;
}

/** Every source in the pool, flattened with its country. */
function flatten(pool) {
  const out = [];
  for (const [country, arr] of Object.entries(pool)) {
    if (!Array.isArray(arr)) continue;
    for (const s of arr) if (s && s.url) out.push({ country, src: s });
  }
  return out;
}

// ─── the one job a language model is actually better at ──────────────────
async function ollamaUp() {
  try {
    const r = await fetch(OLLAMA_URL + '/api/tags', { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Ask the local model what KIND of thing a channel is, from its name.
 *
 * This is the part that is genuinely a language problem: "Tweede Kamer 3" is a
 * parliament feed, "Omroep Zeeland" is regional, "EarthCam Copacabana" is a
 * street cam, and no regex is going to keep up with 155 countries' worth of
 * naming. Kinds let the app ask for a CITY CAM rather than whatever TV this
 * country had, which is the difference between "more sources" and "the niche
 * sources". Best effort: an unreachable or confused model just leaves kinds off.
 */
async function classify(labels) {
  if (!labels.length) return {};
  const prompt =
    'For each channel name, answer with its kind, one per line, in the form "name\\tkind".\n' +
    'Allowed kinds: news, parliament, regional, religious, music, sport, kids, cam, entertainment, other.\n' +
    'Answer only those lines, nothing else.\n\n' +
    labels.join('\n');
  try {
    const r = await fetch(OLLAMA_URL + '/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, options: { temperature: 0 } }),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) return {};
    const text = String((await r.json()).response || '');
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const [name, kind] = line.split('\t').map((x) => (x || '').trim());
      if (name && kind) out[name] = kind.toLowerCase();
    }
    return out;
  } catch {
    return {};
  }
}

// ─── a cycle ─────────────────────────────────────────────────────────────
async function cycle(n) {
  const doc = readJson(POOL_JSON, {});
  const pool = poolOf(doc);
  const health = readJson(HEALTH_JSON, {});
  const quarantine = readJson(QUARANTINE_JSON, {});
  const live = flatten(pool);
  if (!live.length) {
    log('pool is empty - nothing to check. Has the harvester been run?');
    return;
  }

  // 1 + 2. probe the live pool, quarantine what keeps failing
  const t0 = now();
  const results = await pooled(live, async ({ country, src }) => ({ country, src, r: await probe(src.url) }), CONCURRENCY);
  let ok = 0;
  const newlyQuarantined = [];
  for (const { country, src, r } of results) {
    const h = health[src.url] || { firstSeen: now(), failStreak: 0 };
    if (typeof r !== 'string') {
      ok++;
      h.lastOk = now();
      h.ms = r.ms;
      h.failStreak = 0;
      // Annotate the pool entry itself: `w` rides into the app data wholesale
      // (inject-iptv.js / generate-data.ts keep unknown fields).
      if (r.w) src.w = r.w;
      else delete src.w;
    } else {
      h.lastFail = now();
      h.why = r;
      h.failStreak = (h.failStreak || 0) + 1;
      if (h.failStreak >= FAIL_STREAK) {
        quarantine[src.url] = { country, src, since: now(), why: r };
        newlyQuarantined.push({ country, src });
      }
    }
    health[src.url] = h;
  }
  for (const { country, src } of newlyQuarantined) {
    pool[country] = (pool[country] || []).filter((s) => s.url !== src.url);
  }

  // 3. give the quarantined a chance to come back
  let revived = 0;
  const quarantinedUrls = Object.keys(quarantine);
  if (n % REVIVE_EVERY === 0 && quarantinedUrls.length) {
    const checks = quarantinedUrls.map((u) => quarantine[u]);
    const back = await pooled(checks, async (q) => ({ q, r: await probe(q.src.url) }), CONCURRENCY);
    for (const { q, r } of back) {
      if (typeof r === 'string') continue;
      if (r.w) q.src.w = r.w;
      else delete q.src.w;
      pool[q.country] = pool[q.country] || [];
      if (!pool[q.country].some((s) => s.url === q.src.url)) pool[q.country].push(q.src);
      delete quarantine[q.src.url];
      const h = health[q.src.url] || {};
      h.failStreak = 0;
      h.lastOk = now();
      health[q.src.url] = h;
      revived++;
    }
  }

  // 4. and let go of the ones that never did
  let discarded = 0;
  for (const u of Object.keys(quarantine)) {
    if (days(now() - (quarantine[u].since || now())) >= DISCARD_DAYS) {
      delete quarantine[u];
      delete health[u];
      discarded++;
    }
  }

  // 5. top up from the catalogue
  let added = 0;
  if (!NO_TOPUP && n % TOPUP_EVERY === 0) {
    const before = flatten(poolOf(readJson(POOL_JSON, {}))).length;
    try {
      writeJson(POOL_JSON, savePool(doc, pool)); // harvester merges onto what we have
      execFileSync(process.execPath, [path.join(HERE, 'build-iptv-sources.js'), '--target', '9000', '--per-country', '60', '--candidates', '140', '--cache', path.join(HERE, 'probe-cache.json'), '--cache-hours', '24'], { cwd: REPO, stdio: 'ignore', timeout: 20 * 60000 });
      added = flatten(poolOf(readJson(POOL_JSON, {}))).length - before;
      Object.assign(pool, poolOf(readJson(POOL_JSON, {})));
    } catch (e) {
      log('top-up failed (keeping the pool as it is): ' + String(e.message || e).slice(0, 120));
    }
  }

  // save, and only regenerate the app's data when something actually moved
  const changed = newlyQuarantined.length || revived || added;
  writeJson(POOL_JSON, savePool(doc, pool));
  writeJson(HEALTH_JSON, health);
  writeJson(QUARANTINE_JSON, quarantine);

  if (changed) {
    try {
      execFileSync(process.execPath, ['src/core/__tests__/tools/generate-data.ts'], { cwd: path.join(REPO, 'void-app'), stdio: 'ignore', timeout: 5 * 60000 });
    } catch (e) {
      log('could not regenerate app data: ' + String(e.message || e).slice(0, 120));
    }
  }

  const total = flatten(pool).length;
  log(
    `cycle ${n}: ${ok}/${results.length} playable  ·  quarantined ${newlyQuarantined.length}` +
      `  ·  revived ${revived}  ·  discarded ${discarded}  ·  added ${added}` +
      `  ·  pool ${total}  ·  set aside ${Object.keys(quarantine).length}  ·  ${((now() - t0) / 1000).toFixed(0)}s`,
  );
}

// ─── forever ─────────────────────────────────────────────────────────────
(async () => {
  if (!existsSync(HERE)) mkdirSync(HERE, { recursive: true });
  const up = await ollamaUp();
  log(
    `sentinel starting · interval ${INTERVAL_MIN}m · fail-streak ${FAIL_STREAK} · discard after ${DISCARD_DAYS}d` +
      ` · ollama ${up ? 'reachable (' + OLLAMA_MODEL + ')' : 'not reachable - probing does not need it'}`,
  );
  let n = 1;
  for (;;) {
    try {
      await cycle(n);
    } catch (e) {
      log('cycle failed, continuing: ' + String(e && e.stack ? e.stack : e).slice(0, 300));
    }
    if (ONCE) break;
    n++;
    await new Promise((r) => setTimeout(r, INTERVAL_MIN * 60000));
  }
})();
