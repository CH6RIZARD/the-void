// Golden tests: the ORIGINAL functions from void2-final.html (run in a vm sandbox)
// versus the TS port, on the same inputs, with the same seeded RNG and frozen clock.
// Run: node --test src/core/__tests__/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32, webSandbox, type WebSandbox } from './webHarness.ts';
import * as core from '../index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (f: string) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', f), 'utf8'));
const NOW = Date.UTC(2026, 8, 17, 2, 0, 0);
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

function freshCore(seed = 7) {
  core.configureCore({
    storage: core.createMemoryStorage(), session: core.createMemoryStorage(),
    now: () => NOW, random: mulberry32(seed), proxyBase: '',
  });
  core._badStreams.clear(); core.resetStories(); core.resetStore();
}
function web(seed = 7): WebSandbox { return webSandbox({ seed, now: NOW }); }
function setIn(w: WebSandbox, name: string, v: unknown) { w.run(`var ${name}=JSON.parse(${JSON.stringify(JSON.stringify(v))});`); }
const wjson = (w: WebSandbox, expr: string) => JSON.parse(w.run(`JSON.stringify(${expr})`));
const reSig = (r: RegExp) => r.source + '/' + r.flags;

const REGION = ['C', 'REGION_ALIASES', '_regionNorm', '_REGION_ALIAS_N', '_regionByName', '_regionByCode', 'resolveRegion', 'stampRegion'];
const TAGS = ['TAG_KEYWORDS', 'TAG_RE', 'CRISIS_WEAK', 'CRISIS_INTL', 'inferTags'];
const STORY = ['TENSION_TAGS', 'SPIKE_HALF_LIFE_H', 'hasTension', 'postAgeH', 'velocity', 'isBreaking', 'STORY_KIND', 'STORY_PLACE_HINTS', '_placeRe', 'regionInText',
  'STORY_STOP', 'storyTokens', 'storyInfo', '_stories', '_storyTokIdx', 'storyOf', 'noteStory', 'storySources', 'storyBoostsLeft', 'breakingLift', 'controversyLift'];
const SEEN = ['_SEEN_CAP', '_h', '_loadSeen', '_seenIds', '_seenDirty', '_normText', '_linkKey', 'admitPost'];
const WALL = ['TENSION_RANK', 'rankOf', 'CAM_SOURCES', 'RAW_FOOTAGE', 'NEWS_SOURCES', 'IPTV_JSON', 'LIFE_JSON', '_iptvPool', 'iptvFor', '_lifePool', 'lifeFor',
  'EMBEDDABLE_IFRAME', 'IFRAME_PLAYER_URL', '_badStreams', 'markBadStream', 'isBadStream', 'USED_STREAMS_KEY', 'streamKey', 'usedStreamKeys', 'rememberStream', 'lifeMix', 'wallSlots', 'wallCascadeFor'];

// ─── constants copied by hand must equal the web's ──────────────────────
test('hand-ported constants and regexes match the web', () => {
  const w = web();
  w.load(...REGION, ...TAGS, ...STORY, 'SUBJECTS', 'BSKY_FEEDS', 'REEL_FEEDS_META', 'REEL_FEEDS', 'REEL_BLOCK_LABELS', 'REEL_BLOCK_AUTHOR_LABELS',
    'REEL_BLOCK_TOPIC_WORDS', 'REEL_BLOCK_TOPIC_EMOJI', 'REEL_TOPIC_HOSTS', 'REEL_TOPIC_TERMS', 'REEL_PEERTUBE', 'ANIMAL_WORDS', 'ANIMAL_CJK', 'ANIMAL_EMOJI',
    'CONNECT_TIMEOUT', 'EMBEDDABLE_IFRAME', 'IFRAME_PLAYER_URL', 'NATION_GLOBAL_BRANDS', 'TENSION_RANK', 'SEARCH_BSKY_FEEDS', 'FEED_SUBS', 'SUB_TAGS',
    'GLOBAL_POOL', 'LIVE_CHANNELS', 'COUNTRY_CH', 'VOID_LIVE', 'CAM_SOURCES', 'RAW_FOOTAGE', 'NEWS_SOURCES', 'NATION_VOCAB', 'NF_RADIO_HOSTS', 'NF_GAP', 'NF_RETRY', 'STORY_TOP_N');
  assert.deepEqual(core.TAG_KEYWORDS, wjson(w, 'TAG_KEYWORDS'));
  for (const n of ['CRISIS_WEAK', 'CRISIS_INTL', 'REEL_BLOCK_LABELS', 'REEL_BLOCK_AUTHOR_LABELS', 'REEL_BLOCK_TOPIC_WORDS', 'REEL_BLOCK_TOPIC_EMOJI', 'ANIMAL_WORDS', 'ANIMAL_CJK', 'ANIMAL_EMOJI', 'EMBEDDABLE_IFRAME', 'IFRAME_PLAYER_URL'])
    assert.equal(reSig((core as any)[n]), w.run(`${n}.source+'/'+${n}.flags`), n);
  assert.deepEqual(core.STORY_KIND.map(([k, r]) => [k, reSig(r)]), w.run(`JSON.stringify(STORY_KIND.map(([k,r])=>[k,r.source+'/'+r.flags]))`) && wjson(w, `STORY_KIND.map(([k,r])=>[k,r.source+'/'+r.flags])`));
  assert.deepEqual(core.SUBJECTS.map(([k, r]) => [k, reSig(r)]), wjson(w, `SUBJECTS.map(([k,r])=>[k,r.source+'/'+r.flags])`));
  assert.deepEqual(core.NATION_GLOBAL_BRANDS.map(([r, k]) => [reSig(r), k]), wjson(w, `NATION_GLOBAL_BRANDS.map(([r,k])=>[r.source+'/'+r.flags,k])`));
  assert.deepEqual([...core.STORY_STOP], wjson(w, '[...STORY_STOP]'));
  assert.deepEqual(core.STORY_PLACE_HINTS, wjson(w, 'STORY_PLACE_HINTS'));
  assert.deepEqual([...core.TENSION_TAGS], wjson(w, '[...TENSION_TAGS]'));
  for (const n of ['BSKY_FEEDS', 'REEL_FEEDS_META', 'REEL_FEEDS', 'REEL_TOPIC_HOSTS', 'REEL_TOPIC_TERMS', 'REEL_PEERTUBE', 'CONNECT_TIMEOUT', 'TENSION_RANK', 'SEARCH_BSKY_FEEDS',
    'FEED_SUBS', 'SUB_TAGS', 'GLOBAL_POOL', 'LIVE_CHANNELS', 'COUNTRY_CH', 'VOID_LIVE', 'CAM_SOURCES', 'RAW_FOOTAGE', 'NEWS_SOURCES', 'NATION_VOCAB', 'C', 'REGION_ALIASES', 'NF_RADIO_HOSTS', 'NF_GAP', 'NF_RETRY', 'STORY_TOP_N'])
    assert.deepEqual(plain((core as any)[n]), wjson(w, n), n);
  assert.deepEqual([...core.YT_DEAD_CODES], [100, 101, 150, 153]);
  // Pools: the TS data must equal the strings embedded in the web file.
  w.load('IPTV_JSON', 'LIFE_JSON');
  assert.deepEqual(plain(core.IPTV_POOL), JSON.parse(w.run('IPTV_JSON')));
  assert.deepEqual(plain(core.LIFE_POOL), JSON.parse(w.run('LIFE_JSON')));
});

// ─── inferTags ──────────────────────────────────────────────────────────
test('inferTags matches the web on real post texts (+ multilingual crisis)', () => {
  const w = web(); w.load(...TAGS);
  const texts: string[] = fx('post-texts.json');
  const extra = [
    'Floods in Nepal: 1,300 dead, rescuers still searching the Bhotekoshi',
    'बाढीले काठमाडौंमा ५० जनाको मृत्यु', 'Terremoto en México deja decenas de muertos', 'Hochwasser in Bayern: Sturzflut reißt Häuser mit',
    '洪水で行方不明者多数', 'Наводнение: погибли 12 человек', 'hand warmers recalled', 'a couple months of gardening',
    'The AI chatbot leaked the documents they knew about', 'dead tired, missing my cat 🐈', 'Villages swept away, survivors trapped',
  ];
  const all = [...texts, ...extra];
  assert.ok(all.length >= 30);
  for (const t of all) {
    assert.deepEqual(core.inferTags(t), wjson(w, `inferTags(${JSON.stringify(t)})`), t.slice(0, 60));
    assert.deepEqual(core.inferTags(t, ['graphic']), wjson(w, `inferTags(${JSON.stringify(t)},['graphic'])`));
  }
});

// ─── wallSlots / wallCascadeFor ─────────────────────────────────────────
function loadWall(w: WebSandbox) { w.load(...REGION, ...WALL); }
test('wallSlots: identical slot order to the web (seeded), 3 life : 7 news at positions 3/6/9', () => {
  for (const seed of [1, 42, 2026]) {
    freshCore(seed);
    const w = web(seed); loadWall(w);
    const mine = core.wallSlots();
    const theirs = wjson(w, 'wallSlots()');
    assert.equal(mine.length, theirs.length);
    assert.deepEqual(plain(mine), theirs, 'seed ' + seed);
    // Ratio: while both pools have items, every window of 10 = life at 2,5,8.
    const lifeTotal = mine.filter(s => s.kind === 'life').length, newsTotal = mine.length - lifeTotal;
    const both = Math.min(Math.floor(lifeTotal / 3), Math.floor(newsTotal / 7)) * 10;
    for (let i = 0; i < both; i++) assert.equal(mine[i].kind, [2, 5, 8].includes(i % 10) ? 'life' : 'news', 'slot ' + i);
    let lifeInWindows = 0; for (let i = 0; i < both; i++) if (mine[i].kind === 'life') lifeInWindows++;
    assert.equal(lifeInWindows * 10, both * 3);
  }
});

test('wallSlots: session sink + bad streams behave like the web', () => {
  const seed = 99;
  freshCore(seed);
  const w = web(seed); loadWall(w);
  const first = core.wallSlots().slice(0, 25);
  // Remember the first 20 (shown), mark 5 bad — same on both sides.
  first.slice(0, 20).forEach(s => core.rememberStream(s.src));
  first.slice(20, 25).forEach(s => core.markBadStream(s.src));
  setIn(w, '__shown', first.slice(0, 20).map(s => s.src));
  setIn(w, '__bad', first.slice(20, 25).map(s => s.src));
  w.run('__shown.forEach(rememberStream);__bad.forEach(markBadStream);');
  // Re-seed both RNGs identically for the rebuild.
  core.configureCore({ random: mulberry32(5) }); w.setRandom(mulberry32(5));
  const mine = core.wallSlots(), theirs = wjson(w, 'wallSlots()');
  assert.deepEqual(plain(mine), theirs);
  const badKeys = new Set(first.slice(20, 25).map(s => core.streamKey(s.src)));
  assert.ok(mine.every(s => !badKeys.has(core.streamKey(s.src))), 'bad streams are never slotted');
  // Shown streams sink to the back of their own pool.
  const shownKeys = new Set(first.slice(0, 20).map(s => core.streamKey(s.src)));
  const lifeOrder = mine.filter(s => s.kind === 'life'), firstShown = lifeOrder.findIndex(s => shownKeys.has(core.streamKey(s.src)));
  if (firstShown >= 0) assert.ok(lifeOrder.slice(firstShown).every(s => shownKeys.has(core.streamKey(s.src))));
});

test('wallCascadeFor: same-kind cascade matches the web', () => {
  const seed = 3;
  freshCore(seed);
  const w = web(seed); loadWall(w);
  core.configureCore({ random: mulberry32(11) }); w.setRandom(mulberry32(11));
  const names = ['Japan', 'Turkey', 'Nepal', 'United States', 'Morocco', 'France', 'Ukraine'];
  for (const n of names) {
    const life = [...(core.CAM_SOURCES[n] || []), ...core.lifeFor(n)][0] || null;
    const news = core.iptvFor(n)[0] || null;
    for (const first of [null, life, news]) {
      const mine = core.wallCascadeFor(n, first);
      setIn(w, '__first', first);
      const theirs = wjson(w, `wallCascadeFor(${JSON.stringify(n)}, __first)`);
      assert.deepEqual(plain(mine), theirs, n + ' first=' + (first && first.label));
      assert.ok(mine.length <= 3);
    }
  }
});

// ─── nationStreamSources ────────────────────────────────────────────────
test('nationStreamSources: Japan / Morocco / Nepal equal the web, with no foreign channels', async () => {
  freshCore();
  const w = web();
  loadWall(w);
  w.load('placeToSource', 'nationStreamSources', 'NATION_GLOBAL_BRANDS', '_nationOwners', 'nationStreamOwners', 'nationSourceForeign');
  // Region view + proxy stubs that deliberately try to smuggle foreign streams in.
  const rv = (n: string) => ({
    places: [
      { name: n + ' Harbour Cam', kind: 'hls', stream_url: 'https://cams.example/' + n + '.m3u8' },
      { name: 'Al Jazeera English', kind: 'youtube', stream_url: 'https://www.youtube.com/watch?v=gCNeDWCI0vo' },
      { name: 'Portal', kind: 'embed', stream_url: 'https://worldcams.tv/x/embed/1' },
      { name: 'bad', kind: 'rtsp', stream_url: 'rtsp://x' },
    ],
  });
  const proxy = [{ type: 'youtube', id: 'LuKwFajn37U', label: 'DW News live' }, { type: 'hls', url: 'https://proxy.example/local.m3u8', label: 'Local proxy stream' }];
  for (const n of ['Japan', 'Morocco', 'Nepal']) {
    const c = core.C.find(x => x.n === n)!;
    const mine = await core.nationStreamSources(c, { regionView: async () => rv(n) as any, proxy: async () => proxy });
    setIn(w, '__rv', rv(n)); setIn(w, '__proxy', proxy);
    w.run('nationRegionView=async()=>__rv; pullLiveStreams=async()=>__proxy;');
    const theirs = JSON.parse(await w.run(`nationStreamSources(${JSON.stringify(c)}).then(x=>JSON.stringify(x))`));
    assert.deepEqual(plain(mine), theirs, n);
    assert.ok(mine.length > 0, n + ' has streams');
    for (const s of mine) {
      assert.equal(core.nationSourceForeign(s, n), false, n + ': foreign ' + s.label);
      for (const [re, home] of core.NATION_GLOBAL_BRANDS) if (re.test(String(s.label || ''))) assert.equal(home, n, n + ': global brand ' + s.label);
    }
    // Smuggled foreign streams are gone; the nation's own place and proxy stream stay.
    assert.ok(!mine.some(s => /al jazeera|dw/i.test(String(s.label || ''))), n + ': foreign brand leaked');
    assert.ok(mine.some(s => s.label === n + ' Harbour Cam'));
  }
});

// ─── rankScore / orderFeedBatch ─────────────────────────────────────────
function loadRank(w: WebSandbox) {
  w.load(...REGION, ...TAGS, ...STORY, ...SEEN, '_refreshBoost', 'textFit', 'earned', 'BIO');
  w.stmt('Object.assign(BIO,{');
  w.load('SUBJECTS', 'subjectOf', 'spreadSubjects', 'diversify', 'STORY_TOP_N', 'spreadStories', 'orderFeedBatch', 'decodeEnt', 'isFeedMeta', 'bskyToPost');
}
function rankPool(): core.Post[] {
  const H = 3600000;
  const base = fx('bsky-feed.json').feed.map((it: any) => core.bskyToPost(it));
  const synth: any[] = [
    { id: 's_flood1', body: 'Glacial flood in Nepal: death toll passes 1,300 as rescuers dig through mud', tags: [], score: 9000, _reposts: 2400, _quotes: 300, replies: 800, time: NOW - 2 * H, _handle: '@reuters.com', _wire: true, country: '' },
    { id: 's_flood2', body: 'Whole villages gone along the Bhotekoshi, Nepal. Survivors trapped, nobody is answering', tags: [], score: 1200, _reposts: 300, replies: 90, time: NOW - 3 * H, _handle: '@ram.bsky.social', country: '' },
    { id: 's_flood3', body: 'Nepal flood: families wait at the Bhotekoshi bridge', tags: [], score: 40, replies: 2, time: NOW - 1 * H, _handle: '@sita.bsky.social', country: '' },
    { id: 's_long', body: 'x'.repeat(420), tags: ['philosophy'], score: 5, replies: 0, time: NOW - 30 * H, _handle: '@a.bsky.social', country: '' },
    { id: 's_argue', body: 'Sanctions are a slow war and everyone knows it', tags: [], score: 300, _quotes: 90, replies: 200, time: NOW - 5 * H, _handle: '@b.bsky.social', country: 'Iran' },
    { id: 's_trump1', body: 'Trump says the summit is off', tags: [], score: 2000, replies: 10, time: NOW - 4 * H, _handle: '@c.bsky.social', country: '' },
    { id: 's_trump2', body: 'Trump again, the border and the troops', tags: [], score: 1900, replies: 10, time: NOW - 4 * H, _handle: '@d.bsky.social', country: '' },
    { id: 's_img', body: 'Protest in Tehran tonight', tags: [], score: 800, replies: 40, time: NOW - 6 * H, _img: 'https://x/y.jpg', _handle: '@e.bsky.social', country: '' },
  ];
  for (const s of synth) { s.tags = core.inferTags(s.body, s.tags); s.style = s._img ? 'image' : 'take'; s.source = 'bluesky'; s.iso = ''; s._social = true; }
  return [...base, ...synth];
}
test('rankScore: same scores and ordering as the web on a fixed pool', () => {
  freshCore();
  const w = web(); loadRank(w);
  const tags = { warfare: 40, geopolitics: 25, crisis: 5, animals: 10, resistance: 30 };
  Object.assign(core.BIO.tags, tags); core.BIO.regions = { Iran: 12 }; core.BIO.formats = { image: 20, video: 8 };
  setIn(w, '__bio', { tags, regions: { Iran: 12 }, formats: { image: 20, video: 8 } });
  w.run('Object.assign(BIO.tags,__bio.tags);BIO.regions=__bio.regions;BIO.formats=__bio.formats;');
  const pool = rankPool();
  setIn(w, '__pool', pool);
  pool.forEach(p => core.noteStory(p)); w.run('__pool.forEach(noteStory)');
  const mineScores = pool.map(p => core.BIO.rankScore(p));
  const theirScores: number[] = wjson(w, '__pool.map(p=>BIO.rankScore(p))');
  mineScores.forEach((s, i) => assert.ok(Math.abs(s - theirScores[i]) < 1e-9, `${pool[i].id}: ${s} vs ${theirScores[i]}`));
  const byScore = (xs: number[]) => pool.map((p, i) => [p.id, xs[i]] as [string, number]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  assert.deepEqual(byScore(mineScores), byScore(theirScores));
  // Full batch ordering (rank -> story cap -> diversify -> subject spread -> story spread).
  const mineOrder = core.orderFeedBatch(pool.slice()).map(p => p.id);
  const theirOrder = wjson(w, 'orderFeedBatch(__pool.slice()).map(p=>p.id)');
  assert.deepEqual(mineOrder, theirOrder);
  // Refresh lift puts new ids on top for one pass.
  const sl = pool.find(p => p.id === 's_long')!, before = core.BIO.rankScore(sl);
  core.setRefreshBoost(new Set(['s_long']));
  assert.equal(Math.round(core.BIO.rankScore(sl) - before), 1e4);
  core.setRefreshBoost(null);
});

// ─── admitPost ──────────────────────────────────────────────────────────
test('admitPost dedupe: id / same text / same article / repost exemption match the web', () => {
  freshCore();
  const w = web(); loadRank(w);
  const P = (o: any) => ({ tags: [], score: 0, replies: 0, time: NOW, source: 'bluesky', country: '', iso: '', style: 'take', ...o });
  const seq = [
    P({ id: 'a1', body: 'The ceasefire collapsed overnight in the north' }),
    P({ id: 'a1', body: 'anything' }),                                                    // same id
    P({ id: 'a2', body: 'THE ceasefire collapsed — overnight in the north!!' }),            // same normalised text
    P({ id: 'a3', body: 'short', _link: 'https://www.nytimes.com/2026/09/16/world/x.html?utm=1' }),
    P({ id: 'a4', body: 'different words entirely here', _link: 'https://nytimes.com/2026/09/16/world/x.html/' }), // same article
    P({ id: 'a5', body: 'The ceasefire collapsed overnight in the north', _repost: true }), // repost exempt
    P({ id: 'a6', body: 'tiny' }), P({ id: 'a7', body: 'tiny' }),                          // <=15 chars: id only
    P({ id: 'a8', body: 'https://t.co/abc The ceasefire collapsed overnight in the north' }), // URL stripped -> same text
    null, P({ id: '', body: 'no id' }),
  ];
  setIn(w, '__seq', seq);
  const mine = seq.map(p => core.admitPost(p as any));
  const theirs = wjson(w, '__seq.map(p=>admitPost(p))');
  assert.deepEqual(mine, theirs);
  assert.deepEqual(mine, [true, false, false, true, false, true, true, true, false, false, false]);
  assert.deepEqual([...core._seenIds], wjson(w, '[..._seenIds]'));
  assert.deepEqual([...core._seenText], wjson(w, '[..._seenText]'));
  assert.deepEqual([...core._seenLink], wjson(w, '[..._seenLink]'));
  // Persisted across a "relaunch".
  core.persistSeen();
  const storage = core.env.storage;
  core.configureCore({ storage });
  assert.equal(core.admitPost(P({ id: 'a1', body: 'x' }) as any), false);
});

// ─── source mappers ─────────────────────────────────────────────────────
test('bskyToPost maps saved payloads exactly like the web', () => {
  freshCore();
  const w = web(); loadRank(w);
  const items = fx('bsky-feed.json').feed;
  // Synthetic variants the live sample lacked: repost reason, recordWithMedia video, labels.
  const v = JSON.parse(JSON.stringify(items[0]));
  v.reason = { $type: 'app.bsky.feed.defs#reasonRepost' }; v.post.cid = 'synthetic1';
  v.post.labels = [{ val: 'graphic-media' }];
  v.post.embed = { $type: 'app.bsky.embed.recordWithMedia#view', media: { $type: 'app.bsky.embed.video#view', playlist: 'https://video.bsky.app/x/playlist.m3u8', thumbnail: 'https://video.bsky.app/x/thumb.jpg' } };
  const all = [...items, v];
  setIn(w, '__items', all);
  assert.deepEqual(plain(all.map(core.bskyToPost)), wjson(w, '__items.map(bskyToPost)'));
  const p = core.bskyToPost(v);
  assert.equal(p._repost, true); assert.equal(p.style, 'video'); assert.equal(p._graphic, true);
});

test('mastoToPost maps saved payloads exactly like the web', () => {
  freshCore();
  const w = web(); w.load(...TAGS, 'urlKey', 'htmlText', 'mastoToPost');
  const sts = fx('mastodon-statuses.json');
  const reblog = { id: '1', reblog: sts[0], content: '', media_attachments: [] };
  const audio = { ...sts[1], id: '99', uri: 'https://x.social/users/a/statuses/99', media_attachments: [{ type: 'audio', url: 'https://x.social/a.mp3', meta: { original: { duration: 61.6 } } }], content: '<p>Radio &amp; <br>news</p>', sensitive: true };
  const all = [...sts, reblog, audio];
  const c = { n: 'Nepal' };
  setIn(w, '__sts', all);
  assert.deepEqual(plain(all.map(s => core.mastoToPost(s, c))), wjson(w, '__sts.map(s=>mastoToPost(s,{n:"Nepal"}))'));
  const a = core.mastoToPost(audio, c)!;
  assert.equal(a.style, 'audio'); assert.equal(a._audioDur, 62); assert.equal(a.body, 'Radio & \nnews');
});

test('lemmyToPost maps saved payloads exactly like the web', () => {
  freshCore();
  const w = web(); w.load(...TAGS, 'urlKey', 'lemmyHost', 'lemmyToPost');
  const rows = fx('lemmy-posts.json').posts;
  const nsfw = JSON.parse(JSON.stringify(rows[0])); nsfw.post.nsfw = true;
  const all = [...rows, nsfw, {}];
  setIn(w, '__rows', all);
  assert.deepEqual(plain(all.map(v => core.lemmyToPost(v, { n: 'Japan' }))), wjson(w, '__rows.map(v=>lemmyToPost(v,{n:"Japan"}))'));
});

test('reddit / gdelt / proxy / comment mappers match the web', () => {
  freshCore();
  const w = web(); loadRank(w);
  w.load('SUB_TAGS', 'redditToPost', 'gdeltTime', 'urlKey', 'gdeltToPost', 'proxyPostToApp', 'htmlText', 'fediHost', 'mastoContextToComments', 'lemmyCommentsToComments');
  const reddit = [
    { data: { id: 'r1', title: 'Airstrike hits &amp; flattens a market in Kharkiv', subreddit: 'CombatFootage', over_18: true, score: 900, num_comments: 120, created_utc: 1789000000, permalink: '/r/x', author: 'u1', link_flair_text: 'Ukraine', is_video: true, media: { reddit_video: { fallback_url: 'https://v.redd.it/x/DASH_720.mp4' } } } },
    { data: { id: 'r2', title: 'Summit in Geneva', subreddit: 'worldnews', url: 'https://i.redd.it/a.jpg', thumbnail: 'self' } },
    { data: { id: 'r3', stickied: true } }, {},
  ];
  setIn(w, '__r', reddit);
  assert.deepEqual(plain(reddit.map(core.redditToPost)), wjson(w, '__r.map(redditToPost)'));
  const gd = [{ title: 'Kathmandu floods', url: 'https://kathmandupost.com/a?b=1', domain: 'kathmandupost.com', sourcecountry: 'Nepal', socialimage: 'https://k/i.jpg', seendate: '20260916T101500Z' }, { title: 'x' }];
  setIn(w, '__g', gd);
  assert.deepEqual(plain(gd.map(core.gdeltToPost)), wjson(w, '__g.map(gdeltToPost)'));
  const px = [
    { id: 9, text: 'Protest crackdown in Tehran', platform: 'x', handle: 'aljazeera.com', provenance: { sourceHost: 'x.com', responseHash: 'h' }, media: [{ type: 'video', url: 'https://v', thumb: 'https://t' }], metrics: { score: 5, replies: 2, reposts: 3, quotes: 4 }, country: 'Iran', createdAt: NOW - 1000, link: 'https://aljazeera.com/a' },
    { id: 10, text: 'no hash', provenance: { sourceHost: 'x.com' } },
  ];
  setIn(w, '__px', px);
  assert.deepEqual(plain(px.map(core.proxyPostToApp)), wjson(w, '__px.map(proxyPostToApp)'));
  const ctx = { descendants: [
    { id: '11', content: '<p><span class="h-card">@alice</span> @bob@x.social I disagree &mdash; strongly</p>', account: { acct: 'carol', display_name: 'Carol' }, created_at: '2026-09-16T10:00:00Z', favourites_count: 3, in_reply_to_id: '1' },
    { id: '12', content: '<p>agreed</p>', account: { username: 'dan' }, created_at: '2026-09-16T11:00:00Z', in_reply_to_id: '11', spoiler_text: 'cw' },
    { id: '13', visibility: 'direct', content: 'x' },
  ] };
  setIn(w, '__ctx', ctx);
  assert.deepEqual(plain(core.mastoContextToComments(ctx)), wjson(w, 'mastoContextToComments(__ctx)'));
  const lc = { comments: [
    { comment: { id: 5, content: 'See [this](https://x) **bold** > quote', path: '0.5', published: '2026-09-16T10:00:00.123' }, creator: { name: 'eve', actor_id: 'https://lemmy.ml/u/eve' }, counts: { score: 7 } },
    { comment: { id: 6, content: 'child', path: '0.5.6', published: '2026-09-16T10:05:00Z' }, creator: { name: 'fay' }, counts: { upvotes: 2 } },
    { comment: { id: 7, content: 'gone', removed: true } },
  ] };
  setIn(w, '__lc', lc);
  assert.deepEqual(plain(core.lemmyCommentsToComments(lc)), wjson(w, 'lemmyCommentsToComments(__lc)'));
});

// ─── nation terms / relevance ───────────────────────────────────────────
test('nationMentionRe / nationRelevance match the web', () => {
  freshCore();
  const w = web();
  w.load(...REGION, 'NATION_VOCAB', 'nationVocab', 'nfFold', 'nationCode', 'nationTerms', 'nationMentionRe', 'nationNamed', 'nationIsLocal', 'nationRelevance');
  const texts = ['Nepal floods', 'Nepalese villagers', 'Kathmandu tonight', 'Nepaleisk', '#nepal #travel #sunset', 'Indiana Jones', 'India votes', 'Japan\'s PM', '日本の地震', 'Morocco quake: Marrakech', 'Moroccan tea', 'Marruecos', 'nothing here', 'Ukrainian drones', 'Kiev'];
  for (const n of ['Nepal', 'Japan', 'Morocco', 'India', 'Ukraine']) {
    const c = { ...core.C.find(x => x.n === n)! };
    setIn(w, '__c', c);
    assert.equal(reSig(core.nationMentionRe({ ...c })), w.run('(r=>r.source+"/"+r.flags)(nationMentionRe(__c))'), n);
    for (const t of texts) {
      assert.equal(core.nationRelevance({ body: t, country: '' }, { ...c }), w.run(`nationRelevance({body:${JSON.stringify(t)},country:''},__c)`), n + ': ' + t);
    }
  }
});

// ─── frameVerdict ───────────────────────────────────────────────────────
test('frameVerdict (pure RGBA) matches the canvas-based web version', () => {
  const W = 32, H = 18;
  const make = (f: (x: number, y: number) => [number, number, number]) => { const d = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = f(x, y); const i = (y * W + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; } return d; };
  const bars7: Array<[number, number, number]> = [[192, 192, 192], [192, 192, 0], [0, 192, 192], [0, 192, 0], [192, 0, 192], [192, 0, 0], [0, 0, 192]];
  const rnd = mulberry32(4);
  const frames: Record<string, Uint8ClampedArray> = {
    bars: make(x => bars7[Math.floor(x / (W / 7))]),
    slate: make(() => [20, 60, 160]),
    black: make(() => [0, 0, 0]),
    noise: make(() => [rnd() * 255, rnd() * 255, rnd() * 255]),
    stripes: make(x => (x % 4 < 2 ? [200, 30, 30] : [30, 30, 200])),
    gradient: make((x, y) => [x * 8, y * 14, 90]),
  };
  const w = web(); w.load('frameVerdict');
  for (const [name, px] of Object.entries(frames)) {
    setIn(w, '__px', Array.from(px));
    w.run(`_fvCanvas=null;document.createElement=()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:__px})})});`);
    const theirs = w.run('frameVerdict({readyState:4,videoWidth:640})');
    assert.equal(core.frameVerdict(px), theirs, name);
  }
  assert.equal(core.frameVerdict(frames.bars), 'bars');
  assert.equal(core.frameVerdict(frames.slate), 'slate');
  assert.equal(core.frameVerdict(frames.noise), 'ok');
  assert.equal(core.frameVerdict(null), null);
});
