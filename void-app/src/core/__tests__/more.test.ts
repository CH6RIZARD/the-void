// Further parity + invariant tests: URL parsing vs WHATWG, stream liveness, the feed
// intent gate, and the nation-feed format interleave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32, webSandbox } from './webHarness.ts';
import * as core from '../index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (f: string) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', f), 'utf8'));
const NOW = Date.UTC(2026, 8, 17, 2, 0, 0);
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
// No test reaches the network. vwFill tops the reel pool up in the background, and
// that pull used to go out to the real PeerTube and Bluesky hosts from a test run.
const noNet = (async () => ({ ok: false, status: 0, json: async () => null })) as any;
function fresh(seed = 7) {
  core.configureCore({ storage: core.createMemoryStorage(), session: core.createMemoryStorage(), now: () => NOW, random: mulberry32(seed), proxyBase: '', fetch: noNet });
  core._badStreams.clear(); core.resetStories(); core.resetStore(); core._vwForgetAll();
}

test('parseUrl agrees with WHATWG URL on host/hostname/pathname (RN has no URL getters)', () => {
  const urls = ['https://www.nytimes.com/2026/09/16/world/x.html?utm=1#a', 'https://Mastodon.Social/@a/123', 'https://lemmy.world/post/42/', 'http://example.com',
    'https://example.com:443/x', 'https://example.com:8443/x', 'https://user:pw@host.io/p', 'https://bsky.app/profile/a.b/post/xyz'];
  for (const u of urls) {
    const a = new URL(u), b = core.parseUrl(u);
    assert.deepEqual({ host: b.host, hostname: b.hostname, pathname: b.pathname }, { host: a.host, hostname: a.hostname, pathname: a.pathname }, u);
  }
  for (const bad of ['', 'nytimes.com/x', '/relative']) assert.throws(() => core.parseUrl(bad));
});

test('liveVidFor / streamCascade / placeToSource match the web', () => {
  fresh();
  const w = webSandbox({ now: NOW });
  w.load('VOID_LIVE', '_liveById', 'liveVidFor', 'streamCascade', 'placeToSource');
  const srcs = [{ type: 'youtube', id: 'UCknLrEdhRCp1aegoMqRaCZg' }, { type: 'youtube', id: 'UCNye-wNBqNL5ZzHSJdpkiXA' }, { type: 'youtube', id: 'dfVK7ld38Ys' },
    { type: 'youtube', id: 'PLy3M3NZhhs5wCP_U9nTuoTZUvB_LgAkSi' }, { type: 'youtube', id: 'UCx', vid: 'abcdefghijk' }, { type: 'hls', url: 'https://x.m3u8' },
    { label: 'multi', thumbnail: 't', cascade: [{ type: 'hls', url: 'a' }, { type: 'rtsp', url: 'b' }, { type: 'youtube', id: 'c', poster: 'p' }] }];
  w.run(`var __s=${JSON.stringify(srcs)};`);
  assert.deepEqual(srcs.map(s => core.liveVidFor(s as any) ?? '∅'), JSON.parse(w.run(`JSON.stringify(__s.map(s=>liveVidFor(s)??'∅'))`)));
  assert.deepEqual(plain(srcs.map(s => core.streamCascade(s as any))), JSON.parse(w.run('JSON.stringify(__s.map(streamCascade))')));
  const places = [{ name: 'a', kind: 'youtube', stream_url: 'https://youtu.be/dfVK7ld38Ys' }, { name: 'b', kind: 'embed', stream_url: 'https://x/embed' }, { name: 'c', kind: 'rtmp', stream_url: 'x' }, {}];
  w.run(`var __p=${JSON.stringify(places)};`);
  assert.deepEqual(plain(places.map(core.placeToSource)), JSON.parse(w.run('JSON.stringify(__p.map(placeToSource))')));
  // Refusal before attempt: unconfirmed channel, bad stream, portal iframe.
  assert.equal(core.refuseBeforeAttempt({ type: 'youtube', id: 'UCNye-wNBqNL5ZzHSJdpkiXA' }), 'not-live');
  assert.equal(core.refuseBeforeAttempt({ type: 'iframe', url: 'https://worldcams.tv/united-kingdom/london/trafalgar-square' }), 'iframe-blocked');
  core.markBadStream({ type: 'hls', url: 'https://x.m3u8' });
  assert.equal(core.refuseBeforeAttempt({ type: 'hls', url: 'https://x.m3u8' }), 'bad');
  assert.equal(core.refuseBeforeAttempt({ type: 'youtube', id: 'dfVK7ld38Ys' }), '');
});

test('feedGate returns the same verdicts as the web (seeded animal trickle)', () => {
  fresh(21);
  const w = webSandbox({ seed: 21, now: NOW });
  for (const n of ['C', 'REGION_ALIASES', '_regionNorm', '_REGION_ALIAS_N', '_regionByName', '_regionByCode', 'resolveRegion', 'stampRegion', 'TAG_KEYWORDS', 'TAG_RE', 'CRISIS_WEAK', 'CRISIS_INTL', 'inferTags',
    'TENSION_TAGS', 'SPIKE_HALF_LIFE_H', 'hasTension', 'postAgeH', 'velocity', 'isBreaking', 'STORY_KIND', 'STORY_PLACE_HINTS', '_placeRe', 'regionInText', 'STORY_STOP', 'storyTokens', 'storyInfo', '_stories', '_storyTokIdx', 'storyOf', 'noteStory',
    '_SEEN_CAP', '_h', '_loadSeen', '_seenIds', '_seenDirty', '_normText', '_linkKey', 'admitPost', 'BIO', 'ANIMAL_WORDS', 'ANIMAL_CJK', 'ANIMAL_EMOJI', 'isAnimalPost', 'ANIMAL_UNLOCK', 'animalSuppressed',
    'VOID_NATIVE', 'isNewsAccount', 'isArticleDrop', 'MUTED', 'MUTE_RE', '_muteRe', 'isMuted', 'isFeedMeta', 'feedGate', 'dispHandle', 'bskyToPost']) w.load(n);
  const H = 3600000;
  const items = fx('bsky-feed.json').feed;
  const synth = [
    { id: 'g1', body: 'Trump signs the sanctions order', tags: [], _handle: '@x.bsky.social' },
    { id: 'g2', body: 'My cat watching the protest on TV', tags: [], _handle: '@y.bsky.social' },
    { id: 'g3', body: 'My dog at the border crossing again', tags: [], _handle: '@y2.bsky.social' },
    { id: 'g4', body: 'Missile strike on Kharkiv', tags: [], _handle: '@kyivindependent.com', _wire: true },
    { id: 'g5', body: 'Death toll in Nepal flood rises to 1,300', tags: [], _handle: '@reuters.com', _wire: true, score: 20000, _reposts: 5000, time: NOW - H },
    { id: 'g6', body: 'Parliament votes on election reform', tags: [], _link: 'https://news.site/a', _handle: '@z.bsky.social' },
    { id: 'g7', body: 'PINNED POST: welcome to the feed', tags: [], _handle: '@feed.bsky.social' },
    { id: 'g8', body: 'just vibes', tags: [], _handle: '@q.bsky.social' },
    { id: 'g9', body: 'Death toll in Nepal flood rises to 1,300', tags: [], _handle: '@other.bsky.social' },
  ].map(p => ({ score: 0, replies: 0, time: NOW - 2 * H, source: 'bluesky', country: '', iso: '', style: 'take', ...p, tags: core.inferTags(p.body) }));
  w.run(`var __items=${JSON.stringify(items)};var __synth=${JSON.stringify(synth)};`);
  const mine = [...items.map((it: any) => core.feedGate(core.bskyToPost(it))), ...synth.map(p => core.feedGate(JSON.parse(JSON.stringify(p))))];
  const theirs = JSON.parse(w.run('JSON.stringify([...__items.map(it=>feedGate(bskyToPost(it))),...__synth.map(p=>feedGate(p))])'));
  assert.deepEqual(mine, theirs);
  const byId = Object.fromEntries(synth.map((p, i) => [p.id, mine[items.length + i]]));
  assert.equal(byId.g1, 'muted'); assert.equal(byId.g4, 'news-account'); assert.equal(byId.g5, '');
  assert.equal(byId.g6, 'article-drop'); assert.equal(byId.g7, 'meta'); assert.equal(byId.g8, 'no-tags'); assert.equal(byId.g9, 'dedupe');
});

test('nation feed pool deals a format mix: <=3 in a row while others wait, audio spaced', () => {
  fresh();
  const c = core.C.find(x => x.n === 'Nepal')!;
  const st = core.createNationFeed(c);
  const mk = (id: string, style: string, body = 'Kathmandu Nepal report ' + id.replace(/\d/g, d => 'abcdefghij'[+d])) => ({ id, style, body, tags: [], score: 0, replies: 0, time: NOW, source: 'x', country: '', iso: '' });
  core.nationFeedPoolAdd(st, Array.from({ length: 12 }, (_, i) => mk('a' + i, 'audio')), 'radio');
  core.nationFeedPoolAdd(st, Array.from({ length: 8 }, (_, i) => mk('t' + i, 'take')), 'masto');
  core.nationFeedPoolAdd(st, Array.from({ length: 6 }, (_, i) => mk('v' + i, 'video')), 'peertube');
  core.nationFeedPoolAdd(st, [mk('dup', 'take', 'same same same same text here'), mk('dup2', 'image', 'same same same same text here'), mk('t0', 'take')], 'x');
  assert.equal(st.pool.length, 27, 'id + same-text dedupe');
  const dealt = core.nationFeedDeal(st, 40, 0);
  const g = dealt.map(core.nfGroup);
  let run = 1; for (let i = 1; i < g.length; i++) { run = g[i] === g[i - 1] ? run + 1 : 1; if (new Set(g.slice(i)).size > 1) assert.ok(run <= 3, 'run ' + g.join(',')); }
  for (let i = 0; i < g.length; i++) if (g[i] === 'audio') { const prev = g.lastIndexOf('audio', i - 1); if (prev >= 0 && g.slice(i).some(x => x !== 'audio')) assert.ok(i - prev >= 5 || new Set(g.slice(prev)).size === 1, 'audio gap at ' + i + ': ' + g.join(',')); }
  assert.ok(dealt.every(p => p._offFeed && core.allPosts.includes(p)), 'registered off-feed');
  assert.ok(st.pool.every(p => p.style === 'audio'), 'a lone format is held back');
  // force lets a few of the lone format out.
  assert.equal(core.nationFeedDeal(st, 40, 3).length > 0, true);
});

test('nation feed spam gate: Marshall Islands samples, identical verdicts to the web', () => {
  fresh();
  const w = webSandbox({ now: NOW });
  w.load('NF_METAR_RE', 'NF_PER_AUTHOR', 'nfShape', 'nfSpam');
  const m = (h: string, body: string, source = 'mastodon') => ({ _handle: h, _author: h, body, source });
  const posts = [
    m('@bigorre_org', 'Aviation weather for Majuro Atoll airport (Marshall Islands) is “PKMJ 172352Z 04014KT 15SM FEW014 SCT015 BKN1”'),
    m('@bigorre_org', 'Aviation weather for Bucholz Army Air Field airport (Marshall Islands) is “PKWA 300120Z AUTO”'),
    ...[76, 78, 80].map(n => m('@OptimusPrimeBot@commons', `ISS075-E-810${n} - View of the Marshall Islands`, 'commons')),
    ...[1, 2, 3].map(() => m('@PugJesus@piefed.social', 'US Marines with puppies, the Marshall Islands, WW2, ~1942-1945 https://piefed.social/c/x/' + Math.random())),
    ...['one', 'two', 'three', 'four', 'five'].map(t => m('@longreads@mastodon.world', `The Marshall Islands story number ${t}, a different piece each time`)),
    ...['a', 'b', 'c', 'd'].map(t => m('gdelt', `Outlet story ${t} about Majuro and the Pacific`, 'news')),
    ...['Offshore', 'Offworld', 'Quran'].map(n => ({ _handle: '@asurahosting.com', _author: n + ' Radio', body: n + ' Radio · LIVE radio from Marshall Islands', source: 'radio' })),
    m('@thepathtopeace', 'A MarshallIslands-flagged floating LNG storage facility'),
    m('@x', 'Today in Labor History: METAL workers struck at a TAFE college'),   // no false METAR hit
  ];
  const native = { shapes: new Set(), authors: {} } as any;
  const got = posts.map(p => core.nfSpam(native, p as any));
  w.run(`var __st={shapes:new Set(),authors:{}},__p=${JSON.stringify(posts)};`);
  assert.deepEqual(got, JSON.parse(w.run('JSON.stringify(__p.map(p=>nfSpam(__st,p)))')));
  const kept = posts.filter((_, i) => !got[i]).map(p => p.body.slice(0, 24));
  assert.equal(got.slice(0, 2).every(Boolean), true, 'METAR dropped');
  assert.deepEqual(got.slice(2, 5), [false, true, true], 'numbered photo dump -> one');
  assert.deepEqual(got.slice(5, 8), [false, true, true], 'same post three times -> one');
  assert.deepEqual(got.slice(8, 13), [false, false, false, true, true], 'account cap 3');
  assert.deepEqual(got.slice(13, 17), [false, false, false, false], 'news exempt from the cap');
  assert.deepEqual(got.slice(17, 20), [false, false, false], 'radio stations sharing a host are separate authors');
  assert.equal(got[21], false, 'METAL / TAFE are not aviation weather');
  assert.ok(kept.length >= 14);
});

test('nation feed audio: a person speaking goes before radio, radio at most 1 per NF_RADIO_EVERY', () => {
  fresh();
  const c = core.C.find(x => x.n === 'Kenya')!;
  const st = core.createNationFeed(c);
  const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango'];
  const mk = (id: string, style: string, source: string, i: number) => ({ id, style, source, body: `Nairobi Kenya ${source} ${words[i]} ${words[(i + 7) % 20]}`, _author: source + words[i], tags: [], score: 0, replies: 0, time: NOW, country: '', iso: '' });
  core.nationFeedPoolAdd(st, Array.from({ length: 10 }, (_, i) => mk('r' + i, 'audio', 'radio', i)), 'radio');
  core.nationFeedPoolAdd(st, Array.from({ length: 2 }, (_, i) => mk('v' + i, 'audio', 'commons', i)), 'voice');
  core.nationFeedPoolAdd(st, Array.from({ length: 20 }, (_, i) => mk('t' + i, 'take', 'mastodon', i)), 'masto');
  core.nationFeedPoolAdd(st, Array.from({ length: 20 }, (_, i) => mk('i' + i, 'image', 'commons', i)), 'commons');
  const dealt = core.nationFeedDeal(st, 60, 0);
  const aud = dealt.map((p, i) => [i, p.source] as const).filter(([i]) => dealt[i].style === 'audio');
  assert.deepEqual(aud.slice(0, 2).map(a => a[1]), ['commons', 'commons'], 'voice first: ' + JSON.stringify(aud));
  const radioAt = aud.filter(a => a[1] === 'radio').map(a => a[0]);
  for (let k = 1; k < radioAt.length; k++) assert.ok(radioAt[k] - radioAt[k - 1] >= core.NF_RADIO_EVERY, 'radio spacing ' + radioAt.join(','));
  assert.ok(radioAt.length >= 1, 'radio still appears');
});

test('nation TRENDING is the nation\'s own fastest-moving post, the same pick as the web', () => {
  fresh();
  const c = core.C.find(x => x.n === 'South Korea')!;
  const H = 3600000;
  const mk = (id: string, o: Record<string, unknown> = {}) => ({ id, style: 'take', body: 'Seoul ' + id, tags: [], score: 0, replies: 0, time: NOW - H, source: 'x', country: 'South Korea', iso: c.iso, ...o });
  const posts = [
    mk('radio', { style: 'audio', _img: 'x' }),                 // what the card used to show: media, zero engagement
    mk('slow', { score: 900, time: NOW - 40 * H }),             // bigger total, long cooled
    mk('hot', { score: 300, replies: 40, time: NOW - 2 * H }),  // moving now
    mk('stale', { score: 90000, time: NOW - 72 * H }),          // outside the window, however large
    mk('abroad', { score: 5000, country: 'Japan', iso: 'JP', body: 'South Korea talks' }), // about, not from
  ];
  core.allPosts.push(...(posts as any));
  assert.equal(core.nationTrending(c)!.id, 'hot');
  assert.equal(core.nationCards(c).trending!.id, 'hot');
  const w = webSandbox({ now: NOW });
  w.load('C', 'REGION_ALIASES', '_regionNorm', '_REGION_ALIAS_N', '_regionByName', '_regionByCode', 'resolveRegion', 'postAgeH', 'velocity', 'allPosts', 'TREND_WINDOW_H', 'nationOwns', 'nationTrending');
  w.run(`allPosts.push(...${JSON.stringify(posts)});`);
  assert.equal(w.run(`nationTrending(C.find(x=>x.n==='South Korea')).id`), 'hot');
  // Nothing local has engagement: the ranker's pick stands in rather than an empty card.
  core.resetStore();
  core.allPosts.push(mk('quiet') as any);
  assert.equal(core.nationTrending(c), null);
  assert.equal(core.nationCards(c).trending!.id, 'quiet');
});

test('reels art gate: furry and hand-drawn art never reach a reel, real footage does', () => {
  fresh();
  const blocked = ['new #furry animation wip', 'Fursuit dance at the con', 'hand-drawn, frame by frame', 'my art for today #artsky', 'speedpaint of my fursona',
    'commission finished! #art', 'fan art of the finale', 'Handdrawn map of the old town', 'an animatic I made', 'Anthro wolf turnaround #digitalart',
    'protogen head turn test', 'watercolour timelapse', 'anime opening I animated #indieanimation', 'pixel art loop', 'new cartoon short', 'WIP #painting'];
  const allowed = ['Comedy sketch from last night', 'Street artist paints a mural in Lagos', 'Flooding in Bangkok tonight', 'Protest outside the art museum',
    'the state of the art in drone racing', 'Cartagena at dawn', 'Anthropology lecture, day two', 'Martial artist lands a spinning kick',
    'Riot outside my art school in Tbilisi', 'State capture #commission hearing resumes today',
    // real titles and captions from the live sample that an earlier, looser draft refused
    'The Art Of The Grift - Propaganda And Deceptive Editing', 'Police Violence during Hamburg University Occupation & Artwork',
    'Merci ! - Réanimation Bordeaux', 'Battle lines drawn as troops mass at the border', '#MarioKartWorld speedrun attempt',
    'OC gets a taste of his own medicine', 'Anthropic says the model leaked', 'Animation shows how the dam collapsed'];
  for (const t of blocked) assert.ok(core.REEL_BLOCK_TOPIC.test(t), 'blocked: ' + t);
  for (const t of allowed) assert.ok(!core.REEL_BLOCK_ART.test(t), 'allowed: ' + t);
  // The queue's allPosts backstop never went through the reel ingest: the gate holds there too.
  const mk = (id: string, body: string) => ({ id, style: 'video', body, tags: ['conflict'], score: 10, replies: 0, time: NOW - 3600000, source: 'x', country: '', iso: '', _video: 'https://v.example/' + id + '.m3u8' });
  core.allPosts.push(mk('real', 'Convoy crossing the river at dawn') as any, mk('drawn', 'my fursona walk cycle #furryart') as any);
  const picked = core.vwFill(5, true).map(p => p.id);
  assert.ok(picked.includes('real') && !picked.includes('drawn'), 'vwFill picked ' + picked.join(','));
});

test('vwFill: one creator does not fill the rail, and a caption served twice is one card', () => {
  fresh();
  const mk = (id: string, who: string, score: number, body = 'Clip number ' + id + ' from the river crossing at dawn') =>
    ({ id, style: 'video', body, tags: ['conflict'], score, replies: 0, time: NOW - 3600000, source: 'x', country: '', iso: '', _author: who, _handle: '@' + who, _video: 'https://v.example/' + id + '.m3u8' });
  // jim outranks everyone four times over; the same caption also arrives as a second video.
  core.reelPosts.push(...[1, 2, 3, 4].map(k => mk('jim' + k, 'jimdiv', 100 - k)) as any,
    mk('dupA', 'anna', 50, 'The vixen is still around together with one of her cubs') as any,
    mk('dupB', 'ben', 49, 'The vixen is still around together with one of her cubs') as any,
    ...['c', 'd', 'e', 'f'].map((w, k) => mk('o' + w, 'other' + w, 40 - k)) as any);
  const first = core.vwFill(4, true), second = core.vwFill(4, true);
  const who = [...first, ...second].map(p => p._author);
  for (const batch of [first, second]) assert.ok(batch.filter(p => p._author === 'jimdiv').length <= 1, 'jim twice in a batch: ' + who.join(','));
  assert.ok(who.every((w, i) => i === 0 || w !== who[i - 1]), 'same creator back to back: ' + who.join(','));
  assert.equal(who[0], 'jimdiv', 'the top post still leads');
  const vixen = [...first, ...second].filter(p => /vixen/.test(p.body || ''));
  assert.equal(vixen.length, 1, 'same caption twice: ' + vixen.map(p => p.id).join(','));
});

test('feed cache restore: a post already shown never leads the next launch; an unshown one and a repost still do', () => {
  fresh();
  const mk = (id: string, body: string, extra: Partial<any> = {}) => ({ id, style: 'take', body, tags: ['politics'], score: 5, replies: 0, time: NOW - 3600000, source: 'bluesky', country: '', iso: '', ...extra });
  // Last session: 'trump' and 'other' were admitted (shown); 'fresh1' was saved to the cache but never admitted.
  assert.ok(core.admitPost(mk('trump', 'Trump says the quiet part out loud again, long enough to hash') as any));
  assert.ok(core.admitPost(mk('other', 'A second post the reader scrolled past yesterday evening') as any));
  core.persistSeen();
  core.env.storage.setItem(core.FEED_CACHE_KEY, JSON.stringify([
    mk('trump', 'Trump says the quiet part out loud again, long enough to hash'),
    mk('other', 'A second post the reader scrolled past yesterday evening'),
    mk('fresh1', 'Something the reader has not been shown yet at all'),
    mk('repost1', 'Trump says the quiet part out loud again, long enough to hash', { _repost: true }),
  ]));
  // New launch: same storage, empty pool.
  core.resetStore();
  const painted = core.restoreFeedCache();
  const ids = core.allPosts.map(p => p.id);
  assert.ok(!ids.includes('trump') && !ids.includes('other'), 'seen posts came back: ' + ids.join(','));
  assert.ok(ids.includes('fresh1'), 'unshown post should warm the launch');
  assert.ok(ids.includes('repost1'), 'a repost is a new event and may lead');
  assert.equal(painted, 2);
});

test('vwKey: one clip reposted by two Bluesky accounts is ONE reel (keyed by video cid, parity with the web)', async () => {
  fresh();
  const w = webSandbox({ now: NOW });
  w.load('vwKey');
  const cid = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7ovqaxz3oa';
  const a = { id: 'a1', _video: 'https://video.bsky.app/watch/did%3Aplc%3Aposter1/' + cid + '/playlist.m3u8' };
  const b = { id: 'b1', _video: 'https://video.bsky.app/watch/did%3Aplc%3Aposter2/' + cid + '/playlist.m3u8?x=1' };
  const c = { id: 'c1', _video: 'https://cdn.example/v/other/playlist.m3u8' };
  assert.equal(core.vwKey(a as any), core.vwKey(b as any), 'same cid, different poster -> same key');
  assert.notEqual(core.vwKey(a as any), core.vwKey(c as any));
  w.run(`var __p=${JSON.stringify([a, b, c])};`);
  assert.deepEqual([a, b, c].map(p => core.vwKey(p as any)), JSON.parse(w.run('JSON.stringify(__p.map(vwKey))')));
  // And through the real fill: the repost never becomes a second card.
  const mk = (id: string, who: string, vid: string) => ({ id, style: 'video', body: 'content_warning', tags: ['conflict'], score: 10, replies: 0, time: NOW - 3600000, source: 'bluesky', country: '', iso: '', _author: who, _handle: '@' + who, _video: vid });
  core.reelPosts.push(mk('a1', 'anna', a._video) as any, mk('b1', 'ben', b._video) as any, mk('c1', 'cara', c._video) as any);
  // Deal the whole pool out: the repost must never become a second card. vwFill
  // tops a thin pool up in the background; that pull must not outlive this test
  // and land on the next one's fetch mock, so the pull is answered by a fetch
  // that resolves to nothing and is awaited before the test returns.
  const ids = [...core.vwFill(8, true), ...core.vwFill(8, true)].map(p => p.id);
  await core.pullReelPage();
  assert.ok(ids.includes('c1') && (ids.includes('a1') || ids.includes('b1')), 'picked ' + ids.join(','));
  assert.ok(!(ids.includes('a1') && ids.includes('b1')), 'repost dealt twice: ' + ids.join(','));
});

test('vwBodyKey / vwWho match the web build (same caption and creator identity)', () => {
  fresh();
  const w = webSandbox({ now: NOW });
  w.load('vwBodyKey', 'vwWho');
  const ps = [
    { body: 'The vixen is still around together with one of her cubs https://x.example/a?b=1' },
    { body: 'short one' },
    { body: '  The   VIXEN is still around together with one of her cubs  ' },
    { _handle: '@JunkboxJim', body: '' },
    { _author: 'Wind.Born.Films', body: '' },
    {},
  ];
  w.run(`var __p=${JSON.stringify(ps)};`);
  assert.deepEqual(ps.map(p => core.vwBodyKey(p as any)), JSON.parse(w.run('JSON.stringify(__p.map(vwBodyKey))')));
  assert.deepEqual(ps.map(p => core.vwWho(p as any)), JSON.parse(w.run('JSON.stringify(__p.map(vwWho))')));
});

test('reels PeerTube lane: gates run before the detail calls; a clip with no HLS gets the 720p file, not the largest', async () => {
  const calls: string[] = [];
  const rows = [
    { uuid: 'ptA', name: 'Protest against police surveillance in Hamburg', duration: 60, views: 5 },
    { uuid: 'ptB', name: 'my fursona speedpaint about the protest', duration: 60, views: 5 }, // art: refused with no detail call
    { uuid: 'ptC', name: 'zzz qqq', duration: 60, views: 5 },                                  // no tag: refused with no detail call
  ];
  const file = (id: number) => ({ fileUrl: `https://h.example/${id}.mp4`, resolution: { id } });
  const detail = { files: [file(1080), file(720), file(480)], streamingPlaylists: [], previewPath: '/p.jpg', duration: 60 };
  core.configureCore({
    storage: core.createMemoryStorage(), session: core.createMemoryStorage(), now: () => NOW, random: mulberry32(3), proxyBase: '',
    fetch: (async (u: string) => {
      calls.push(u);
      const isDetail = /\/videos\/pt[A-C]$/.test(u);
      return { ok: true, json: async () => (isDetail ? detail : { data: rows }) };
    }) as any,
  });
  core._badStreams.clear(); core.resetStories(); core.resetStore();
  assert.equal(await core.pullPeerTubeSearch(), 1);
  const details = calls.filter(u => /\/videos\/pt[A-C]$/.test(u));
  assert.deepEqual(details.map(u => u.slice(-3)), ['ptA'], 'only the row that passes the gates costs a detail call');
  assert.equal(core.reelPosts[0]._video, 'https://h.example/720.mp4');
  assert.equal(core.reelPosts[0]._img!.endsWith('/p.jpg'), true);
});

test('search LIVE NOW spread: HLS shuffled stream by stream, each tagged with its country, never one country', () => {
  for (let k = 0; k < 20; k++) {
    const s = core.hlsSpread(14);
    assert.equal(s.length, 14);
    assert.ok(s.every((x) => x.type === 'hls' && typeof x.n === 'string' && x.n), 'HLS only, with the country the caption shows');
    assert.equal(new Set(s.map((x) => x.url)).size, 14, 'no stream twice in one chain');
    assert.ok(new Set(s.map((x) => x.n)).size > 3, 'a spread across countries, not one country taken whole');
  }
});

test('reels pull is single-flight: a second caller gets the pull in progress, not an instant false', async () => {
  let searches = 0;
  core.configureCore({
    storage: core.createMemoryStorage(), session: core.createMemoryStorage(), now: () => NOW, random: mulberry32(5), proxyBase: '',
    fetch: (async (u: string) => {
      if (u.includes('/search/videos')) searches++;
      return { ok: true, json: async () => (u.includes('getFeed') ? { feed: [] } : { data: [] }) };
    }) as any,
  });
  core.resetStore();
  await core.pullReelPage(); // settle any pull an earlier test left in flight
  searches = 0;
  const a = core.pullReelPage();
  const b = core.pullReelPage();
  assert.equal(a, b, 'the same in-flight promise');
  assert.equal(await a, false, 'nothing admitted from empty sources');
  assert.equal(searches, 1, 'one pull, not two');
  const c = core.pullReelPage();
  assert.notEqual(c, a, 'a settled pull frees the slot');
  await c;
});

test('feedMixer: ~NICHE_SHARE niche per page, <=2 per author per page, gates hold', () => {
  core.configureCore({ storage: core.createMemoryStorage(), session: core.createMemoryStorage(), now: () => NOW, random: mulberry32(9), proxyBase: '', fetch: noNet });
  const W = 'water roads housing schools rivers markets clinics buses parks bridges ferries libraries farms ports tariffs wages'.split(' ');
  const mk = (i: number, o: Partial<any>) => ({ id: 'm' + i, source: 'bluesky', style: 'take', country: '', iso: '', tags: [], score: 0, replies: 0,
    time: NOW - (i % 20) * 3600000, body: 'A considered paragraph about ' + W[i % W.length] + ' and ' + W[(i * 7 + 3) % W.length] + ' that the council decided on ' + W[(i * 3 + 1) % W.length], ...o });
  const pool: any[] = [];
  for (let i = 0; i < 40; i++) pool.push(mk(i, { score: 10 + i * 7, replies: i % 5, _handle: 'eng' + (i % 6) }));       // engaged, 6 authors
  for (let i = 40; i < 80; i++) pool.push(mk(i, { _handle: 'niche' + (i % 12) }));                                      // niche, 12 authors
  pool.push(mk(90, { body: 'https://example.com/x', _handle: 'linky' }));                                                // link-only
  pool.push(mk(91, { body: 'KJFK 041851Z 27012KT 10SM FEW250 METAR report', _handle: 'wx' }));                           // weather bot
  pool.push(mk(92, { _repost: true, _handle: 'rp' }));                                                                   // pure repost
  const out = core.mixFeed(pool);
  assert.equal(out.length, pool.length, 'nothing is dropped');
  const first30 = out.slice(0, 30);
  const niche = first30.filter((p: any) => core.engagementOf(p) < core.ENGAGED_MIN).length;
  assert.ok(Math.abs(niche - 30 * core.NICHE_SHARE) <= 2, `niche ${niche}/30 ~ ${30 * core.NICHE_SHARE}`);
  for (let pg = 0; pg < 3; pg++) {
    const counts: Record<string, number> = {};
    for (const p of out.slice(pg * 10, pg * 10 + 10)) counts[p._handle] = (counts[p._handle] || 0) + 1;
    assert.ok(Object.values(counts).every((n) => n <= core.PER_AUTHOR), 'page ' + pg + ' author cap: ' + JSON.stringify(counts));
  }
  const gated = ['m90', 'm91', 'm92'];
  assert.deepEqual(out.slice(-3).map((p: any) => p.id).sort(), gated, 'link-only, bot and repost posts go last');
  assert.ok(first30.slice(0, 10).some((p: any) => core.engagementOf(p) >= core.ENGAGED_MIN), 'engaged posts still lead pages');
});

test('pullVoidFeed: a proxy page no longer starves Bluesky - both land in one pull', async () => {
  const xItem = { id: 'x1', platform: 'x', author: 'a', handle: '@a', text: 'Protesters gathered outside the ministry for a third night over fuel prices', createdAt: NOW - 3600000,
    url: 'https://x.com/a/status/1', metrics: { score: 0, replies: 0 }, media: [], provenance: { sourceHost: 'x.com', responseHash: 'h1' } };
  // A topical Bluesky post (the saved fixture's posts all fail the topic-tag gate).
  const bsky = { feed: [{ post: { uri: 'at://did:plc:t/app.bsky.feed.post/b1', cid: 'b1', author: { handle: 'reporter.bsky.social', displayName: 'R' }, likeCount: 240, replyCount: 31,
    record: { text: 'Parliament passed the emergency budget after a night of protests, the opposition walked out before the vote', createdAt: new Date(NOW - 7200000).toISOString() } } }], cursor: '' };
  let bskyCalls = 0;
  core.configureCore({
    storage: core.createMemoryStorage(), session: core.createMemoryStorage(), now: () => NOW, random: mulberry32(11), proxyBase: 'https://proxy.test',
    fetch: (async (u: string) => {
      if (u.startsWith('https://proxy.test/feed')) return { ok: true, status: 200, json: async () => ({ items: [xItem], nextOffset: 1 }) };
      if (u.includes('app.bsky.feed.getFeed')) { bskyCalls++; return { ok: true, status: 200, json: async () => bsky }; }
      return { ok: false, status: 0, json: async () => null };
    }) as any,
  });
  core.resetStore();
  let emits = 0;
  const off = core.onPostsChanged((why: string) => { if (why === 'feed') emits++; });
  assert.equal(await core.pullVoidFeed(), 'ok');
  off();
  assert.equal(emits, 1, 'one emit, so both sources are dealt (and mixed) in one batch');
  assert.ok(bskyCalls > 0, 'Bluesky is asked even though the proxy answered');
  const sources = new Set(core.allPosts.map((p: any) => p.source));
  assert.ok(sources.has('x'), 'the proxy post is in the pool');
  assert.ok(sources.has('bluesky'), 'Bluesky posts are in the pool: ' + [...sources]);
});

test('incident vocabulary: viral current-events captions get a tag, look-alikes do not, same as the web', () => {
  const w = webSandbox({ now: NOW });
  w.load('TAG_KEYWORDS', 'TAG_RE', 'CRISIS_WEAK', 'CRISIS_INTL', 'inferTags');
  const hit = ['ARIZONA STATE: Tempe Police brutally push, tackle, and punch a cheerleader', 'Bodycam shows the officer firing first', 'Dashcam caught the pileup on I-95',
    'Fight breaks out on the subway platform', 'Man shot dead outside a nightclub', "Movers blocked a kidnapper's car at a gas station", 'ICE agents detain a man at a bus stop',
    'CCTV caught the hit-and-run on Main St', 'Police footage of the raid on Kyiv Street', 'Cops arrested three students'];
  const miss = ['screenshot of my desktop setup', 'great shot of the sunset', 'a crash course in Python', 'we fight for what we love', 'shooting on 35mm film today',
    'photoshoot with the band', 'the new policy on remote work', 'COP29 opens in Baku', 'a viral infection going around the office',
    // TAG_KEYWORDS gates the main feed too: everyday text that once read as an incident.
    'what an arresting portrait', 'gonna cop these sneakers', 'gameplay footage of the new build', 'speedrun footage',
    'behind the scenes footage from the concert', 'our chief executive officer joined', 'this song went viral on tiktok'];
  for (const t of hit) assert.ok(core.inferTags(t).includes('incident'), 'hit: ' + t);
  for (const t of miss) assert.ok(!core.inferTags(t).includes('incident'), 'miss: ' + t);
  for (const t of [...hit, ...miss]) assert.deepEqual(core.inferTags(t), JSON.parse(w.run(`JSON.stringify(inferTags(${JSON.stringify(t)}))`)), t);
});

test('vwScore: engagement lifts a viral clip on a log scale, PeerTube views are discounted, same as the web', () => {
  core.configureCore({ storage: core.createMemoryStorage(), session: core.createMemoryStorage(), now: () => NOW, random: () => 0, proxyBase: '', fetch: noNet });
  const w = webSandbox({ now: NOW });
  w.setRandom(() => 0); w.stmt('let vwQueue='); w.load('vwScore');
  const mk = (score: number, o: Record<string, unknown> = {}) => ({ time: NOW - 6 * 36e5, tags: [], score, replies: 0, _reposts: 0, source: 'bluesky', ...o });
  const [s0, s50, s5k, s500k] = [0, 50, 5000, 500000].map(n => core.vwScore(mk(n) as any));
  assert.ok(s0 < s50 && s50 < s5k && s5k < s500k, 'more engagement ranks higher');
  assert.ok(Math.abs((s5k - s50) - (s500k - s5k)) < 0.01, 'each 100x is the same lift, so one mega-post cannot own the rail');
  const viral = mk(5000, { _reposts: 1200 }), untouched = mk(0, { time: NOW - 10 * 6e4 });
  const archive = mk(50000, { source: 'peertube', time: NOW - 30 * 864e5 });
  assert.ok(core.vwScore(viral as any) > core.vwScore(untouched as any), 'a 6h-old viral clip beats a 10-minute-old one nobody touched');
  assert.ok(core.vwScore(viral as any) > core.vwScore(archive as any), 'a month-old PeerTube view count does not outrank it');
  for (const p of [mk(0), mk(50), mk(5000, { replies: 300, _quotes: 40 }), viral, untouched, archive])
    assert.equal(core.vwScore(p as any), w.run(`vwScore(${JSON.stringify(p)})`));
});

test('vwScore: curated fit lifts a clip over the same clip unjudged, same as the web', () => {
  core.configureCore({ storage: core.createMemoryStorage(), session: core.createMemoryStorage(), now: () => NOW, random: () => 0, proxyBase: '', fetch: noNet });
  const w = webSandbox({ now: NOW });
  w.setRandom(() => 0); w.stmt('let vwQueue='); w.load('vwScore');
  const base = { time: NOW - 6 * 36e5, tags: [], score: 500, replies: 20, _reposts: 30, source: 'bluesky' };
  const judged = { ...base, _fit: 0.8 }, raw = { ...base };
  assert.ok(core.vwScore(judged as any) > core.vwScore(raw as any), 'fit lifts');
  assert.ok(Math.abs(core.vwScore(judged as any) - core.vwScore(raw as any) - 1.2) < 1e-9, 'by fit * 1.5, every other term kept');
  for (const p of [judged, raw, { ...base, _fit: 1 }]) assert.equal(core.vwScore(p as any), w.run(`vwScore(${JSON.stringify(p)})`));
});

test('reels: the curated lane leads every pull and lands with the curator\'s caption and fit', async () => {
  await core.pullReelPage(); // settle any pull an earlier test left in flight
  const cur = (key: string, fit: number, extra: Record<string, unknown> = {}) => ({
    id: 'cur_' + key, platform: 'bluesky', text: 'Riot police push the crowd back at the bridge ' + key, createdAt: NOW - 2 * 36e5,
    metrics: { score: 1200, reposts: 300, replies: 0, views: 0 }, graphic: false, url: 'https://bsky.app/profile/a/post/' + key,
    media: [{ type: 'video', url: 'https://video.bsky.app/watch/did/' + key + '/playlist.m3u8', thumb: 'https://video.bsky.app/' + key + '.jpg' }],
    provenance: { sourceHost: 'bsky.app', responseHash: 'h' + key }, caption: 'Police line breaks at the bridge ' + key, genre: 'footage', topic: 'protest', fit, ...extra,
  });
  const items = [cur('c1', 0.9), cur('c2', 0.4, { graphic: true }), { ...cur('nop', 1), provenance: undefined }];
  const urls: string[] = [];
  core.configureCore({
    storage: core.createMemoryStorage(), session: core.createMemoryStorage(), now: () => NOW, random: () => 0.3, proxyBase: 'https://proxy.test',
    fetch: (async (u: string) => { urls.push(u); return { ok: true, json: async () => (u.includes('/curated') ? { items, generated: 'g' } : { posts: [], feed: [], data: [] }) }; }) as any,
  });
  core._badStreams.clear(); core.resetStore(); core._vwForgetAll();
  assert.equal(await core.pullReelPage(), true);
  assert.deepEqual(urls, ['https://proxy.test/curated?limit=30'], 'curated is asked first and, having answered, alone');
  assert.deepEqual(core.reelPosts.map(p => p.id), ['px_cur_c1', 'px_cur_c2'], 'an item without provenance is refused like any proxy item');
  const [c1, c2] = core.reelPosts;
  assert.deepEqual([c1._caption, c1._fit, c1._genre, c1._video], ['Police line breaks at the bridge c1', 0.9, 'footage', 'https://video.bsky.app/watch/did/c1/playlist.m3u8']);
  assert.ok(c2._graphic && core.moderation.isGraphic(c2), 'a graphic curated clip is veiled, not dropped');
  assert.ok(core.vwScore(c1) > core.vwScore(c2), 'the better fit ranks first');
  // Already admitted: the next pull gets nothing new from the lane and moves on.
  urls.length = 0;
  assert.equal(await core.pullReelPage(), false);
  assert.equal(urls[0], 'https://proxy.test/curated?limit=30');
  assert.ok(urls.length > 1, 'other lanes are asked once curated has nothing new');
});

test('reels: fresh top video leads, graphic is veiled not dropped, sexual is dropped, old clips and the archive wait', async () => {
  await core.pullReelPage(); // settle any pull an earlier test left in flight
  const vid = (id: string, text: string, ageH: number, labels: string[] = []) => ({
    uri: 'at://did:plc:t/app.bsky.feed.post/' + id, cid: id, author: { handle: id + '.bsky.social', displayName: id },
    likeCount: 900, repostCount: 300, replyCount: 40, labels: labels.map(val => ({ val })),
    embed: { $type: 'app.bsky.embed.video#view', playlist: `https://video.bsky.app/${id}/playlist.m3u8`, thumbnail: `https://video.bsky.app/${id}/t.jpg` },
    record: { text, createdAt: new Date(NOW - ageH * 36e5).toISOString() },
  });
  // Gated on topics beyond the search word and beyond the 'graphic' label.
  const top = [vid('gfx', 'Tempe Police pepper spray and tackle a student outside the stadium', 5, ['graphic-media']),
    vid('tv', 'Police procedural, season two out tonight', 5), vid('sfx', 'my halloween makeup look', 5, ['gore']),
    vid('sex', 'Officers arrest a man outside the club tonight', 5, ['porn']),
    { ...vid('img', 'Officers arrest a man on 5th street', 5), embed: { $type: 'app.bsky.embed.images#view', images: [{ fullsize: 'https://x.example/i.jpg' }] } }];
  const feed = [{ post: vid('old', 'Bodycam from the arrest was released', 20 * 24) }, { post: vid('fresh', 'Fight breaks out on the subway platform', 3) }];
  // r < 0.5: the search leads; 0.3 picks the 'police' term.
  let kinds: string[] = [], firstUrl = '', r = 0.3;
  core.configureCore({
    storage: core.createMemoryStorage(), session: core.createMemoryStorage(), now: () => NOW, random: () => r, proxyBase: '',
    fetch: (async (u: string) => {
      if (!firstUrl) firstUrl = u;
      kinds.push(u.includes('searchPosts') ? 'top' : u.includes('getFeed') ? 'feed' : u.includes('/search/videos') ? 'archive' : 'other');
      const body = u.includes('searchPosts') ? { posts: top, cursor: '50' } : u.includes('getFeed') ? { feed } : { data: [] };
      return { ok: true, json: async () => body };
    }) as any,
  });
  core.resetStore();
  assert.equal(await core.pullReelPage(), true);
  assert.ok(firstUrl.startsWith('https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?') && firstUrl.includes('&sort=top&since=' + encodeURIComponent(new Date(NOW - 48 * 36e5).toISOString())), firstUrl);
  assert.deepEqual(kinds, ['top'], 'the fresh lane answered, nothing else was asked');
  assert.ok(firstUrl.includes('q=police'), firstUrl);
  assert.deepEqual(core.reelPosts.map(p => p.id), ['bsky_gfx'], 'the porn-labelled, the image, the search-word-only and the label-only posts never land');
  assert.ok(core.reelPosts[0]._graphic && core.moderation.isGraphic(core.reelPosts[0]), 'graphic footage is kept and veiled');
  kinds = [];
  assert.equal(await core.pullReelPage(), true);
  assert.deepEqual(core.reelPosts.map(p => p.id), ['bsky_gfx', 'bsky_fresh'], 'a 20-day-old feed clip is past REEL_MAX_AGE_H');
  assert.ok(!kinds.includes('archive'), 'the archive is not asked while a fresh lane yields');
  kinds = [];
  assert.equal(await core.pullReelPage(), false);
  assert.equal(kinds[0], 'top');
  assert.equal(kinds[kinds.length - 1], 'archive', 'PeerTube search runs last, once every fresh lane came back empty: ' + kinds.join(','));
  kinds = []; r = 0.9; top.length = 0;   // empty search: under 'breaking', 'police' is a real topic and the tv post would land
  assert.equal(await core.pullReelPage(), false);
  assert.equal(kinds[0], 'feed', 'the other half of pulls the feeds lead, so the search cannot starve them');
  assert.deepEqual(kinds.slice(-2), ['top', 'archive'], 'and the search still runs before the archive: ' + kinds.join(','));
});
