'use strict';
// Offline self-check for the X media mapping and /reels. `npm test`.
// X bills per post read, so this never touches the API: the bearer is blanked,
// fetch throws if anything tries the network, and X's response is a fixture
// shaped like a real v2 recent-search answer.
process.env.X_BEARER = '';
process.env.X_MAX_SHARE = '0.15';
globalThis.fetch = () => { throw new Error('test.js must stay offline'); };

const assert = require('assert');
const { XProvider, bestVariant, aggregateReels } = require('./server');

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
  // /feed and /social still hold sensitive X back from clients that cannot veil.
  x.search = async (q, l, since, hls) => x.mapResponse(FIXTURE, hls);
  const feedIds = (await x.fetchGlobal({ limit: 10 })).map((p) => p.id);
  assert.ok(feedIds.includes('x_101') && !feedIds.includes('x_102'), 'feed lane must not carry graphic X');

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
  // the photo (103) and the variant-less clip (104) are out, and so is graphic
  // 102 until a client maps graphic -> _graphic (see unveiledOnly).
  assert.deepStrictEqual(reels.map((p) => p.id), ['x_101', 'reddit_v1', 'x_106']);
  assert.strictEqual(reels[0].media[0].url, HLS);
  assert.ok(reels.every((p) => p.provenance && p.provenance.sourceHost && p.provenance.responseHash), 'client refuses items without provenance');

  console.log('void-proxy test.js: ok');
})().catch((e) => { console.error(e); process.exit(1); });
