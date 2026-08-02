'use strict';

/**
 * The Void — social-tension proxy server.
 *
 * Feeds the client in ../void2-final.html via two endpoints:
 *   GET /feed?mode=tension&limit=40                     -> { items: [POST, ...] }
 *   GET /social?country=<name>&mode=tension&limit=30    -> { items: [POST, ...] }
 *
 * POST shape (see README):
 *   { id, platform, author, handle, country, text, url, createdAt(epoch ms),
 *     metrics:{score,replies}, media:[{type,url,thumb?}] }
 *
 * Zero-dependency: plain Node `http`. Reddit provider is keyless and always on.
 */

const http = require('http');
const { URL } = require('url');

// Load .env if present (tiny parser, no dependency).
loadDotEnv();

const PORT = process.env.PORT || 8787;

// ---------------------------------------------------------------------------
// Per-nation subreddit map. Covers the tension-ranked nations plus common ones.
// Unknown countries fall back to the global geopolitics set.
// ---------------------------------------------------------------------------
const GLOBAL_SUBS = ['worldnews', 'geopolitics', 'anime_titties', 'CombatFootage'];

const COUNTRY_SUBS = {
  'ukraine':      ['ukraine', 'UkraineWarVideoReport', 'CombatFootage', 'UkrainianConflict'],
  'russia':       ['russia', 'RussiaUkraineWar2022', 'UkraineRussiaReport'],
  'israel':       ['Israel', 'IsraelPalestine', 'CombatFootage'],
  'palestine':    ['Palestine', 'IsraelPalestine', 'IsraelCrimes'],
  'iran':         ['iran', 'NewIran', 'middleeast'],
  'syria':        ['syriancivilwar', 'syria', 'middleeast'],
  'yemen':        ['yemen', 'yemenicrisis', 'middleeast'],
  'sudan':        ['Sudan', 'Africa', 'worldnews'],
  'united states':['news', 'politics', 'PublicFreakout'],
  'usa':          ['news', 'politics', 'PublicFreakout'],
  'china':        ['China', 'Sino', 'geopolitics'],
  'taiwan':       ['taiwan', 'geopolitics'],
  'india':        ['india', 'IndiaSpeaks', 'geopolitics'],
  'pakistan':     ['pakistan', 'geopolitics'],
  'united kingdom':['unitedkingdom', 'ukpolitics'],
  'uk':           ['unitedkingdom', 'ukpolitics'],
  'france':       ['france', 'europe'],
  'germany':      ['germany', 'europe'],
  'lebanon':      ['lebanon', 'middleeast'],
  'ethiopia':     ['ethiopia', 'Africa'],
  'myanmar':      ['myanmar', 'geopolitics'],
  'venezuela':    ['vzla', 'venezuela', 'southamerica'],
  'north korea':  ['northkorea', 'geopolitics'],
  'afghanistan':  ['afghanistan', 'middleeast'],
};

function subsForCountry(country) {
  if (!country) return GLOBAL_SUBS;
  const key = String(country).trim().toLowerCase();
  return COUNTRY_SUBS[key] || GLOBAL_SUBS;
}

// ---------------------------------------------------------------------------
// Tension / controversy ranking.
//
// Heuristic combines three signals:
//   1. Engagement velocity: (score + replies) decayed by post age. Fresh posts
//      that already pulled a lot of interaction rank higher — this captures
//      "blowing up right now" energy.
//   2. Divisiveness proxy: comment-to-score ratio. Threads that generate far
//      more comments than upvotes tend to be arguments/controversy rather than
//      quiet consensus. Ratio is dampened with log to avoid tiny-score noise.
//   3. Keyword weight: presence of conflict/controversy terms in the text.
//
// The three are combined multiplicatively-ish (velocity is the base, the other
// two are boosts) so a post needs real engagement AND a controversy signal to
// float to the top.
// ---------------------------------------------------------------------------
const CONFLICT_TERMS = [
  'war', 'attack', 'strike', 'killed', 'dead', 'death', 'bomb', 'missile',
  'protest', 'riot', 'clash', 'invasion', 'occupation', 'genocide', 'massacre',
  'ceasefire', 'hostage', 'sanction', 'nuclear', 'crisis', 'coup', 'militant',
  'terror', 'refugee', 'crackdown', 'shooting', 'drone', 'ban', 'scandal',
  'controversy', 'outrage', 'condemn', 'accuse', 'clashes', 'escalate',
];

function tensionScore(post) {
  const now = Date.now();
  const ageHours = Math.max(0.5, (now - (post.createdAt || now)) / 3.6e6);
  const score = Math.max(0, (post.metrics && post.metrics.score) || 0);
  const replies = Math.max(0, (post.metrics && post.metrics.replies) || 0);

  // 1. Engagement velocity — interactions per hour, gentle age decay.
  const velocity = (score + replies) / Math.pow(ageHours, 0.8);

  // 2. Divisiveness — more comments than upvotes => argument. Log-damped.
  const divisiveness = 1 + Math.log1p(replies) / Math.log1p(score + 1);

  // 3. Keyword conflict weight.
  const text = ((post.text || '') + ' ' + (post.country || '')).toLowerCase();
  let hits = 0;
  for (const term of CONFLICT_TERMS) if (text.includes(term)) hits++;
  const keyword = 1 + Math.min(hits, 5) * 0.25; // cap the boost at +125%

  return velocity * divisiveness * keyword;
}

function rankItems(items, mode) {
  if (mode === 'tension') {
    return items
      .map((it) => ({ it, s: tensionScore(it) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.it);
  }
  // default: newest first
  return items.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ---------------------------------------------------------------------------
// Provider architecture.
//
// SocialProvider interface:
//   fetchGlobal({ mode, limit })            -> Promise<POST[]>
//   fetchByCountry({ country, mode, limit }) -> Promise<POST[]>
// ---------------------------------------------------------------------------

class SocialProvider {
  // eslint-disable-next-line no-unused-vars
  async fetchGlobal({ mode, limit }) { return []; }
  // eslint-disable-next-line no-unused-vars
  async fetchByCountry({ country, mode, limit }) { return []; }
}

// --- RedditProvider (REAL, keyless) ----------------------------------------
class RedditProvider extends SocialProvider {
  constructor() {
    super();
    this.platform = 'reddit';
    // Rotate a browser-ish UA; Reddit throttles the default node UA harshly.
    this.ua = 'Mozilla/5.0 (compatible; VoidProxy/1.0; +https://example.com)';
  }

  // Pull hot + rising + controversial for a set of subs and merge/dedupe.
  async fetchFromSubs(subs, country, limit) {
    const listings = ['hot', 'rising', 'controversial'];
    const perSub = Math.max(5, Math.ceil((limit * 2) / subs.length));
    const tasks = [];
    for (const sub of subs) {
      for (const listing of listings) {
        tasks.push(this.fetchListing(sub, listing, perSub, country));
      }
    }
    const results = await Promise.allSettled(tasks);
    const seen = new Set();
    const out = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const post of r.value) {
        if (seen.has(post.id)) continue;
        seen.add(post.id);
        out.push(post);
      }
    }
    return out;
  }

  async fetchListing(sub, listing, limit, country) {
    const q = listing === 'controversial' ? '?t=day&limit=' : '?limit=';
    const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/${listing}.json${q}${limit}`;
    const data = await getJson(url, { 'User-Agent': this.ua });
    const children = (data && data.data && data.data.children) || [];
    return children
      .map((c) => this.mapPost(c.data, country))
      .filter(Boolean);
  }

  mapPost(d, country) {
    if (!d || d.stickied || d.over_18 == null) { /* still allow, just guard */ }
    if (!d || !d.id) return null;

    const media = this.extractMedia(d);
    const text = d.title || d.selftext || '';

    return {
      id: 'reddit_' + d.id,
      platform: 'reddit',
      author: d.author || 'unknown',
      handle: 'u/' + (d.author || 'unknown'),
      country: country || '',
      text: text,
      url: d.permalink ? 'https://www.reddit.com' + d.permalink : (d.url || ''),
      createdAt: d.created_utc ? Math.round(d.created_utc * 1000) : Date.now(),
      metrics: {
        score: typeof d.score === 'number' ? d.score : (d.ups || 0),
        replies: d.num_comments || 0,
      },
      media,
    };
  }

  extractMedia(d) {
    const media = [];
    try {
      // Reddit-hosted video.
      if (d.is_video && d.media && d.media.reddit_video && d.media.reddit_video.fallback_url) {
        media.push({
          type: 'video',
          url: d.media.reddit_video.fallback_url,
          thumb: cleanUrl(d.thumbnail && d.thumbnail.startsWith('http') ? d.thumbnail : undefined),
        });
        return media;
      }
      // Preview images.
      if (d.preview && Array.isArray(d.preview.images) && d.preview.images.length) {
        const img = d.preview.images[0];
        const src = img.source && img.source.url;
        if (src) {
          media.push({ type: 'image', url: cleanUrl(src) });
          return media;
        }
      }
      // Gallery -> first image.
      if (d.is_gallery && d.media_metadata) {
        const first = Object.values(d.media_metadata)[0];
        if (first && first.s && (first.s.u || first.s.gif)) {
          media.push({ type: 'image', url: cleanUrl(first.s.u || first.s.gif) });
          return media;
        }
      }
      // Direct image link.
      if (typeof d.url === 'string' && /\.(jpe?g|png|gif|webp)$/i.test(d.url)) {
        media.push({ type: 'image', url: d.url });
      }
    } catch (_) { /* ignore malformed media */ }
    return media;
  }

  async fetchGlobal({ limit }) {
    return this.fetchFromSubs(GLOBAL_SUBS, '', limit || 40);
  }

  async fetchByCountry({ country, limit }) {
    return this.fetchFromSubs(subsForCountry(country), country || '', limit || 30);
  }
}

// --- XProvider (keyed, optional) -------------------------------------------
// Uses Twitter/X API v2 recent search only when X_BEARER is set. Never hardcode
// a key — read it from the environment. Inert (returns []) with no key.
class XProvider extends SocialProvider {
  constructor() {
    super();
    this.bearer = process.env.X_BEARER || '';
    this.platform = 'x';
  }

  get enabled() { return !!this.bearer; }

  async search(query, limit) {
    if (!this.enabled) return [];
    const max = Math.min(Math.max(limit || 10, 10), 100); // API v2 min 10, max 100
    const params = new URLSearchParams({
      query: query + ' -is:retweet',
      max_results: String(max),
      'tweet.fields': 'created_at,public_metrics,author_id,lang',
      expansions: 'author_id,attachments.media_keys',
      'user.fields': 'username,name',
      'media.fields': 'type,url,preview_image_url',
    });
    const url = 'https://api.twitter.com/2/tweets/search/recent?' + params.toString();
    const data = await getJson(url, { 'Authorization': 'Bearer ' + this.bearer });
    return this.mapResponse(data);
  }

  mapResponse(data) {
    if (!data || !Array.isArray(data.data)) return [];
    const users = {};
    const mediaByKey = {};
    const inc = data.includes || {};
    for (const u of inc.users || []) users[u.id] = u;
    for (const m of inc.media || []) mediaByKey[m.media_key] = m;

    return data.data.map((t) => {
      const u = users[t.author_id] || {};
      const pm = t.public_metrics || {};
      const media = [];
      const keys = (t.attachments && t.attachments.media_keys) || [];
      for (const k of keys) {
        const m = mediaByKey[k];
        if (!m) continue;
        if (m.type === 'video' || m.type === 'animated_gif') {
          media.push({ type: 'video', url: m.url || '', thumb: m.preview_image_url });
        } else if (m.url) {
          media.push({ type: 'image', url: m.url });
        }
      }
      return {
        id: 'x_' + t.id,
        platform: 'x',
        author: u.name || u.username || 'unknown',
        handle: '@' + (u.username || 'unknown'),
        country: '',
        text: t.text || '',
        url: u.username ? `https://x.com/${u.username}/status/${t.id}` : `https://x.com/i/status/${t.id}`,
        createdAt: t.created_at ? Date.parse(t.created_at) : Date.now(),
        metrics: {
          score: (pm.like_count || 0) + (pm.retweet_count || 0),
          replies: pm.reply_count || 0,
        },
        media,
      };
    });
  }

  async fetchGlobal({ limit }) {
    return this.search('(war OR crisis OR protest OR strike) lang:en', limit).catch(() => []);
  }

  async fetchByCountry({ country, limit }) {
    if (!country) return this.fetchGlobal({ limit });
    return this.search(`"${country}" (war OR crisis OR protest OR attack)`, limit).catch(() => []);
  }
}

// --- ThreadsProvider (stub) ------------------------------------------------
// Meta's Threads has no public read/search API for arbitrary content (the
// Threads API only lets an app read/publish for its OWN authenticated user,
// not a global firehose). There is therefore no keyless or key-based way to
// pull a public tension feed. This provider is intentionally inert. To add a
// real adapter later, implement fetchGlobal/fetchByCountry here (e.g. via an
// authorized Threads Graph API token or a licensed data partner) and map the
// response to the POST shape — the seam is ready.
class ThreadsProvider extends SocialProvider {
  constructor() { super(); this.platform = 'threads'; }
  async fetchGlobal() { return []; }
  async fetchByCountry() { return []; }
}

// ---------------------------------------------------------------------------
// Provider registry + aggregation. If any provider throws, it is skipped.
// ---------------------------------------------------------------------------
const PROVIDERS = [new RedditProvider(), new XProvider(), new ThreadsProvider()];

async function aggregateGlobal({ mode, limit }) {
  const results = await Promise.allSettled(
    PROVIDERS.map((p) => p.fetchGlobal({ mode, limit }))
  );
  return collect(results, mode, limit);
}

async function aggregateByCountry({ country, mode, limit }) {
  const results = await Promise.allSettled(
    PROVIDERS.map((p) => p.fetchByCountry({ country, mode, limit }))
  );
  return collect(results, mode, limit).map((it) => ({ ...it, country: it.country || country || '' }));
}

function collect(results, mode, limit) {
  const items = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) items.push(...r.value);
    // rejected providers are simply skipped
  }
  const ranked = rankItems(items, mode);
  return ranked.slice(0, limit || 40);
}

// ---------------------------------------------------------------------------
// In-memory TTL cache, keyed by endpoint+params.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

async function cached(key, producer) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.t < CACHE_TTL_MS) return hit.v;
  const v = await producer();
  cache.set(key, { t: now, v });
  return v;
}

// ---------------------------------------------------------------------------
// HTTP layer.
// ---------------------------------------------------------------------------
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

    const u = new URL(req.url, `http://localhost:${PORT}`);
    const path = u.pathname;
    const mode = u.searchParams.get('mode') || 'tension';
    const limit = clampInt(u.searchParams.get('limit'), 40, 1, 100);

    if (path === '/feed') {
      const key = `feed|${mode}|${limit}`;
      const items = await cached(key, () => aggregateGlobal({ mode, limit }));
      return sendJson(res, 200, { items });
    }

    if (path === '/social') {
      const country = u.searchParams.get('country') || '';
      const key = `social|${country.toLowerCase()}|${mode}|${limit}`;
      const items = await cached(key, () => aggregateByCountry({ country, mode, limit }));
      return sendJson(res, 200, { items });
    }

    if (path === '/' || path === '/health') {
      return sendJson(res, 200, {
        ok: true,
        endpoints: ['/feed?mode=tension&limit=40', '/social?country=<name>&mode=tension&limit=30'],
        providers: PROVIDERS.map((p) => ({ platform: p.platform, enabled: p.enabled !== false })),
      });
    }

    return sendJson(res, 404, { error: 'not found', items: [] });
  } catch (err) {
    // Never 500 the whole response with an empty body — return an empty feed.
    console.error('[void-proxy] handler error:', err && err.message);
    return sendJson(res, 200, { items: [], error: 'internal' });
  }
});

server.listen(PORT, () => {
  console.log(`[void-proxy] listening on http://localhost:${PORT}`);
  console.log(`[void-proxy] providers: reddit(on)` +
    `, x(${process.env.X_BEARER ? 'on' : 'off — set X_BEARER'})` +
    `, threads(stub)`);
});

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------
function clampInt(v, dflt, min, max) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

// Reddit HTML-encodes preview URLs (&amp;). Decode for a usable src.
function cleanUrl(u) {
  if (!u) return u;
  return String(u).replace(/&amp;/g, '&');
}

// Fetch JSON. Uses global fetch (Node 18+); falls back to https otherwise.
async function getJson(url, headers) {
  headers = headers || {};
  if (typeof fetch === 'function') {
    const r = await fetch(url, { headers, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
  }
  // Fallback for older Node.
  return new Promise((resolve, reject) => {
    const https = require('https');
    https.get(url, { headers }, (resp) => {
      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        resp.resume();
        return reject(new Error(`HTTP ${resp.statusCode} for ${url}`));
      }
      let data = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { data += c; });
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Minimal .env loader (KEY=VALUE per line, # comments). No dependency.
function loadDotEnv() {
  try {
    const fs = require('fs');
    const p = require('path').join(__dirname, '.env');
    if (!fs.existsSync(p)) return;
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch (_) { /* ignore */ }
}

module.exports = { tensionScore, rankItems, subsForCountry, RedditProvider, XProvider, ThreadsProvider };
