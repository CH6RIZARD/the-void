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
function fresh(seed = 7) {
  core.configureCore({ storage: core.createMemoryStorage(), session: core.createMemoryStorage(), now: () => NOW, random: mulberry32(seed), proxyBase: '' });
  core._badStreams.clear(); core.resetStories(); core.resetStore();
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
    'VOID_NATIVE', 'isNewsAccount', 'isArticleDrop', 'MUTED', 'MUTE_RE', '_muteRe', 'isMuted', 'isFeedMeta', 'feedGate', 'bskyToPost']) w.load(n);
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
  const mk = (id: string, style: string, body = 'Kathmandu Nepal report ' + id) => ({ id, style, body, tags: [], score: 0, replies: 0, time: NOW, source: 'x', country: '', iso: '' });
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
