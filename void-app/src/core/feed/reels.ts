// ─── REELS SOURCE (separate from the VOID feed) ─────────────────────────
// Reels used to draw from allPosts — the feed's pool, ~5% video — so "reels" was the
// feed recycled. Its own pipeline: on-topic PeerTube search first, the absurd
// spook.tube lane sometimes, then video-only Bluesky feeds. Nothing without a
// playable video is ever admitted, and reels never borrow the feed's sources.
import { env, onConfigure } from '../env.ts';
import type { Post } from '../types.ts';
import { REEL_BLOCK_TOPIC, isArticleDrop, isFeedMeta, isMuted, isNewsAccount, reelBlocked } from '../rank/filters.ts';
import { diversify, VW_STYLES, vwScore } from '../rank/order.ts';
import { admitPost } from '../rank/seen.ts';
import { inferTags } from '../rank/tags.ts';
import { bskyFeedUrl, bskyToPost } from './bluesky.ts';
import { peertubeSrc } from './fedi.ts';
import { laneClaim, laneFree } from './search.ts';
import { allPosts, emitPostsChanged, reelPosts } from './store.ts';
import { nfFetchJson } from '../util.ts';

// Every source was independently discovered, then ADVERSARIALLY re-verified live
// (status, CORS with a real Origin, video share over a paginated sample, a .ts
// segment pulled to confirm it decodes). `w` = sampling weight encoding measured
// reliability and inventory, not taste.
export const REEL_FEEDS_META = [
  // Backbone. 1.00 video over 200 posts, 172 authors. Costs 9.5% hard news (filtered).
  { uri: 'at://did:plc:6i6n57nrkq6xavqbdo6bvkqr/app.bsky.feed.generator/og-videos-kps', w: 3, lane: 'general' },
  // Highest-energy lane with real throughput. 1.00 video, ~6 posts/hr, 69 authors.
  { uri: 'at://did:plc:5kk6tru4mdazgfmgyflvz3k2/app.bsky.feed.generator/wrestletok', w: 3, lane: 'chaos' },
  { uri: 'at://did:plc:5kk6tru4mdazgfmgyflvz3k2/app.bsky.feed.generator/aewtok', w: 2, lane: 'chaos' },
  // Streamer fail/rage. 0.73 PAGINATED and only ~119 posts — can never lead.
  { uri: 'at://did:plc:vj6d7kxk27mboj7nncpqfafk/app.bsky.feed.generator/aaapnna4b7zt4', w: 1, lane: 'chaos' },
  // 'animalvids' REMOVED: a calm "timeline cleanse" feed does not belong in reels.
  { uri: 'at://did:plc:mmqeuefr4nhatzqt3yzjoiri/app.bsky.feed.generator/bikesky-video', w: 1, lane: 'sport' },
];
export const REEL_FEEDS = REEL_FEEDS_META.flatMap(f => Array(f.w).fill(f.uri) as string[]);

// PeerTube lane — the genuinely UNHINGED end. sort=-views is DETERMINISTIC over a
// 2,742-item archive, so `start` is randomised per pull; the list carries no stream
// URL, so each item needs a detail call (N+1, capped, cached — URLs are static).
export const REEL_PEERTUBE = [
  { host: 'spook.tube', path: '/api/v1/videos?count=20&sort=-views&isLocal=true&nsfw=false&isLive=false', depth: 2700, lane: 'absurd' },
];
// ON-TOPIC VIDEO. 984 posts across 5 topical Bluesky feeds yielded 11 on-topic
// videos (1.1%). PeerTube SEARCH queries an archive by subject instead:
// kolektiva.media 73% on-topic, framatube.org 60%.
export const REEL_TOPIC_HOSTS = ['kolektiva.media', 'framatube.org'];
export const REEL_TOPIC_TERMS = ['war', 'surveillance', 'protest', 'resistance', 'police',
  'capitalism', 'propaganda', 'border', 'military', 'occupation', 'uprising', 'censorship'];

const _ptCache: Record<string, { url: string; thumb: string; dur: number }> = {};
export async function ptDetail(host: string, uuid: string) {
  if (_ptCache[uuid]) return _ptCache[uuid];
  try {
    const d = await nfFetchJson(`https://${host}/api/v1/videos/${uuid}`, 5000);
    if (!d) return null;
    const hls = (d.streamingPlaylists || [])[0];
    // files[] is largest first: with no HLS this handed a 720-wide phone the 1080p mp4.
    const url = (hls && hls.playlistUrl) || peertubeSrc(d, 720);
    if (!url) return null;
    const out = { url, thumb: d.previewPath ? `https://${host}${d.previewPath}` : '', dur: d.duration || 0 };
    _ptCache[uuid] = out; return out;
  } catch { return null; }
}

function ptReelPost(host: string, v: any, det: { url: string; thumb: string }, laneTags: string[]): Post {
  return {
    id: 'pt_' + host + ':' + v.uuid, style: 'video', country: '', iso: '',
    tags: inferTags(v.name, laneTags), _graphic: false,
    body: v.name || '', score: v.views || 0, replies: 0, _reposts: 0, _quotes: 0,
    time: Date.parse(v.publishedAt || v.createdAt || '') || env.now(), source: 'peertube',
    _author: (v.account && (v.account.displayName || v.account.name)) || host,
    _handle: '@' + ((v.account && v.account.name) || host),
    _img: det.thumb, _video: det.url, _url: `https://${host}/w/${v.uuid}`,
    _social: true, _wire: false, _link: '', provenance: { sourceHost: host }, imgHue: 270,
  };
}

export async function pullPeerTubeSearch(): Promise<number> {
  const host = REEL_TOPIC_HOSTS[Math.floor(env.random() * REEL_TOPIC_HOSTS.length)];
  const term = REEL_TOPIC_TERMS[Math.floor(env.random() * REEL_TOPIC_TERMS.length)];
  const start = Math.floor(env.random() * 60);   // or the same top hits repeat every session
  try {
    const u = `https://${host}/api/v1/search/videos?search=${encodeURIComponent(term)}&count=20&start=${start}&nsfw=false&isLive=false`;
    const j = await nfFetchJson(u, 6000);
    if (!j) return 0;
    const rows = (j.data || []).filter((v: any) => v && v.uuid && !v.isLive && !v.nsfw && (v.duration || 0) > 2 && (v.duration || 0) < 900);
    // The gates that need nothing from the detail call go first (in a live sample 39
    // of 67 detail calls were for rows dropped right after), and the calls that are
    // left go out together: eight round trips in series was seconds of PULLING SIGNAL.
    const cand = rows.slice(0, 8)
      .filter((v: any) => !reelPosts.some(x => x.id === 'pt_' + host + ':' + v.uuid))
      .map((v: any) => ({ v, p: ptReelPost(host, v, { url: '', thumb: '' }, []) }))
      .filter(({ p }: { p: Post }) => p.tags.length && !isMuted(p) && !REEL_BLOCK_TOPIC.test(p.body || ''));
    const dets = await Promise.all(cand.map(({ v }: { v: any }) => ptDetail(host, v.uuid)));   // ptDetail never throws
    let added = 0;
    cand.forEach(({ p }: { p: Post }, i: number) => {
      const det = dets[i]; if (!det) return;
      p._img = det.thumb; p._video = det.url;
      if (!admitPost(p)) return;               // still last: only a playable clip is marked seen
      reelPosts.push(p); added++;
    });
    return added;
  } catch { return 0; }
}

export async function pullPeerTubeReels(): Promise<number> {
  const src = REEL_PEERTUBE[Math.floor(env.random() * REEL_PEERTUBE.length)];
  const start = Math.floor(env.random() * Math.max(1, src.depth));
  try {
    const j = await nfFetchJson(`https://${src.host}${src.path}&start=${start}`, 6000);
    if (!j) return 0;
    const rows = (j.data || []).filter((v: any) => v && v.uuid && !v.isLive && !v.nsfw && (v.duration || 0) > 2 && (v.duration || 0) < 600);
    const cand = rows.slice(0, 8)                       // cap the N+1
      .map((v: any) => ({ v, p: ptReelPost(src.host, v, { url: '', thumb: '' }, [src.lane]) }))
      .filter(({ p }: { p: Post }) => !isMuted(p) && !REEL_BLOCK_TOPIC.test(p.body || ''));
    const dets = await Promise.all(cand.map(({ v }: { v: any }) => ptDetail(src.host, v.uuid)));
    let added = 0;
    cand.forEach(({ p }: { p: Post }, i: number) => {
      const det = dets[i]; if (!det) return;
      p._img = det.thumb; p._video = det.url;
      if (!admitPost(p)) return;
      reelPosts.push(p); added++;
    });
    return added;
  } catch { return 0; }
}

let _reelIdx = 0, _reelLoading = false;
export let _reelCursors: Record<string, string> = {};
function loadReelCursors() { try { _reelCursors = JSON.parse(env.storage.getItem('void_reel_cursors') || '{}') || {}; } catch { _reelCursors = {}; } }
loadReelCursors();
onConfigure(loadReelCursors);

// Callers get the IN-FLIGHT pull instead of an instant false (web pullReelPage). The
// false made fillOpenReel 'await' nothing and a NO SIGNAL retry tap do nothing while a
// pull was running. Each request is bounded too (5s detail, 6s list, 8s feed page): a
// host that accepts and then stalls used to hold this lock 12s per step of the chain.
let _reelPromise: Promise<boolean> | null = null;
export function pullReelPage(): Promise<boolean> {
  if (!_reelPromise) _reelPromise = pullReelPageOnce().finally(() => { _reelPromise = null; });
  return _reelPromise;
}
/** One reels top-up. Single lock with ONE try/finally (an early return once leaked the lock and reels died). */
async function pullReelPageOnce(): Promise<boolean> {
  if (_reelLoading) return false; _reelLoading = true;
  try {
    // ON-TOPIC FIRST: PeerTube search is the only source yielding subject-matching video at volume.
    try { const n = await pullPeerTubeSearch(); if (n) { emitPostsChanged('reels'); return true; } } catch { /* */ }
    if (env.random() < 0.25) {
      try { const n = await pullPeerTubeReels(); if (n) { emitPostsChanged('reels'); return true; } } catch { /* */ }
    }
    // Reels-only feeds. If the reel pool runs dry it stays dry rather than borrowing the feed's identity.
    const chain = REEL_FEEDS;
    for (let attempt = 0; attempt < chain.length; attempt++) {
      const feed = chain[_reelIdx % chain.length]; _reelIdx++;
      const cur = _reelCursors[feed] || '';
      try {
        const d = await nfFetchJson(bskyFeedUrl(feed, cur), 8000); if (!d) continue;
        _reelCursors[feed] = d.cursor || '';
        try { env.storage.setItem('void_reel_cursors', JSON.stringify(_reelCursors)); } catch { /* */ }
        let added = 0;
        for (const it of (d.feed || [])) {
          const p = bskyToPost(it);
          if (!p || !p._video) continue;                 // pure video only — the whole point
          if (!p.tags.length) continue;                  // no topical signal, not this app's content
          if (isFeedMeta(p.body)) continue;
          if (reelBlocked(it)) continue;                 // moderation / author labels
          if (isNewsAccount(p) || isArticleDrop(p)) continue;  // reels is not a newsroom
          if (isMuted(p)) continue;
          if (REEL_BLOCK_TOPIC.test(p.body || '')) continue;   // pet/wildlife dilutes reels
          if (!admitPost(p)) continue;                   // same cross-surface dedupe as the feed
          reelPosts.push(p); added++;
        }
        if (added) { emitPostsChanged('reels'); return true; }
      } catch { /* */ }
    }
    return false;
  } finally { _reelLoading = false; }
}

// ─── REEL QUEUE (vwFill) ─────────────────────────────────────────────────
export const vwQueue: Post[] = [];
export const vwSeen = new Set<string>();
/**
 * Next `n` reel cards: VIDEO ONLY (a video surface of text cards looks broken),
 * reels pool first, allPosts video as a cold-start backstop, recycle only when
 * genuinely exhausted and never what is on screen. Tops the pool up in the
 * background when thin. Each card is a copy with a unique `_vid`.
 */
// ─── NO REPEATS (web vwFill, same rules) ────────────────────────────────
// "The first two reels were the same video and the third was the first again." The
// recycle branch fired the moment the unseen pool ran dry: it CLEARED vwSeen and kept
// only the last 3, so a pool of a few clips looped. vwReset clears vwSeen on every
// reel open, so each open forgot the session. And identity was the post id, so the
// same clip reposted by a second account, or served by a second host, counted as new.
// Now a session-wide window of the last VW_NO_REPEAT clips, keyed by the VIDEO, that
// vwReset does not clear. Nothing inside it is offered; when nothing outside it is
// left, vwFill returns nothing and the view waits for the next pull instead of looping.
export const VW_NO_REPEAT = 40;
const _vwRecent: string[] = [];
const _vwRecentSet = new Set<string>();
export function vwKey(p: Post | null | undefined): string {
  return String((p && (p._video || p.id)) || '').split('?')[0].split('#')[0];
}
// The same post can also arrive as two videos (two hosts, two accounts reposting
// it): its caption is the second identity. Short captions are too generic to key on.
export function vwBodyKey(p: Post): string {
  const b = String(p.body || '').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  return b.length >= 24 ? 'b:' + b.slice(0, 100) : '';
}
export function vwRecentHas(p: Post): boolean {
  const b = vwBodyKey(p);
  return _vwRecentSet.has(vwKey(p)) || (!!b && _vwRecentSet.has(b));
}
export function vwRemember(p: Post): void {
  for (const k of [vwKey(p), vwBodyKey(p)]) {
    if (!k || _vwRecentSet.has(k)) continue;
    _vwRecent.push(k); _vwRecentSet.add(k);
  }
  while (_vwRecent.length > VW_NO_REPEAT * 2) _vwRecentSet.delete(_vwRecent.shift() as string);
}

// ─── ONE CREATOR DOES NOT FILL THE RAIL ─────────────────────────────────
// diversify only keeps the same account from appearing twice IN A ROW inside one
// batch of 4-5, so consecutive batches could each lead with the same creator.
// Measured on the S22, 30 cards: one Bluesky account 4 times in 6 cards, one
// PeerTube channel 3 times. An account seen in the last VW_AUTHOR_GAP cards, or
// already picked in this batch, waits; when nothing else is left a recent one may
// come back, but never twice in one batch.
export const VW_AUTHOR_GAP = 8;
const _vwAuthors: string[] = [];
export const vwWho = (p: Post) => String(p._handle || p._author || '').replace(/^@/, '').toLowerCase();
let _vwPullAt = 0;
export function vwFill(n = 5, any = false): Post[] {
  const eligible = (p: Post) => (any ? true : VW_STYLES.includes(p.style)) && laneFree(p, 'reel');
  const fresh = (p: Post) => !!p._video && !vwSeen.has(p.id) && !vwRecentHas(p);
  // Top the reel pool up in the background when thin (throttled: a source that fails
  // instantly must not spin).
  if (reelPosts.filter(fresh).length < n + 6 && env.now() - _vwPullAt > 1500) {
    _vwPullAt = env.now(); pullReelPage().catch(() => { /* */ });
  }
  let pool = reelPosts.filter(p => fresh(p) && eligible(p));
  // The feed pool never went through the reel ingest, so the reel topic block (pets,
  // drawn art) is applied here - or the backstop leaks exactly what the ingest holds
  // back, at cold start, when the reel pool is empty and this branch IS the queue.
  if (pool.length < n) pool = pool.concat(allPosts.filter(p => fresh(p) && eligible(p) && !pool.includes(p) && !REEL_BLOCK_TOPIC.test(p.body || '')));
  // One card per clip, even when two posts carry the same video or the same caption.
  const byKey = new Set<string>();
  pool = pool.filter(p => {
    const k = vwKey(p), b = vwBodyKey(p);
    if (byKey.has(k) || (b && byKey.has(b))) return false;
    byKey.add(k); if (b) byKey.add(b); return true;
  });
  const ranked = diversify(pool.map(p => [vwScore(p), p] as [number, Post]).sort((a, b) => b[0] - a[0]).map(x => x[1]));
  const recentW = new Set(_vwAuthors), usedW = new Set<string>(), chosen: Post[] = [];
  for (const p of ranked) {
    if (chosen.length >= n) break;
    const w = vwWho(p);
    if (w && (recentW.has(w) || usedW.has(w))) continue;
    chosen.push(p); if (w) usedW.add(w);
  }
  // Thin pool: a recently seen account may return, still once per batch. Anything
  // short of that waits for the next pull (the view's dry-rail retry), not a run.
  for (const p of ranked) {
    if (chosen.length >= n) break;
    const w = vwWho(p);
    if (chosen.includes(p) || (w && usedW.has(w))) continue;
    chosen.push(p); if (w) usedW.add(w);
  }
  for (const p of chosen) { const w = vwWho(p); if (w) _vwAuthors.push(w); }
  while (_vwAuthors.length > VW_AUTHOR_GAP) _vwAuthors.shift();
  const picks = chosen
    .map(p => {
      const c = { ...p }; vwSeen.add(p.id); vwRemember(p);
      laneClaim(p, 'reel'); c._vid = p.id + '~' + env.random().toString(36).slice(2, 6); return c;
    });
  vwQueue.push(...picks); return picks;
}
/** Reset the reel queue (web: opening a nation reel). */
export function vwReset(): void { vwQueue.length = 0; vwSeen.clear(); }
