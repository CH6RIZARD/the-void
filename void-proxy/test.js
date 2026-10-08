'use strict';
// Offline self-check for the X media mapping and /reels. `npm test`.
// X bills per post read, so this never touches the API: the bearer is blanked,
// fetch throws if anything tries the network, and X's response is a fixture
// shaped like a real v2 recent-search answer.
process.env.X_BEARER = '';
process.env.X_MAX_SHARE = '0.15';
// The spend arithmetic below checks the shipped defaults, not a local .env.
process.env.X_DAILY_POSTS = process.env.X_MAX_RESULTS = process.env.X_CACHE_MS = '';
process.env.REDDIT_CLIENT_ID = process.env.REDDIT_SECRET = '';
process.env.CURATOR_KEY = 'test-curator-key';
globalThis.fetch = () => { throw new Error('test.js must stay offline'); };

const assert = require('assert');
const http = require('http');
const { XProvider, bestVariant, aggregateReels, capXShare, redditAuthed, server,
  X_GLOBAL_QUERIES, X_MAX_RESULTS, X_CACHE_MS, X_DAILY_POSTS } = require('./server');

// Spend ceiling, from the constants alone: every global-feed query is paid once
// per cache window, so a day costs queries x posts x windows. 1000 is the hard
// cap; the feed must leave room under it for /reels and /social.
const feedReadsPerDay = X_GLOBAL_QUERIES.length * X_MAX_RESULTS * Math.ceil(864e5 / X_CACHE_MS);
assert.ok(feedReadsPerDay <= 900, `global feed would read ${feedReadsPerDay} posts/day, over the 900 line`);
assert.ok(feedReadsPerDay + X_MAX_RESULTS * Math.ceil(864e5 / X_CACHE_MS) <= X_DAILY_POSTS, 'feed + reels must fit the daily budget');

// No Reddit credentials: X is the whole page, nothing rationed. With them, the
// 15% ration against the free items stands.
const xs = Array.from({ length: 20 }, (_, i) => ({ id: 'x_' + i, platform: 'x' }));
const rs = Array.from({ length: 20 }, (_, i) => ({ id: 'reddit_' + i, platform: 'reddit' }));
assert.strictEqual(redditAuthed(), false);
assert.strictEqual(capXShare([...xs, ...rs]).length, 40, 'unauthed reddit: X passes un-rationed');
assert.strictEqual(capXShare([...xs, ...rs], true).filter((p) => p.platform === 'x').length, 3, 'authed reddit: 15% of the page');

const H = 3.6e6, now = Date.now();
const iso = (agoH) => new Date(now - agoH * H).toISOString();
const HLS = 'https://video.twimg.com/ext_tw_video/101/pu/pl/abc.m3u8?tag=12';
const mp4 = (id, br, w) => ({ bit_rate: br, content_type: 'video/mp4', url: `https://video.twimg.com/ext_tw_video/${id}/pu/vid/${w}/x.mp4` });

const FIXTURE = {
  data: [
    { id: '101', text: 'Police charge protesters outside parliament right now', author_id: 'u1', created_at: iso(1),
      public_metrics: { like_count: 5000, retweet_count: 1000, reply_count: 300, quote_count: 40 }, attachments: { media_keys: ['7_101'] } },
    { id: '102', text: 'Airstrike footage from the market this morning, graphic', author_id: 'u2', created_at: iso(2), possibly_sensitive: true,
      public_metrics: { like_count: 800, retweet_count: 100, reply_count: 50 }, attachments: { media_keys: ['7_102'] } },
    { id: '103', text: 'Photo of the flooded square taken an hour ago', author_id: 'u1', created_at: iso(1),
      public_metrics: { like_count: 900, retweet_count: 90, reply_count: 9 }, attachments: { media_keys: ['3_103'] } },
    { id: '104', text: 'Clip X sent without any playable variants at all', author_id: 'u2', created_at: iso(1),
      public_metrics: { like_count: 700, retweet_count: 70, reply_count: 7 }, attachments: { media_keys: ['7_104'] } },
    { id: '105', text: 'Old earthquake video from last week resurfacing again', author_id: 'u1', created_at: iso(120),
      public_metrics: { like_count: 9000, retweet_count: 900, reply_count: 90 }, attachments: { media_keys: ['7_105'] } },
    { id: '106', text: 'Looping gif of the crowd on the bridge tonight', author_id: 'u2', created_at: iso(3),
      public_metrics: { like_count: 25, retweet_count: 5, reply_count: 2 }, attachments: { media_keys: ['16_106'] } },
    { id: '107', text: 'riot police caught on camera 18+ full vid link in bio', author_id: 'u2', created_at: iso(1), possibly_sensitive: true,
      public_metrics: { like_count: 4000, retweet_count: 900, reply_count: 10 }, attachments: { media_keys: ['7_107'] } },
  ],
  includes: {
    users: [{ id: 'u1', username: 'streetcam', name: 'Street Cam' }, { id: 'u2', username: 'onscene', name: 'On Scene' }],
    media: [
      { media_key: '7_101', type: 'video', preview_image_url: 'https://pbs.twimg.com/101.jpg', public_metrics: { view_count: 120000 },
        variants: [mp4(101, 256000, '480x270'), mp4(101, 2176000, '1280x720'), mp4(101, 10368000, '1920x1080'), { content_type: 'application/x-mpegURL', url: HLS }] },
      { media_key: '7_102', type: 'video', preview_image_url: 'https://pbs.twimg.com/102.jpg',
        variants: [mp4(102, 10368000, '1920x1080'), mp4(102, 832000, '640x360'), mp4(102, 2176000, '1280x720')] },
      { media_key: '3_103', type: 'photo', url: 'https://pbs.twimg.com/103.jpg' },
      { media_key: '7_104', type: 'video', preview_image_url: 'https://pbs.twimg.com/104.jpg' },
      { media_key: '7_105', type: 'video', preview_image_url: 'https://pbs.twimg.com/105.jpg', variants: [mp4(105, 832000, '640x360')] },
      { media_key: '7_107', type: 'video', preview_image_url: 'https://pbs.twimg.com/107.jpg', variants: [mp4(107, 832000, '640x360')] },
      { media_key: '16_106', type: 'animated_gif', preview_image_url: 'https://pbs.twimg.com/106.jpg', variants: [mp4(106, 0, 'gif')] },
    ],
  },
};

// Variant choice: HLS first when asked (reels players), else the richest mp4
// under the cap, else the smallest. The web feed's bare <video> cannot play HLS.
assert.strictEqual(bestVariant(FIXTURE.includes.media[0].variants, true), HLS);
assert.match(bestVariant(FIXTURE.includes.media[0].variants), /1280x720/);
assert.match(bestVariant(FIXTURE.includes.media[1].variants), /1280x720/);
assert.match(bestVariant([mp4(9, 10368000, 'big'), mp4(9, 5000000, 'mid')]), /mid/);
assert.strictEqual(bestVariant(undefined), '');

const x = new XProvider();
const byId = Object.fromEntries(x.mapResponse(FIXTURE).map((p) => [p.id, p]));
assert.match(byId.x_101.media[0].url, /1280x720/);
assert.strictEqual(x.mapResponse(FIXTURE, true)[0].media[0].url, HLS);
assert.strictEqual(byId.x_101.metrics.views, 120000);
assert.strictEqual(byId.x_101.url, 'https://x.com/streetcam/status/101');
// Sensitive footage is kept and flagged, never dropped.
assert.strictEqual(byId.x_102.graphic, true);
assert.strictEqual(byId.x_101.graphic, false);
// ...but sensitive + sexual reads as porn spam and stays dropped.
assert.ok(!byId.x_107, 'sexual sensitive X must be dropped');
// A clip with no variants degrades to its poster instead of an empty video url.
assert.deepStrictEqual(byId.x_104.media, [{ type: 'image', url: 'https://pbs.twimg.com/104.jpg' }]);
assert.match(byId.x_106.media[0].url, /gif/);

(async () => {
  // The global feed runs one query per topic family and merges them: the
  // disaster query answers with the back half of the fixture, the others with
  // the front, overlapping on 103/104 - which must come back once.
  const queries = [];
  x.search = async (q, l, since, hls) => {
    queries.push(q);
    const all = x.mapResponse(FIXTURE, hls);
    return /state of emergency/.test(q) ? all.slice(2) : all.slice(0, 4);
  };
  const feed = await x.fetchGlobal({ limit: 10 });
  assert.strictEqual(new Set(queries).size, X_GLOBAL_QUERIES.length, 'one distinct query per family');
  assert.ok(queries.every((q) => /right now/.test(q) && /lang:en/.test(q)), 'every family keeps the first-hand filter');
  const ids = feed.map((p) => p.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'merged feed has no duplicate ids');
  assert.deepStrictEqual(ids, ['x_101', 'x_102', 'x_103', 'x_104', 'x_105', 'x_106'], 'merge keeps every family, dedupes the overlap');
  // Sensitive X rides every lane flagged graphic: the client veils it, never bare.
  const g = feed.find((p) => p.id === 'x_102');
  assert.ok(g && g.graphic === true, 'feed lane carries graphic X, flagged');
  x.search = async (q, l, since, hls) => x.mapResponse(FIXTURE, hls);

  // /reels pipeline: a mostly-text Reddit pool plus one Reddit clip, beside X.
  const text = Array.from({ length: 60 }, (_, i) => ({ id: 'reddit_t' + i, platform: 'reddit', text: 'plain text post number ' + i + ' with no clip',
    url: 'https://www.reddit.com/r/worldnews/' + i, createdAt: now - H, metrics: { score: 50, replies: 5 }, media: [] }));
  const redditClip = { id: 'reddit_v1', platform: 'reddit', text: 'Crowd surges through the barricade as police retreat', url: 'https://www.reddit.com/r/news/v1',
    createdAt: now - 6 * H, metrics: { score: 3000, replies: 400 }, graphic: false, media: [{ type: 'video', url: 'https://v.redd.it/v1/DASH_720.mp4' }] };
  const reels = await aggregateReels({ limit: 400 }, [
    { fetchGlobal: async () => [...text, redditClip] },
    { fetchReels: (o) => x.fetchReels(o) },
  ]);
  // Only fresh playable clips, most engaged per hour first: the old clip (105),
  // the photo (103) and the variant-less clip (104) are out. Graphic 102 is IN,
  // flagged, for the client's veil.
  assert.deepStrictEqual(reels.map((p) => p.id), ['x_101', 'reddit_v1', 'x_102', 'x_106']);
  assert.strictEqual(reels.find((p) => p.id === 'x_102').graphic, true, 'graphic clip is flagged for the veil');
  assert.strictEqual(reels[0].media[0].url, HLS);
  assert.ok(reels.every((p) => p.provenance && p.provenance.sourceHost && p.provenance.responseHash), 'client refuses items without provenance');

  // /curated: the curator's push lands in memory and comes back in the /reels
  // item shape plus its labels; a wrong (or missing) key is 401. Over a real
  // socket on a free port - the handler is the thing under test, not a stub.
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  const call = (method, path, body, headers) => new Promise((resolve, reject) => {
    // agent:false - a kept-alive socket held the server (and the process) open for minutes after close().
    const rq = http.request({ host: '127.0.0.1', port, method, path, agent: false, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, (rs) => {
      let d = ''; rs.on('data', (c) => { d += c; }); rs.on('end', () => resolve({ status: rs.statusCode, body: JSON.parse(d) }));
    });
    rq.on('error', reject); rq.end(body ? JSON.stringify(body) : undefined);
  });
  const push = { generated: '2026-10-07T12:00:00.000Z', items: [
    { key: 'bsky_c1', platform: 'bluesky', text: 'Riot police push the crowd back at the bridge', caption: 'Police line breaks at the bridge', video: 'https://video.bsky.app/watch/did/cid1/playlist.m3u8',
      thumb: 'https://video.bsky.app/t1.jpg', url: 'https://bsky.app/profile/a/post/1', createdAt: iso(2), likes: 1200, reposts: 300, graphic: false, genre: 'footage', topic: 'protest', fit: 0.9, labeledAt: iso(0) },
    { key: 'bad', platform: 'x', text: 'no playable video', video: '', fit: 1 },
  ] };
  assert.strictEqual((await call('GET', '/curated?limit=30')).body.items.length, 0, 'nothing before the first push');
  assert.strictEqual((await call('POST', '/curated/ingest', push, { 'x-curator-key': 'wrong' })).status, 401);
  assert.strictEqual((await call('POST', '/curated/ingest', push)).status, 401, 'no key is no key');
  assert.deepStrictEqual((await call('POST', '/curated/ingest', push, { 'x-curator-key': 'test-curator-key' })).body, { ok: true, count: 1 }, 'the clip without a video is dropped');
  const got = (await call('GET', '/curated?limit=30')).body;
  assert.strictEqual(got.generated, push.generated);
  const c = got.items[0];
  assert.strictEqual(c.id, 'cur_bsky_c1');
  assert.strictEqual(c.createdAt, Date.parse(push.items[0].createdAt), 'createdAt is ms like every other lane');
  assert.deepStrictEqual(c.media, [{ type: 'video', url: push.items[0].video, thumb: push.items[0].thumb }]);
  assert.deepStrictEqual(c.metrics, { score: 1200, reposts: 300, replies: 0, views: 0 });
  assert.deepStrictEqual([c.caption, c.genre, c.topic, c.fit, c.graphic], ['Police line breaks at the bridge', 'footage', 'protest', 0.9, false]);
  assert.ok(c.provenance && c.provenance.sourceHost === 'bsky.app' && c.provenance.responseHash, 'curated items carry provenance or the client refuses them');
  assert.ok((await call('GET', '/health')).body.endpoints.includes('/curated?limit=30'));
  server.close();

  console.log('void-proxy test.js: ok');
})().catch((e) => { console.error(e); process.exit(1); });
