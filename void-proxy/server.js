'use strict';

/**
 * The Void — social-tension proxy server.
 *
 * Feeds the client in ../void2-final.html via two endpoints:
 *   GET /feed?mode=tension&limit=40&offset=0             -> { items, nextOffset, total }
 *   GET /social?country=<name>&mode=tension&limit=30&offset=0 -> { items, nextOffset, total }
 *   GET /reels?limit=30&offset=0                         -> { items, nextOffset, total }
 *   Every POST carries provenance: { sourceHost, responseHash } (client requires it).
 *
 * POST shape (see README):
 *   { id, platform, author, handle, country, text, url, createdAt(epoch ms),
 *     metrics:{score,replies}, media:[{type,url,thumb?}] }
 *
 * Zero-dependency: plain Node `http`. Reddit provider is keyless and always on.
 */

const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const { URL } = require('url');

// Load .env if present (tiny parser, no dependency).
loadDotEnv();

const PORT = process.env.PORT || 8787;

// ---------------------------------------------------------------------------
// Per-nation subreddit map. Covers the tension-ranked nations plus common ones.
// Unknown countries fall back to the global geopolitics set.
// ---------------------------------------------------------------------------
// r/CombatFootage and r/PublicFreakout were dropped: graphic-content subs are the
// ones Reddit's API reviewers question, and approval gates every other sub here.
const GLOBAL_SUBS = ['worldnews', 'geopolitics', 'anime_titties'];
// A global-only source list cannot surface a fast-moving story from a country
// whose subreddit is not already one of the usual large-world-news communities.
// Keep this deliberately small: it is a signal lane, not a replacement for the
// broad feed. High-engagement local reporting can now enter the global ranker.
const REGIONAL_ALERT_SUBS = [{ sub: 'Nepal', country: 'Nepal' }];

const COUNTRY_SUBS = {
  'ukraine':      ['ukraine', 'UkraineWarVideoReport', 'UkrainianConflict'],
  'russia':       ['russia', 'RussiaUkraineWar2022', 'UkraineRussiaReport'],
  'israel':       ['Israel', 'IsraelPalestine'],
  'palestine':    ['Palestine', 'IsraelPalestine', 'IsraelCrimes'],
  'iran':         ['iran', 'NewIran', 'middleeast'],
  'syria':        ['syriancivilwar', 'syria', 'middleeast'],
  'yemen':        ['yemen', 'yemenicrisis', 'middleeast'],
  'sudan':        ['Sudan', 'Africa', 'worldnews'],
  'united states':['news', 'politics'],
  'usa':          ['news', 'politics'],
  'china':        ['China', 'Sino', 'geopolitics'],
  'taiwan':       ['taiwan', 'geopolitics'],
  'india':        ['india', 'IndiaSpeaks', 'geopolitics'],
  'pakistan':     ['pakistan', 'geopolitics'],
  'nepal':        ['Nepal', 'NepalSocial', 'SouthAsia'],
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
  // Disasters / mass-casualty events. Without these a flood or earthquake that
  // kills hundreds scored like a cat photo (the Nepal tragedy never ranked).
  'flood', 'floods', 'earthquake', 'landslide', 'avalanche', 'collapse', 'stampede',
  'crash', 'disaster', 'tragedy', 'missing', 'rescue', 'curfew', 'evacuate',
  'casualties', 'victims', 'cyclone', 'typhoon', 'hurricane', 'wildfire', 'explosion',
];
// Whole-word matching: substring matching scored "software" as war and "urban" as ban.
const CONFLICT_RE = new RegExp('\\b(' + CONFLICT_TERMS.join('|') + ')\\b', 'g');

// Same story from several subs/platforms = corroboration, a strong breaking signal.
// collect() counts sources per story key; the score gets 1 + 0.3*log2(n).
function storyKey(post) {
  if (post.link) return 'l:' + String(post.link).replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').toLowerCase();
  const t = String(post.text || '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return t.length > 24 ? 't:' + t.slice(0, 90) : null;
}

function velocityOf(post) {
  const now = Date.now();
  const ageHours = Math.max(0.5, (now - (post.createdAt || now)) / 3.6e6);
  const score = Math.max(0, (post.metrics && post.metrics.score) || 0);
  const replies = Math.max(0, (post.metrics && post.metrics.replies) || 0);
  return (score + replies) / Math.pow(ageHours, 0.8);
}

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
  const hits = new Set(text.match(CONFLICT_RE) || []).size;
  const keyword = 1 + Math.min(hits, 5) * 0.25; // cap the boost at +125%

  // 4. Corroboration — set by collect() when the same story arrives from n sources.
  const corroboration = 1 + 0.3 * Math.log2(Math.max(1, post._sources || 1));

  return velocity * divisiveness * keyword * corroboration;
}

function rankItems(items, mode) {
  if (mode === 'tension') {
    return items
      .map((it) => ({ it, s: tensionScore(it) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.it);
  }
  // The client rotates tension / hot / recent. 'hot' used to fall through to
  // newest-first, so a third of pages silently ignored engagement.
  if (mode === 'hot') {
    return items
      .map((it) => ({ it, s: velocityOf(it) * (1 + 0.3 * Math.log2(Math.max(1, it._sources || 1))) }))
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

// --- Reddit OAuth ----------------------------------------------------------
// Unauthenticated www.reddit.com/*.json answers 403 from anything that looks
// like a server, so the keyless path only ever worked from a browser-ish IP.
// With a registered "script" app (reddit.com/prefs/apps) the same listings come
// from oauth.reddit.com at 100 req/min instead of 10.
//
// Application-only client_credentials: no user login, no refresh token, just the
// app's own identity. Credentials absent => every call below no-ops and the
// provider falls back to the keyless host, so an unconfigured deploy still runs.
//
// Reddit requires a unique, descriptive User-Agent and rate-limits generic ones
// harder than it rate-limits anything else.
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || '';
const REDDIT_SECRET = process.env.REDDIT_SECRET || '';
const REDDIT_UA = process.env.REDDIT_USER_AGENT ||
  ('nodejs:void-proxy:1.1 (by /u/' + (process.env.REDDIT_USERNAME || 'unknown') + ')');
const redditAuthed = () => !!(REDDIT_CLIENT_ID && REDDIT_SECRET);

let _rToken = { value: '', exp: 0 };
let _rTokenWarned = false;

// Returns a bearer token, or '' to mean "use the keyless path". Tokens last an
// hour; renew a minute early so a request never races the expiry.
async function redditToken() {
  if (!redditAuthed()) return '';
  if (_rToken.value && Date.now() < _rToken.exp) return _rToken.value;
  try {
    const basic = Buffer.from(REDDIT_CLIENT_ID + ':' + REDDIT_SECRET).toString('base64');
    const d = await postForm('https://www.reddit.com/api/v1/access_token',
      { grant_type: 'client_credentials' },
      { 'Authorization': 'Basic ' + basic, 'User-Agent': REDDIT_UA });
    if (!d || !d.access_token) throw new Error('no access_token in response');
    _rToken = { value: d.access_token, exp: Date.now() + Math.max(60, (d.expires_in || 3600) - 60) * 1000 };
    _rTokenWarned = false;
    return _rToken.value;
  } catch (e) {
    // Warn once per failure streak, then degrade quietly to the keyless host.
    if (!_rTokenWarned) { console.error('[void-proxy] reddit token failed, falling back to keyless:', e && e.message); _rTokenWarned = true; }
    _rToken = { value: '', exp: 0 };
    return '';
  }
}

// --- RedditProvider (REAL, keyless or OAuth) --------------------------------
class RedditProvider extends SocialProvider {
  constructor() {
    super();
    this.platform = 'reddit';
    // Authenticated calls must send the descriptive UA Reddit's rules ask for;
    // the keyless fallback still needs a browser-ish one or it is throttled hard.
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
    // oauth.reddit.com serves the same listing shape as www, so mapPost is
    // unchanged — only the host and the headers differ.
    const token = await redditToken();
    const host = token ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
    const url = `${host}/r/${encodeURIComponent(sub)}/${listing}.json${q}${limit}`;
    const headers = token
      ? { 'Authorization': 'Bearer ' + token, 'User-Agent': REDDIT_UA }
      : { 'User-Agent': this.ua };
    const data = await getJson(url, headers);
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
      // The external article, separate from the Reddit permalink, so the client's
      // same-article dedupe/corroboration (_link) and storyKey() can see it.
      link: d.url && !/^https?:\/\/(www\.|old\.)?reddit\.com\//.test(d.url) && !d.is_self ? d.url : '',
      createdAt: d.created_utc ? Math.round(d.created_utc * 1000) : Date.now(),
      metrics: {
        score: typeof d.score === 'number' ? d.score : (d.ups || 0),
        replies: d.num_comments || 0,
      },
      // Same rule the app applies to Reddit it reads directly: NSFW/spoiler goes
      // behind the veil. The client maps this to _graphic; it never drops it.
      graphic: !!(d.over_18 || d.spoiler),
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
    const n = limit || 40;
    const broad = this.fetchFromSubs(GLOBAL_SUBS, '', n);
    const regional = REGIONAL_ALERT_SUBS.map(({ sub, country }) =>
      this.fetchFromSubs([sub], country, Math.max(10, Math.ceil(n / 6)))
    );
    const results = await Promise.allSettled([broad, ...regional]);
    return results.flatMap((r) => r.status === 'fulfilled' ? r.value : []);
  }

  async fetchByCountry({ country, limit }) {
    return this.fetchFromSubs(subsForCountry(country), country || '', limit || 30);
  }
}

// --- X spend budget --------------------------------------------------------
// X bills per post READ (pay-per-use is $0.005 each), so every item this
// provider returns costs money. Four limits, all env-tunable:
//   X_DAILY_POSTS  ceiling on posts read per UTC day (0 = X off entirely)
//   X_MAX_RESULTS  posts per API call (10 is the API's own minimum, and ours)
//   X_CACHE_MS     how long one query's result is reused before paying again
//   X_MAX_SHARE    fraction of a returned page that may be X items
//
// The cap is GLOBAL, not per user, and that is the cheap direction: this proxy
// answers every user from one shared cache, so a per-user budget would mean
// per-user fetches — more calls, not fewer. Capping globally means the second
// user through the door reads the first user's posts for free.
//
// The counter lives in a file so a restart loop cannot re-spend the day's
// budget. On an ephemeral host (Railway, Fly) the file dies with the container;
// the cap then protects a running day, not a redeploy day.
const X_DAILY_POSTS = intEnv('X_DAILY_POSTS', 1000);   // 1000 x $0.005 = $5/day ceiling
const X_MAX_RESULTS = intEnv('X_MAX_RESULTS', 10);
// 60 min: the global feed runs X_GLOBAL_QUERIES.length (3) queries per refresh,
// so at the old 15 min it would read 3 x 10 x 96 = 2880 posts/day, past the
// budget by noon. 60 min is 3 x 10 x 24 = 720 for the feed, leaving room for
// /reels (240) under the 1000 ceiling. Eyewitness posts age fine over an hour.
const X_CACHE_MS = intEnv('X_CACHE_MS', 60 * 60 * 1000);
const X_MAX_SHARE = Number(process.env.X_MAX_SHARE || 0.15);
const X_BUDGET_FILE = require('path').join(__dirname, '.x-budget.json');

function utcDay() { return new Date().toISOString().slice(0, 10); }

function xBudget() {
  let b = { day: utcDay(), spent: 0 };
  try { b = JSON.parse(fs.readFileSync(X_BUDGET_FILE, 'utf8')) || b; } catch (_) {}
  if (b.day !== utcDay()) b = { day: utcDay(), spent: 0 };   // new UTC day, fresh budget
  return b;
}

function xBudgetLeft() { return Math.max(0, X_DAILY_POSTS - xBudget().spent); }

function xBudgetSpend(n) {
  if (!(n > 0)) return;
  const b = xBudget();
  b.spent += n;
  try { fs.writeFileSync(X_BUDGET_FILE, JSON.stringify(b)); } catch (e) {
    console.error('[void-proxy] could not persist X budget:', e && e.message);
  }
  if (b.spent >= X_DAILY_POSTS) {
    console.log('[void-proxy] X daily budget spent (' + b.spent + '/' + X_DAILY_POSTS + ') — X is off until ' + utcDay() + ' ends');
  }
}

// What the wall wants from X: an event, told by someone who is there. Every
// query pairs an event term with a first-hand signal — photos/video from the
// scene, or present-tense witness language. An event term alone matched jokes
// ("a real ceasefire 👀 #BB28") and memes; the app filters news orgs out on its
// own, so asking for "news accounts" would be the opposite of the point.
//
// Three queries, not one: relevancy ranking on one combined query returned a
// page where every post matched the same term (measured 2026-10-08: ten posts,
// all "state of emergency"). One query per topic family makes a page draw from
// conflict, unrest AND disaster at once, at 3x the reads - X_CACHE_MS pays for it.
const X_GLOBAL_QUERIES = [
  "(airstrike OR ceasefire OR missile OR invasion)",
  "(coup OR protesters OR curfew)",
  "(\"state of emergency\" OR evacuation OR earthquake)",
];
const X_FIRSTHAND = "(has:media OR \"right now\" OR \"happening now\" OR \"just now\" OR \"outside my\" OR \"we can hear\" OR \"on the ground\")";
// The app sinks anything older than a day to the end of its feed (FEED_STALE_H).
// Without a window, relevancy ranking handed back the WEEK's most-engaged
// matches - median 59 h old (measured 2026-10-08) - so 17 of 22 eyewitness
// posts arrived already stale and the op-ed lane, hours old, led every screen.
// start_time is applied before billing, so the window costs nothing.
const FEED_MAX_AGE_MS = 24 * 3.6e6;
// Reels want the clip itself: the street-level events that go viral as video
// (police, bodycam, riots, blasts), not the diplomatic ones. has:videos is added
// by fetchReels, so every post paid for here carries footage.
const X_CLIPS = "(protesters OR police OR bodycam OR riot OR airstrike OR missile OR explosion OR earthquake OR wildfire OR \"caught on camera\")";

// hls: HLS first - one playlist adapts to the phone's bandwidth. Only the reels
// players (expo-video, and hls.js on the web) can play it: the web feed card and
// thread view use a bare <video src>, which shows "VIDEO UNAVAILABLE" for an
// .m3u8 in Chrome/Firefox, so /feed and /social ask for mp4. Otherwise the
// richest mp4 under the cap - X's top rung is a ~10Mbps 1080p file a phone on
// cellular stalls on. Nothing under the cap: the smallest one, because a heavy
// clip still beats no clip.
const X_MP4_MAX_BPS = 2500000;
function bestVariant(variants, hls) {
  const vs = Array.isArray(variants) ? variants.filter((v) => v && v.url) : [];
  const pl = hls && vs.find((v) => v.content_type === 'application/x-mpegURL');
  const mp4 = vs.filter((v) => v.content_type === 'video/mp4').sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));
  return (pl || mp4.find((v) => (v.bit_rate || 0) <= X_MP4_MAX_BPS) || mp4[mp4.length - 1] || {}).url || '';
}

// possibly_sensitive does not tell porn from gore, and a has:videos search on
// police/riot/explosion draws porn spam bots. Gore stays (veiled); a sensitive
// post that reads as sexual is dropped, as the client drops porn labels.
// ponytail: text-only heuristic, bots with innocuous captions still pass; an
// author-level signal (account age, follower ratio) is the upgrade.
const X_SEXUAL = /\b(porn\w*|nsfw|onlyfans|fansly|xxx|nudes?|nudity|naked|horny|milf|camgirls?|sexy|sextape|link in (my )?bio)\b|18\+/i;

// --- XProvider (keyed, optional) -------------------------------------------
// Uses Twitter/X API v2 recent search only when X_BEARER is set. Never hardcode
// a key — read it from the environment. Inert (returns []) with no key.
class XProvider extends SocialProvider {
  constructor() {
    super();
    this.bearer = process.env.X_BEARER || '';
    this.platform = 'x';
    this._qcache = new Map();
    this._pausedUntil = 0;
    this._lastErr = '';
  }

  // Out of budget reads exactly like no key: the feed falls back to Reddit.
  get enabled() { return !!this.bearer && xBudgetLeft() > 0 && Date.now() >= this._pausedUntil; }

  // X errors used to vanish into .catch(() => []), so an unfunded account read
  // as an empty feed with nothing in the log. Say it once per distinct error.
  // 402 (credits depleted) will not fix itself: stand X down for a while rather
  // than asking again on every cache miss.
  _fail(e) {
    const msg = (e && e.message) || String(e);
    if (msg !== this._lastErr) {
      this._lastErr = msg;
      const hint = /HTTP 402/.test(msg) ? ' — account has no credits; add them under Billing > Credits at developer.x.com'
        : /HTTP 401/.test(msg) ? ' — X_BEARER rejected; regenerate it' : '';
      console.error('[void-proxy] X request failed: ' + msg.replace(/ for https?:\/\/\S+/, '') + hint);
    }
    if (/HTTP 402/.test(msg)) this._pausedUntil = Date.now() + 15 * 60 * 1000;
    return [];
  }

  // sinceMs: only posts newer than this. start_time is a filter X applies before
  // billing, so a stale archive hit is never paid for and then thrown away.
  // hls: the caller's players can all play HLS (see bestVariant).
  async search(query, limit, sinceMs, hls) {
    if (!this.enabled) return [];
    // Reuse a recent identical query before paying for it again. /social is
    // per-country, so without this every country on the globe is its own bill.
    const key = query + (hls ? ' #hls' : '');
    const hit = this._qcache.get(key);
    if (hit && Date.now() - hit.t < X_CACHE_MS) return hit.v;
    // Ask for the API minimum by default, and never more than the budget left.
    const want = Math.min(limit || X_MAX_RESULTS, X_MAX_RESULTS, xBudgetLeft());
    const max = Math.min(Math.max(want, 10), 100); // API v2 min 10, max 100
    const params = new URLSearchParams({
      // The wall wants people who are THERE, not commentary on them. At a price
      // per post, never pay for: replies ("@someone my take is…"), retweets
      // (someone else's post again), or quotes (a take on someone else's post).
      query: query + ' -is:retweet -is:reply -is:quote',
      // Relevancy ranks posts people are engaging with over the newest firehose
      // noise; recency returned whatever was typed in the last few seconds.
      sort_order: 'relevancy',
      max_results: String(max),
      'tweet.fields': 'created_at,public_metrics,author_id,lang,possibly_sensitive',
      expansions: 'author_id,attachments.media_keys',
      'user.fields': 'username,name',
      // Without variants X sends a video's poster but never its file, so every X
      // clip reached the client with an empty url and was dropped as unplayable.
      'media.fields': 'type,url,preview_image_url,variants,public_metrics',
    });
    // X wants RFC 3339 to the second; toISOString's milliseconds are dropped.
    if (sinceMs) params.set('start_time', new Date(Date.now() - sinceMs).toISOString().replace(/\.\d+Z$/, 'Z'));
    const url = 'https://api.twitter.com/2/tweets/search/recent?' + params.toString();
    const data = await getJson(url, { 'Authorization': 'Bearer ' + this.bearer });
    // X bills every post it returned, including ones dropped below — so count
    // the raw response, not what survives.
    xBudgetSpend((data && Array.isArray(data.data)) ? data.data.length : 0);
    const items = this.mapResponse(data, hls);
    this._qcache.set(key, { t: Date.now(), v: items });
    return items;
  }

  mapResponse(data, hls) {
    if (!data || !Array.isArray(data.data)) return [];
    const users = {};
    const mediaByKey = {};
    const inc = data.includes || {};
    for (const u of inc.users || []) users[u.id] = u;
    for (const m of inc.media || []) mediaByKey[m.media_key] = m;

    // X's possibly_sensitive flag is where war and street footage lands, so it is
    // kept and marked graphic: the app maps it to _graphic and veils it (blurred,
    // TAP TO VIEW) - never drops it, never shows it bare.
    return data.data.filter((t) => !(t.possibly_sensitive && X_SEXUAL.test(t.text || ''))).map((t) => {
      const u = users[t.author_id] || {};
      const pm = t.public_metrics || {};
      const media = [];
      let views = 0;
      const keys = (t.attachments && t.attachments.media_keys) || [];
      for (const k of keys) {
        const m = mediaByKey[k];
        if (!m) continue;
        if (m.type === 'video' || m.type === 'animated_gif') {
          const src = bestVariant(m.variants, hls);
          // No playable rung (X withholds variants on some clips): keep the
          // poster as a picture - a video item with no url reads as broken.
          if (src) media.push({ type: 'video', url: src, thumb: m.preview_image_url });
          else if (m.preview_image_url) media.push({ type: 'image', url: m.preview_image_url });
          views = Math.max(views, (m.public_metrics && m.public_metrics.view_count) || 0);
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
          views,
        },
        graphic: !!t.possibly_sensitive,
        media,
      };
    });
  }

  async fetchGlobal({ limit }) {
    // Every term here must be unambiguous, because X bills per post read: the
    // old 'strike'/'protest' query paid for NFL touchdowns and rap beef.
    // Each query has its own cache entry in search(); a post matching two
    // families (an airstrike that triggers an evacuation) comes back twice and
    // is kept once. The merged set is the page's X supply - nothing trims it.
    const sets = await Promise.all(X_GLOBAL_QUERIES.map((q) =>
      this.search(q + ' ' + X_FIRSTHAND + ' lang:en', limit, FEED_MAX_AGE_MS).catch((e) => this._fail(e))));
    const seen = new Set();
    return sets.flat().filter((it) => !seen.has(it.id) && seen.add(it.id));
  }

  async fetchByCountry({ country, limit }) {
    if (!country) return this.fetchGlobal({ limit });
    return this.search(`"${country}" (airstrike OR ceasefire OR missile OR invasion OR protesters OR killed OR attack) ${X_FIRSTHAND} lang:en`, limit, FEED_MAX_AGE_MS).catch((e) => this._fail(e));
  }

  // Relevancy within the reels window is X's own "most engaged lately" order.
  async fetchReels({ limit }) {
    return this.search(X_CLIPS + ' has:videos lang:en', limit, REELS_MAX_AGE_MS, true).catch((e) => this._fail(e));
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
  return collect(results, mode, limit, interleaveRegional);
}

// Regional-alert items (tagged with a country inside the global feed) come
// from small communities whose absolute engagement can never outrank
// r/worldnews, so pure ranking would bury them past any page a user reaches.
// Keep ranked order within each lane, but place a regional item every
// REGIONAL_EVERY slots so a local tragedy is visible on the first page.
const REGIONAL_EVERY = 8;
function interleaveRegional(ranked) {
  const regional = ranked.filter((it) => it.country);
  const broad = ranked.filter((it) => !it.country);
  const out = [];
  while (regional.length || broad.length) {
    if (regional.length && (out.length % REGIONAL_EVERY === REGIONAL_EVERY - 1 || !broad.length)) out.push(regional.shift());
    else out.push(broad.shift());
  }
  return out;
}

async function aggregateByCountry({ country, mode, limit }) {
  const results = await Promise.allSettled(
    PROVIDERS.map((p) => p.fetchByCountry({ country, mode, limit }))
  );
  return collect(results, mode, limit).map((it) => ({ ...it, country: it.country || country || '' }));
}

// /reels: recent posts carrying a clip that actually plays. 'hot' ranks by
// engagement per hour of age, which is "most engaged AND newest" in one number.
// A provider with a video-specific query (X) uses it; the rest hand over their
// global pool and the filter keeps what plays. The filter runs as collect's
// arrange step - after capXShare has counted the whole free pool, so a feed of
// mostly-text Reddit cannot ration the paid X clips down to nothing.
const REELS_MAX_AGE_MS = 48 * 3.6e6;
function isReel(it) {
  return Date.now() - (it.createdAt || 0) <= REELS_MAX_AGE_MS &&
    (it.media || []).some((m) => m.type === 'video' && m.url);
}
async function aggregateReels({ limit }, providers = PROVIDERS) {
  const results = await Promise.allSettled(providers.map((p) =>
    p.fetchReels ? p.fetchReels({ limit }) : p.fetchGlobal({ mode: 'hot', limit })));
  return collect(results, 'hot', limit, (ranked) => ranked.filter(isReel));
}

function collect(results, mode, limit, arrange) {
  const raw = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) raw.push(...r.value);
    // rejected providers are simply skipped
  }
  // Count each story's sources before dropping duplicates: keep the most engaged
  // copy, carrying _sources so the ranker can reward corroboration.
  const byStory = new Map(), items = [];
  for (const it of raw) {
    const k = storyKey(it);
    if (!k) { items.push(it); continue; }
    const cur = byStory.get(k);
    if (!cur) { const copy = { ...it, _sources: 1 }; byStory.set(k, copy); items.push(copy); continue; }
    cur._sources++;
    if (velocityOf(it) > velocityOf(cur)) Object.assign(cur, it, { _sources: cur._sources });
  }
  let ranked = capXShare(rankItems(items, mode));
  // Arrange (e.g. regional interleave) BEFORE truncation, or low-engagement
  // regional items are cut from the pool before they can be placed.
  if (arrange) ranked = arrange(ranked);
  return ranked.slice(0, limit || 40).map(withProvenance);
}

// X items are the only paid ones in the mix, so they are also the only ones
// worth rationing on display: keep the top X_MAX_SHARE of them in rank order
// and drop the tail. Nothing else is touched, and the cap is on the pool, so
// every page inherits roughly the same ratio.
//
// The ration assumes Reddit fills the other 85%. Keyless Reddit is 403 (API
// access denied), so without credentials the "free" items are only the regional
// alert subs that happen to answer - and rationing against those cut a page's X
// to ~4 posts that were already paid for, while the page filled with op-ed
// paragraphs instead of the first-person posts the X query selects for. No
// Reddit auth: X is the feed, un-rationed. With auth, the ration stands.
function capXShare(ranked, authed = redditAuthed()) {
  if (!authed || !(X_MAX_SHARE >= 0) || X_MAX_SHARE >= 1) return ranked;
  // Measured against the FREE items, not the whole pool: capping a pool that
  // still contains the X items would leave them over-represented once trimmed.
  const free = ranked.reduce((n, it) => n + (it.platform === 'x' ? 0 : 1), 0);
  // Nothing free to share the page with (Reddit down, not yet approved): X is
  // the feed. Dropping it would throw away posts that were already paid for.
  if (!free) return ranked;
  const allowed = Math.floor(free * X_MAX_SHARE / (1 - X_MAX_SHARE));
  let kept = 0;
  return ranked.filter((it) => it.platform !== 'x' || ++kept <= allowed);
}

// The client refuses proxy content without a source and a stable response
// fingerprint. Previously this proxy emitted neither, so every /feed and
// /social result was discarded before ranking. Keep the fingerprint local and
// deterministic: it is provenance metadata, not a tracking identifier.
function withProvenance(item) {
  if (!item) return item;
  let sourceHost = item.platform === 'reddit' ? 'reddit.com' :
    item.platform === 'x' ? 'x.com' : String(item.platform || 'unknown');
  try { if (item.url) sourceHost = new URL(item.url).hostname.replace(/^www\./, ''); } catch (_) {}
  const basis = [item.id, item.url, item.createdAt, item.text].join('|');
  let h = 2166136261;
  for (let i = 0; i < basis.length; i++) h = Math.imul(h ^ basis.charCodeAt(i), 16777619);
  // Keep upstream-supplied provenance if a provider already set one.
  const prev = item.provenance || {};
  return { ...item, provenance: {
    sourceHost: prev.sourceHost || sourceHost,
    responseHash: prev.responseHash || (h >>> 0).toString(36),
  } };
}

// ---------------------------------------------------------------------------
// In-memory TTL cache, keyed by endpoint+params.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 60 * 1000;
// Size of the ranked pool each endpoint pages over (offset/limit slice it).
const FEED_POOL = 400;
const SOCIAL_POOL = 200;

// Slice a ranked pool. nextOffset is the offset of the following page, or 0
// when the pool is exhausted (the client restarts from the head).
function page(all, offset, limit) {
  const items = all.slice(offset, offset + limit);
  const end = offset + items.length;
  return { items, nextOffset: items.length && end < all.length ? end : 0, total: all.length };
}
const cache = new Map();

// The producer's PROMISE goes into the cache before anyone awaits it, so N
// concurrent misses on one key run ONE upstream fan-out instead of N - the old
// shape was a thundering herd that burned N-1 paid-X spends on every 60s TTL
// expiry per mode. And expiry serves STALE WHILE REVALIDATING: no user request
// ever blocks on the refresh; the new pool answers the requests after it.
async function cached(key, producer) {
  const now = Date.now();
  let e = cache.get(key);
  if (!e) {
    e = { t: now, v: producer(), next: null };   // v is a promise; await unwraps it for every coalesced caller
    cache.set(key, e);
    // A failed fan-out must not poison the key for a whole TTL.
    Promise.resolve(e.v).catch(() => { if (cache.get(key) === e) cache.delete(key); });
    return e.v;
  }
  if (now - e.t >= CACHE_TTL_MS && !e.next) {
    e.next = Promise.resolve().then(producer).then(
      (v) => { e.t = Date.now(); e.v = v; e.next = null; },
      () => { e.next = null; },                  // keep serving stale; the next request retries
    );
  }
  return e.v;
}

// ---------------------------------------------------------------------------
// Translation (DeepL).
// The client called Google's free gtx endpoint directly, which rate-limits by IP
// (429, then a "Sorry…" page for hours) with no warning. Routing through here
// puts one real key behind every user, and the cache means a thread translated
// for one reader costs nothing for the next.
//
//   DEEPL_KEY  DeepL API key. Free-tier keys end in ":fx" and go to api-free;
//              any other key goes to the paid host. Unset => /translate answers
//              503 and the client falls back to gtx by itself.
//
// The Free tier hard-stops at 500k chars/month (HTTP 456) instead of billing,
// so running out is an outage, not an invoice. Needs Node 18+ (global fetch).
// ---------------------------------------------------------------------------
const DEEPL_KEY = process.env.DEEPL_KEY || '';
const DEEPL_URL = /:fx$/.test(DEEPL_KEY) ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
// /translate is public (CORS *), so without these anyone could drain the
// month's quota through it.
const TR_MAX_TEXTS = 50;       // DeepL's own per-request ceiling
const TR_MAX_CHARS = 20000;    // per request, all texts together
const TR_RATE_PER_MIN = 30;    // requests per client IP
const TR_CACHE_MAX = 5000;     // entries; oldest evicted first

const trCache = new Map();     // `${target}|${text}` -> translation; Map order = age
const trHits = new Map();      // ip -> request times within the last minute

// DeepL refuses plain EN/PT as a TARGET; it wants the regional variant.
function deeplTarget(lang) {
  const l = String(lang || 'en').toLowerCase();
  if (l === 'en') return 'EN-US';
  if (l === 'pt') return 'PT-BR';
  if (l === 'zh' || l === 'zh-cn') return 'ZH-HANS';
  if (l === 'zh-tw') return 'ZH-HANT';
  return l.toUpperCase();
}

function trRateOk(ip) {
  const now = Date.now();
  const recent = (trHits.get(ip) || []).filter((t) => now - t < 60000);
  if (recent.length >= TR_RATE_PER_MIN) { trHits.set(ip, recent); return false; }
  recent.push(now);
  trHits.set(ip, recent);
  if (trHits.size > 10000) trHits.clear();   // bounded memory under a scan
  return true;
}

// Answer from cache where possible and send DeepL only the misses, in one call.
// Returns an array aligned with `texts`.
async function translateTexts(texts, lang) {
  const target = deeplTarget(lang);
  const out = new Array(texts.length), miss = [];
  texts.forEach((t, i) => {
    if (!t.trim()) { out[i] = t; return; }
    const hit = trCache.get(target + '|' + t);
    if (hit !== undefined) out[i] = hit; else miss.push(i);
  });
  if (miss.length) {
    const r = await fetch(DEEPL_URL, {
      method: 'POST',
      headers: { 'Authorization': 'DeepL-Auth-Key ' + DEEPL_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: miss.map((i) => texts[i]), target_lang: target }),
    });
    if (!r.ok) { const e = new Error('deepl HTTP ' + r.status); e.status = r.status; throw e; }
    const d = await r.json();
    const tr = (d && d.translations) || [];
    if (tr.length !== miss.length) throw new Error('deepl returned ' + tr.length + ' of ' + miss.length);
    miss.forEach((i, j) => {
      out[i] = tr[j].text;
      trCache.set(target + '|' + texts[i], out[i]);
      if (trCache.size > TR_CACHE_MAX) trCache.delete(trCache.keys().next().value);
    });
  }
  return out;
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      data += c;
      if (data.length > max) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// HTTP layer.
// ---------------------------------------------------------------------------
// Stream health lives in memory and on disk beside the X budget - it survives a
// restart, and losing it on a redeploy only means re-learning from live traffic.
const STREAM_HEALTH_FILE = process.env.STREAM_HEALTH_FILE || '/tmp/void-stream-health.json';
// Daily character budgets: 25k per address, 400k globally - DeepL's free month
// is 500k, so one bad day can no longer end translation for the month (audit 4).
let trDay = ''; let trGlobalChars = 0; const trIpChars = new Map();
function trBudgetOk(ip, chars) {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== trDay) { trDay = day; trGlobalChars = 0; trIpChars.clear(); }
  const mine = (trIpChars.get(ip) || 0) + chars;
  if (mine > 25_000 || trGlobalChars + chars > 400_000) return false;
  trIpChars.set(ip, mine);
  trGlobalChars += chars;
  return true;
}
// 10 report-POSTs per minute per address is far above any honest client
// (they batch every 2.5s only while actively connecting) - audit finding 3.
const shHits = new Map();
function shRateOk(ip) {
  const now = Date.now();
  const recent = (shHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 10) return false;
  recent.push(now);
  shHits.set(ip, recent);
  if (shHits.size > 5000) { const k = shHits.keys().next().value; shHits.delete(k); }
  return true;
}
let streamHealth = {};
try { streamHealth = JSON.parse(fs.readFileSync(STREAM_HEALTH_FILE, 'utf8')) || {}; } catch (_) {}
let _shT = 0;
function saveStreamHealth() {
  clearTimeout(_shT);
  _shT = setTimeout(() => {
    try { fs.writeFileSync(STREAM_HEALTH_FILE, JSON.stringify(streamHealth)); } catch (e) {}
  }, 3000);
}

// /hls host gate (audit finding 2): literal-IP checks plus DNS resolution
// against a blocklist. Residual TOCTOU between lookup and connect accepted.
const net = require('net');
const dnsp = require('dns').promises;
const PRIVATE_BLOCK = new net.BlockList();
PRIVATE_BLOCK.addSubnet('127.0.0.0', 8); PRIVATE_BLOCK.addSubnet('10.0.0.0', 8);
PRIVATE_BLOCK.addSubnet('172.16.0.0', 12); PRIVATE_BLOCK.addSubnet('192.168.0.0', 16);
PRIVATE_BLOCK.addSubnet('169.254.0.0', 16); PRIVATE_BLOCK.addSubnet('100.64.0.0', 10);
PRIVATE_BLOCK.addSubnet('0.0.0.0', 8);
PRIVATE_BLOCK.addSubnet('::1', 128, 'ipv6'); PRIVATE_BLOCK.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_BLOCK.addSubnet('fe80::', 10, 'ipv6'); PRIVATE_BLOCK.addSubnet('::ffff:0:0', 96, 'ipv6');
async function hlsHostOk(u) {
  let host = u.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false;
  const fam = net.isIP(host);
  if (fam) return !PRIVATE_BLOCK.check(host, fam === 6 ? 'ipv6' : 'ipv4');
  try {
    const addrs = await dnsp.lookup(host, { all: true });
    if (!addrs.length) return false;
    for (const a of addrs) {
      if (PRIVATE_BLOCK.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4')) return false;
    }
    return true;
  } catch (_) { return false; }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, code, obj, headers) {
  let body = JSON.stringify(obj);
  cors(res);
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || null);
  // Gzip when the client can take it and the body is worth it: /feed pages run
  // 100-400KB of highly repetitive JSON (5-8x smaller gzipped), OkHttp on the
  // phone and every browser auto-inflate, and the CDN caches the compressed
  // copy (Vary makes that correct). ~1TB/day of origin egress at scale was
  // uncompressed JSON.
  const ae = String((res.req && res.req.headers && res.req.headers['accept-encoding']) || '');
  if (body.length > 1024 && /gzip/i.test(ae)) {
    body = zlib.gzipSync(Buffer.from(body));
    h['Content-Encoding'] = 'gzip';
    h['Vary'] = h['Vary'] ? h['Vary'] + ', Accept-Encoding' : 'Accept-Encoding';
  }
  res.writeHead(code, h);
  res.end(body);
}
// /feed and /social payloads are user-independent (keyed only by mode / country /
// offset / limit), so a CDN in front of the proxy can absorb them the same way
// /streams/health is already absorbed - origin load becomes O(pages-per-minute)
// instead of O(users), and everyone's latency becomes an edge hit.
const FEED_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=120' };

// Curated clips (POST /curated/ingest). No CURATOR_KEY set means no curator:
// refuse every push rather than accept anyone's. Constant-time compare so the
// key cannot be guessed byte by byte off response timing.
const CURATOR_KEY = process.env.CURATOR_KEY || '';
function curatorKeyOk(k) {
  k = String(k || '');
  return !!CURATOR_KEY && k.length === CURATOR_KEY.length && require('crypto').timingSafeEqual(Buffer.from(k), Buffer.from(CURATOR_KEY));
}
let curated = { generated: '', items: [] };
// Slop verdicts (POST /slop/ingest): the curator's local LLM scores borderline feed
// posts; clients hide what scores high. {k: hash of normalised text, s: 0..1}.
// ponytail: memory only, replaced per push; a redeploy is empty until the next pass.
let slop = { generated: '', items: [] };
// The curator pass (labels clips, scores slop), run here instead of on a PC: Supabase's
// pg_cron POSTs /curator/run every few minutes (supabase/migrations/014). One pass at a
// time, as a child process of curator.cjs (a bundle of scripts/curator.mjs); it pushes its
// results back into this server through /curated/ingest and /slop/ingest like before.
// ponytail: state lives in /tmp, so a redeploy relabels the last 72 h once; persist if that costs too much.
let curatorRun = null; // { started, child }

// The live stream list (GET /streams/pool). Apps used to carry it only inside each release,
// so fixing it took a rebuild. Seeded from iptv-pool.json (copied in by scripts/inject-iptv.js,
// so every deploy ships the list current at that commit), replaced by POST /streams/pool/ingest
// after each probe run, kept in /tmp across restarts. A push under half the current count is
// refused: that is an outage at the prober, not half the world's channels dying.
const POOL_TMP = '/tmp/void-iptv-pool.json';
const poolCount = (src) => Object.values(src || {}).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
let iptvPool = (() => {
  for (const f of [POOL_TMP, require('path').join(__dirname, 'iptv-pool.json')]) {
    try { const d = JSON.parse(require('fs').readFileSync(f, 'utf8')); if (poolCount(d.sources)) return { generated: d.generated || '', count: poolCount(d.sources), sources: d.sources }; } catch { /* next */ }
  }
  return { generated: '', count: 0, sources: {} };
})();
function startCurator() {
  if (curatorRun) return false;
  const env = { ...process.env, CURATOR_DIR: process.env.CURATOR_DIR || '/tmp/void-curator', PROXY_BASE: 'http://127.0.0.1:' + PORT };
  require('fs').mkdirSync(env.CURATOR_DIR, { recursive: true });
  const child = require('child_process').spawn(process.execPath, [require('path').join(__dirname, 'curator.cjs'), '--once'], { env, stdio: 'inherit' });
  curatorRun = { started: Date.now(), child };
  const done = () => { curatorRun = null; };
  child.on('exit', done); child.on('error', done);
  setTimeout(() => { if (curatorRun && curatorRun.child === child) child.kill(); }, 10 * 60 * 1000).unref(); // a pass never holds the slot past 10 min
  return true;
}
// The /reels item shape (the client maps it with proxyPostToApp) plus the
// curator's labels. createdAt is ms like every other lane: an ISO string would
// make the client's `time` a string and every age maths NaN.
function curatedToPost(it) {
  return withProvenance({
    id: 'cur_' + it.key, platform: it.platform || 'curated', text: it.text || '',
    createdAt: Date.parse(it.createdAt) || (+it.createdAt) || Date.now(),
    metrics: { score: it.likes | 0, reposts: it.reposts | 0, replies: 0, views: 0 }, graphic: !!it.graphic,
    media: [{ type: 'video', url: it.video, thumb: it.thumb || '' }], url: it.url || '',
    caption: it.caption || '', genre: it.genre || '', topic: it.topic || '', fit: Math.max(0, Math.min(1, +it.fit || 0)),
  });
}

// ─── BLUESKY VIDEO INGEST (Jetstream) ──────────────────────────────────────
// Reels drew from a handful of feeds and four search words: a few hundred clips.
// Jetstream is Bluesky's public firehose as JSON, no login. Measured 2026-10-11:
// ~3.6M posts/day, ~58k of them video, ~9.4k of those pass the app's topic tags.
// This keeps every video post's link and caption for VIDEO_KEEP_MS; the app tags
// the captions (one tag list, in the app) and hydrates the ones it wants with
// getPosts, which also drops anything deleted since. Nothing is rehosted.
// ponytail: memory only; a redeploy refills from the cursor rewind (VIDEO_REWIND_MS).
const VIDEO_KEEP_MS = 24 * 36e5, VIDEO_MAX = 120000, VIDEO_REWIND_MS = 6 * 36e5;
const JETSTREAM_HOSTS = ['jetstream2.us-east.bsky.network', 'jetstream1.us-east.bsky.network', 'jetstream1.us-west.bsky.network', 'jetstream2.us-west.bsky.network'];
const bskyVideos = [];             // {u, t, x}, oldest first, append-only
let jsCursor = 0, jsHost = 0, jsBackoff = 1000, jsSocket = null, jsSeen = 0;
function isVideoEmbed(e) {
  return !!e && (e.$type === 'app.bsky.embed.video' || (e.$type === 'app.bsky.embed.recordWithMedia' && !!e.media && e.media.$type === 'app.bsky.embed.video'));
}
// One Jetstream event -> a pool item, or null. Self-labelled adult posts never enter;
// the moderation labels the app also checks arrive with the hydrated post.
function jetstreamVideo(d) {
  const c = d && d.commit;
  if (!c || d.kind !== 'commit' || c.operation !== 'create' || c.collection !== 'app.bsky.feed.post') return null;
  const r = c.record || {};
  if (!isVideoEmbed(r.embed)) return null;
  const labels = ((r.labels && r.labels.values) || []).map((v) => String(v && v.val));
  if (labels.some((v) => /porn|sexual|nudity/.test(v))) return null;
  return { u: 'at://' + d.did + '/app.bsky.feed.post/' + c.rkey, t: Math.floor(d.time_us / 1000), x: String(r.text || '').slice(0, 300) };
}
function addVideo(it) {
  bskyVideos.push(it);
  const cut = it.t - VIDEO_KEEP_MS;
  let drop = 0;
  while (drop < bskyVideos.length && (bskyVideos[drop].t < cut || bskyVideos.length - drop > VIDEO_MAX)) drop++;
  if (drop > 256) bskyVideos.splice(0, drop);   // batched: splice per event is O(n) per post
}
// Newest first, `before` (ms) pages older. next = 0 means the window is exhausted.
function videoPage(before, limit) {
  const cut = Date.now() - VIDEO_KEEP_MS, out = [];
  for (let i = bskyVideos.length - 1; i >= 0 && out.length < limit; i--) {
    const it = bskyVideos[i];
    if (it.t < cut) continue;                    // skip, not stop: a host switch can land out of order
    if (before && it.t >= before) continue;
    out.push(it);
  }
  return { items: out, next: out.length === limit ? out[out.length - 1].t : 0 };
}
function startJetstream() {
  if (typeof WebSocket !== 'function') { console.warn('[jetstream] no global WebSocket (Node 22+ needed), video ingest off'); return; }
  const cursor = (jsCursor || (Date.now() - VIDEO_REWIND_MS) * 1000);
  const url = 'wss://' + JETSTREAM_HOSTS[jsHost % JETSTREAM_HOSTS.length] + '/subscribe?wantedCollections=app.bsky.feed.post&cursor=' + cursor;
  const ws = jsSocket = new WebSocket(url);
  ws.onopen = () => { jsBackoff = 1000; console.log('[jetstream] connected', JETSTREAM_HOSTS[jsHost % JETSTREAM_HOSTS.length]); };
  ws.onmessage = (m) => {
    let d; try { d = JSON.parse(m.data); } catch (_) { return; }
    if (d.time_us) jsCursor = d.time_us;
    jsSeen++;
    const it = jetstreamVideo(d); if (it) addVideo(it);
  };
  ws.onerror = () => { /* onclose follows */ };
  ws.onclose = () => {
    if (jsSocket !== ws) return;
    jsHost++;                                       // next host; the cursor resumes where this one stopped
    setTimeout(startJetstream, jsBackoff);
    jsBackoff = Math.min(jsBackoff * 2, 60000);
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

    const u = new URL(req.url, `http://localhost:${PORT}`);
    const path = u.pathname;
    // mode is a closed set: arbitrary values each minted a fresh 400-item
    // pool and a full upstream fan-out (audit findings on cache keys).
    const _m = u.searchParams.get('mode') || 'tension';
    const mode = ['tension', 'hot', 'recent'].includes(_m) ? _m : 'tension';
    const limit = clampInt(u.searchParams.get('limit'), 40, 1, 100);
    const offset = clampInt(u.searchParams.get('offset'), 0, 0, FEED_POOL);

    if (path === '/translate') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      if (!DEEPL_KEY) return sendJson(res, 503, { error: 'translate not configured' });
      // Audit finding 4: the FIRST x-forwarded-for entry is client-supplied -
      // a fresh spoofed IP per request walked straight past the limiter; the
      // LAST entry is the hop the platform appended.
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
      if (!trRateOk(ip)) return sendJson(res, 429, { error: 'slow down' });
      let body;
      try { body = JSON.parse(await readBody(req, TR_MAX_CHARS * 4)); } catch (_) { return sendJson(res, 400, { error: 'bad body' }); }
      const texts = Array.isArray(body && body.texts) ? body.texts.map((t) => String(t == null ? '' : t)) : null;
      if (!texts || !texts.length || texts.length > TR_MAX_TEXTS) return sendJson(res, 400, { error: 'texts: 1-' + TR_MAX_TEXTS + ' strings' });
      const chars = texts.reduce((n, t) => n + t.length, 0);
      if (chars > TR_MAX_CHARS) return sendJson(res, 413, { error: 'too much text' });
      if (!trBudgetOk(ip, chars)) return sendJson(res, 429, { error: 'translation budget exhausted' });
      try {
        return sendJson(res, 200, { translations: await translateTexts(texts, body.target) });
      } catch (e) {
        // 456 = the month's quota is gone. 503 tells the client to stop asking
        // for this session and use its gtx fallback.
        console.error('[void-proxy] translate failed:', e && e.message);
        const quota = e && e.status === 456;
        return sendJson(res, quota ? 503 : 502, { error: quota ? 'quota exhausted' : 'upstream failed' });
      }
    }

    if (path === '/feed') {
      // Page locally over ONE fixed, cached pool. The old endpoint ignored
      // offset (page one forever); sizing the fetch to offset+limit also made
      // the pool exactly one page long, so nextOffset could never advance and
      // each page came from a differently-sized, differently-ranked fetch.
      const key = `feed|${mode}`;
      const all = await cached(key, () => aggregateGlobal({ mode, limit: FEED_POOL }));
      return sendJson(res, 200, page(all, offset, limit), FEED_CACHE_HEADERS);
    }

    if (path === '/social') {
      const country = u.searchParams.get('country') || '';
      const key = `social|${country.toLowerCase()}|${mode}`;
      const all = await cached(key, () => aggregateByCountry({ country, mode, limit: SOCIAL_POOL }));
      return sendJson(res, 200, page(all, offset, limit), FEED_CACHE_HEADERS);
    }

    if (path === '/reels') {
      // One pool, one ranking: mode is ignored so it cannot mint extra pools.
      const all = await cached('reels', () => aggregateReels({ limit: FEED_POOL }));
      return sendJson(res, 200, page(all, offset, limit), FEED_CACHE_HEADERS);
    }

    // ─── CURATED: LLM-labelled clips, PUSHED by the curator on the user's PC ──
    // Railway cannot read scripts/curated.public.json, so the curator POSTs it and
    // it lives in memory, replaced wholesale per push. A redeploy loses it until
    // the next push: ~60 fresh clips the curator regenerates anyway.
    if (path === '/curated/ingest') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      if (!curatorKeyOk(req.headers['x-curator-key'])) return sendJson(res, 401, { error: 'bad key' });
      let body;
      try { body = JSON.parse(await readBody(req, 2 * 1024 * 1024)); } catch (_) { return sendJson(res, 400, { error: 'bad body' }); }
      if (!Array.isArray(body && body.items)) return sendJson(res, 400, { error: 'items: array' });
      const items = body.items.filter((it) => it && it.key && /^https?:\/\//.test(String(it.video || ''))).slice(0, 200).map(curatedToPost);
      curated = { generated: String(body.generated || new Date().toISOString()), items };
      return sendJson(res, 200, { ok: true, count: items.length });
    }

    if (path === '/slop/ingest') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      if (!curatorKeyOk(req.headers['x-curator-key'])) return sendJson(res, 401, { error: 'bad key' });
      let body;
      try { body = JSON.parse(await readBody(req, 1024 * 1024)); } catch (_) { return sendJson(res, 400, { error: 'bad body' }); }
      if (!Array.isArray(body && body.items)) return sendJson(res, 400, { error: 'items: array' });
      const items = body.items.filter((it) => it && /^[a-z0-9]{1,16}$/.test(String(it.k || '')) && Number.isFinite(+it.s))
        .slice(0, 5000).map((it) => ({ k: String(it.k), s: Math.round(Math.max(0, Math.min(1, +it.s)) * 100) / 100 }));
      slop = { generated: String(body.generated || new Date().toISOString()), items };
      return sendJson(res, 200, { ok: true, count: items.length });
    }
    if (path === '/slop') return sendJson(res, 200, slop, FEED_CACHE_HEADERS);
    if (path === '/streams/pool') return sendJson(res, 200, iptvPool, { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' });
    if (path === '/streams/pool/ingest') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      if (!curatorKeyOk(req.headers['x-curator-key'])) return sendJson(res, 401, { error: 'bad key' });
      let body;
      try { body = JSON.parse(await readBody(req, 4 * 1024 * 1024)); } catch (_) { return sendJson(res, 400, { error: 'bad body' }); }
      const src = body && body.sources;
      if (!src || typeof src !== 'object') return sendJson(res, 400, { error: 'sources: object' });
      const sources = {};
      for (const [k, list] of Object.entries(src)) {
        if (!Array.isArray(list)) continue;
        sources[String(k).slice(0, 60)] = list.filter((s) => s && /^https:\/\//.test(String(s.url || ''))).slice(0, 80)
          .map((s) => ({ type: 'hls', url: String(s.url), label: String(s.label || '').slice(0, 80) }));
      }
      const count = poolCount(sources);
      if (count < iptvPool.count * 0.5 && !(body && body.force)) return sendJson(res, 409, { error: 'refused: ' + count + ' vs ' + iptvPool.count + ' current' });
      iptvPool = { generated: String(body.generated || new Date().toISOString()), count, sources };
      try { require('fs').writeFileSync(POOL_TMP, JSON.stringify(iptvPool)); } catch { /* memory still has it */ }
      return sendJson(res, 200, { ok: true, count });
    }
    if (path === '/curator/run') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      if (!curatorKeyOk(req.headers['x-curator-key'])) return sendJson(res, 401, { error: 'bad key' });
      const started = startCurator();
      return sendJson(res, 202, { started, running: !!curatorRun, since: curatorRun ? curatorRun.started : null, model: process.env.LLM_URL ? 'api' : 'none' });
    }

    // ─── BLUESKY VIDEOS: the Jetstream pool, newest first, `before` pages older ──
    if (path === '/bsky/videos') {
      const before = clampInt(u.searchParams.get('before'), 0, 0, 9e15);
      return sendJson(res, 200, videoPage(before, clampInt(u.searchParams.get('limit'), 300, 1, 500)), FEED_CACHE_HEADERS);
    }

    if (path === '/curated') {
      return sendJson(res, 200, { items: curated.items.slice(0, limit), generated: curated.generated }, FEED_CACHE_HEADERS);
    }

    // ─── STREAM HEALTH: the pool's vital signs, aggregated from every client ──
    // Clients POST what actually happened when they tried a stream (ok, needed
    // the proxy, connect ms); everyone then GETs the aggregate. This is what
    // lets the wall skip globally-dead streams and lead with globally-fast ones
    // without any client replaying its own history.
    if (path === '/streams/report') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
      let body;
      try { body = JSON.parse(await readBody(req, 64 * 1024)); } catch (_) { return sendJson(res, 400, { error: 'bad body' }); }
      const reports = Array.isArray(body && body.reports) ? body.reports.slice(0, 50) : null;
      if (!reports || !reports.length) return sendJson(res, 400, { error: 'reports: 1-50' });
      // Audit finding 3: three unauthenticated bad reports could mark any
      // stream dead for every client. Per-IP rate limit; a stream only reads
      // as failing on reports from DISTINCT addresses - one attacker is one
      // reporter however many posts they send; the size cap is computed once.
      const rip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
      if (!shRateOk(rip)) return sendJson(res, 429, { error: 'slow down' });
      const ipTag = rip.slice(0, 40);
      let took = 0;
      let tableSize = Object.keys(streamHealth).length;
      for (const r of reports) {
        const u = r && typeof r.u === 'string' ? r.u : '';
        if (!/^https?:\/\//.test(u) || u.length > 500) continue;
        if (!streamHealth[u] && tableSize >= 4000) continue;
        if (!streamHealth[u]) tableSize++;
        const e = streamHealth[u] || (streamHealth[u] = { g: 0, b: 0, v: 0, ms: [], at: 0, bip: [] });
        if (!e.bip) e.bip = [];
        if (r.ok) { e.g++; if (r.v) e.v++; const ms = Math.min(30000, Math.max(0, r.ms | 0)); if (ms) { e.ms.push(ms); if (e.ms.length > 15) e.ms.shift(); } }
        else { e.b++; if (!e.bip.includes(ipTag) && e.bip.length < 8) e.bip.push(ipTag); }
        e.at = Date.now(); took++;
      }
      if (took) saveStreamHealth();
      return sendJson(res, 200, { ok: true, took });
    }

    if (path === '/streams/health') {
      const h = {};
      const cut = Date.now() - 7 * 864e5;
      for (const u in streamHealth) {
        const e = streamHealth[u];
        if (!e || e.at < cut) { delete streamHealth[u]; continue; }
        const n = e.g + e.b;
        if (!n) continue;
        const med = e.ms.length ? e.ms.slice().sort((a, b) => a - b)[e.ms.length >> 1] : 0;
        // reports (index 2) is what clients gate 'dead for everyone' on: for a
        // stream with ZERO successes it is capped at the count of DISTINCT bad
        // reporters, so one address can never read as three (finding 3).
        const distinctBad = (e.bip && e.bip.length) || 0;
        const reportsOut = e.g === 0 ? Math.min(n, distinctBad) : Math.min(999, n);
        h[u] = [Math.round((e.g / n) * 100), e.g ? Math.round((e.v / e.g) * 100) : 0, Math.min(999, reportsOut), med];
      }
      cors(res);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
      return res.end(JSON.stringify({ h }));
    }

    if (path === '/hls') {
      // A CORS shim for the wall, not an open proxy: the pool is probed server
      // side where CORS does not exist, so a share of its streams can never be
      // fetched by hls.js directly. This fetches one url, adds CORS, and - when
      // the body is an M3U8 - rewrites every URI line and URI="..." attribute to
      // come back through here, so segments and keys follow without the client
      // knowing anything beyond the one rewritten url it retried.
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET only' });
      const raw = u.searchParams.get('u') || '';
      let target;
      try { target = new URL(raw); } catch (_) { return sendJson(res, 400, { error: 'bad url' }); }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') return sendJson(res, 400, { error: 'http(s) only' });
      // SSRF guard hardened (audit finding 2): the old hostname string checks
      // missed [::1], IPv4-mapped loopback, CGNAT, DNS names resolving inward,
      // and redirects into any of those. Every hop is validated AND resolved.
      if (!(await hlsHostOk(target))) return sendJson(res, 400, { error: 'refused host' });
      const ctl = new AbortController();
      const kill = setTimeout(() => ctl.abort(), 12000);
      let r;
      try {
        const h = { 'User-Agent': 'void-proxy/1.1 hls', Accept: '*/*' };
        if (req.headers.range) h.Range = String(req.headers.range); // segments seek
        let hops = 0;
        let cur = target;
        for (;;) {
          r = await fetch(cur.href, { headers: h, redirect: 'manual', signal: ctl.signal });
          if (r.status < 300 || r.status >= 400) break;
          const loc = r.headers.get('location');
          if (!loc || ++hops > 3) { clearTimeout(kill); return sendJson(res, 502, { error: 'bad redirect' }); }
          cur = new URL(loc, cur);
          if (cur.protocol !== 'http:' && cur.protocol !== 'https:') { clearTimeout(kill); return sendJson(res, 400, { error: 'refused redirect' }); }
          if (!(await hlsHostOk(cur))) { clearTimeout(kill); return sendJson(res, 400, { error: 'refused redirect host' }); }
        }
      } catch (e) {
        clearTimeout(kill);
        return sendJson(res, 502, { error: 'upstream unreachable' });
      }
      const ct = String(r.headers.get('content-type') || '').toLowerCase();
      const finalUrl = r.url || target.href;
      const looksM3u8 = /\.m3u8(\?|$)/i.test(finalUrl) || ct.includes('mpegurl') || ct.includes('vnd.apple');
      cors(res);
      if (looksM3u8) {
        // Playlists are small text; 2MB is already absurd for one.
        let text;
        try { text = await r.text(); } catch (e) { clearTimeout(kill); return sendJson(res, 502, { error: 'upstream read failed' }); }
        clearTimeout(kill);
        if (text.length > 2 * 1024 * 1024 || text.slice(0, 7) !== '#EXTM3U') return sendJson(res, 502, { error: 'not a playlist' });
        const abs = (ref) => { try { return new URL(ref, finalUrl).href; } catch (_) { return ref; } };
        const via = (href) => '/hls?u=' + encodeURIComponent(href);
        const out = text.split('\n').map((line) => {
          const t = line.trim();
          if (!t) return line;
          // Key/map/media/part tags carry their url in URI="...".
          if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, ref) => 'URI="' + via(abs(ref)) + '"');
          return via(abs(t));
        }).join('\n');
        res.writeHead(r.status, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
        return res.end(out);
      }
      // Segments, keys, anything else: stream the bytes through untouched.
      const head = { 'Cache-Control': 'public, max-age=10' };
      if (ct) head['Content-Type'] = ct;
      const len = r.headers.get('content-length'); if (len) head['Content-Length'] = len;
      const cr = r.headers.get('content-range'); if (cr) head['Content-Range'] = cr;
      res.writeHead(r.status, head);
      try {
        // 30MB cap (finding 2): a live segment is single-digit MB; anything
        // bigger is relay abuse, not media. Honor backpressure while at it.
        let sent = 0;
        if (r.body) {
          for await (const chunk of r.body) {
            sent += chunk.length;
            if (sent > 30 * 1024 * 1024) { try { res.destroy(); } catch (_) {} break; }
            if (!res.write(chunk)) await new Promise((ok) => res.once('drain', ok));
          }
        }
        res.end();
      } catch (e) {
        try { res.destroy(); } catch (_) {}
      } finally { clearTimeout(kill); }
      return;
    }

    if (path === '/' || path === '/health') {
      return sendJson(res, 200, {
        ok: true,
        endpoints: ['/feed?mode=tension&limit=40', '/social?country=<name>&mode=tension&limit=30', '/reels?limit=30', '/curated?limit=30', '/bsky/videos?limit=300&before=<ms>', 'POST /curated/ingest {generated, items:[...]} (x-curator-key)', '/slop', 'POST /slop/ingest {generated, items:[{k,s}]} (x-curator-key)', 'POST /curator/run (x-curator-key)', '/streams/pool', 'POST /streams/pool/ingest {generated, sources} (x-curator-key)', '/hls?u=<m3u8 url>', '/streams/health', 'POST /streams/report {reports:[{u,ok,v,ms}]}', 'POST /translate {texts:[...], target:"en"}'],
        providers: PROVIDERS.map((p) => ({ platform: p.platform, enabled: p.enabled !== false })),
        reddit: { auth: redditAuthed() ? 'oauth' : 'keyless', userAgent: REDDIT_UA },
        bskyVideos: { held: bskyVideos.length, eventsSeen: jsSeen, cursorLagS: jsCursor ? Math.round(Date.now() / 1000 - jsCursor / 1e6) : null },
        translate: { provider: DEEPL_KEY ? 'deepl' : 'off', cached: trCache.size },
        xBudget: { dailyPosts: X_DAILY_POSTS, spentToday: xBudget().spent, left: xBudgetLeft(), maxShare: X_MAX_SHARE },
      });
    }

    return sendJson(res, 404, { error: 'not found', items: [], nextOffset: 0 });
  } catch (err) {
    // Never 500 the whole response with an empty body — return an empty feed.
    console.error('[void-proxy] handler error:', err && err.message);
    return sendJson(res, 200, { items: [], nextOffset: 0, error: 'internal' });
  }
});

// Listen only when run (npm start), so test.js can require the module offline.
if (require.main === module) server.listen(PORT, () => {
  if (process.env.JETSTREAM !== 'off') startJetstream();
  console.log(`[void-proxy] listening on http://localhost:${PORT}`);
  console.log(`[void-proxy] providers: reddit(${redditAuthed() ? 'oauth' : 'keyless — 403 likely, set REDDIT_CLIENT_ID/REDDIT_SECRET'})` +
    `, x(${process.env.X_BEARER ? `on, ${xBudgetLeft()}/${X_DAILY_POSTS} posts left today` : 'off — set X_BEARER'})` +
    `, threads(stub)` +
    `, translate(${DEEPL_KEY ? 'deepl' : 'off — set DEEPL_KEY'})`);
});

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------
// Env var as a non-negative integer, falling back when unset or malformed.
function intEnv(name, dflt) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

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
// POST a urlencoded body and parse JSON back. Only Reddit's token endpoint needs
// this; everything else in the proxy is a GET.
async function postForm(url, fields, headers) {
  const body = new URLSearchParams(fields).toString();
  headers = Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, headers || {});
  if (typeof fetch === 'function') {
    const r = await fetch(url, { method: 'POST', headers, body });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
  }
  return new Promise((resolve, reject) => {
    const https = require('https');
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: Object.assign({ 'Content-Length': Buffer.byteLength(body) }, headers),
    }, (resp) => {
      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        resp.resume();
        return reject(new Error(`HTTP ${resp.statusCode} for ${url}`));
      }
      let data = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { data += c; });
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end(body);
  });
}

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

module.exports = { server, jetstreamVideo, addVideo, videoPage, bskyVideos, tensionScore, capXShare, xBudgetLeft, X_GLOBAL_QUERIES, X_MAX_RESULTS, X_CACHE_MS, X_DAILY_POSTS, redditToken, redditAuthed, deeplTarget, translateTexts, rankItems, subsForCountry, withProvenance, interleaveRegional, page, bestVariant, aggregateReels, RedditProvider, XProvider, ThreadsProvider };
