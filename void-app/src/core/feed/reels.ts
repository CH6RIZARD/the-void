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
import { laneClaim, laneFree } from './search.ts';
import { allPosts, emitPostsChanged, reelPosts } from './store.ts';

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
    const r = await env.fetch(`https://${host}/api/v1/videos/${uuid}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const d = await r.json();
    const hls = (d.streamingPlaylists || [])[0];
    const url = (hls && hls.playlistUrl) || ((d.files || [])[0] || {}).fileUrl || '';
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
    const r = await env.fetch(u, { headers: { Accept: 'application/json' } });
    if (!r.ok) return 0;
    const j = await r.json();
    const rows = (j.data || []).filter((v: any) => v && v.uuid && !v.isLive && !v.nsfw && (v.duration || 0) > 2 && (v.duration || 0) < 900);
    let added = 0;
    for (const v of rows.slice(0, 8)) {
      if (reelPosts.some(x => x.id === 'pt_' + host + ':' + v.uuid)) continue;
      const det = await ptDetail(host, v.uuid);
      if (!det) continue;
      const p = ptReelPost(host, v, det, []);
      if (!p.tags.length) continue;            // same intent gate the feed enforces
      if (isMuted(p)) continue;
      if (REEL_BLOCK_TOPIC.test(p.body || '')) continue;
      if (!admitPost(p)) continue;
      reelPosts.push(p); added++;
    }
    return added;
  } catch { return 0; }
}

export async function pullPeerTubeReels(): Promise<number> {
  const src = REEL_PEERTUBE[Math.floor(env.random() * REEL_PEERTUBE.length)];
  const start = Math.floor(env.random() * Math.max(1, src.depth));
  try {
    const r = await env.fetch(`https://${src.host}${src.path}&start=${start}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return 0;
    const j = await r.json();
    const rows = (j.data || []).filter((v: any) => v && v.uuid && !v.isLive && !v.nsfw && (v.duration || 0) > 2 && (v.duration || 0) < 600);
    let added = 0;
    for (const v of rows.slice(0, 8)) {                 // cap the N+1
      const det = await ptDetail(src.host, v.uuid);
      if (!det) continue;
      const p = ptReelPost(src.host, v, det, [src.lane]);
      if (isMuted(p)) continue;
      if (REEL_BLOCK_TOPIC.test(p.body || '')) continue;
      if (!admitPost(p)) continue;
      reelPosts.push(p); added++;
    }
    return added;
  } catch { return 0; }
}

let _reelIdx = 0, _reelLoading = false;
export let _reelCursors: Record<string, string> = {};
function loadReelCursors() { try { _reelCursors = JSON.parse(env.storage.getItem('void_reel_cursors') || '{}') || {}; } catch { _reelCursors = {}; } }
loadReelCursors();
onConfigure(loadReelCursors);

/** One reels top-up. Single lock with ONE try/finally (an early return once leaked the lock and reels died). */
export async function pullReelPage(): Promise<boolean> {
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
        const r = await env.fetch(bskyFeedUrl(feed, cur), { headers: { Accept: 'application/json' } }); if (!r.ok) continue;
        const d = await r.json(); _reelCursors[feed] = d.cursor || '';
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
export function vwFill(n = 5, any = false): Post[] {
  const eligible = (p: Post) => (any ? true : VW_STYLES.includes(p.style)) && laneFree(p, 'reel');
  if (reelPosts.length - vwSeen.size < n + 6) pullReelPage().catch(() => { /* */ });
  let pool = reelPosts.filter(p => p._video && !vwSeen.has(p.id) && eligible(p));
  if (pool.length < n) pool = pool.concat(allPosts.filter(p => p._video && !vwSeen.has(p.id) && !pool.includes(p) && eligible(p)));
  if (!pool.length) {
    vwSeen.clear(); vwQueue.slice(-3).forEach(p => vwSeen.add(p.id.split('~')[0]));
    pool = reelPosts.filter(p => p._video && !vwSeen.has(p.id) && eligible(p));
    if (!pool.length) pool = allPosts.filter(p => p._video && !vwSeen.has(p.id) && eligible(p));
  }
  const picks = diversify(pool.map(p => [vwScore(p), p] as [number, Post]).sort((a, b) => b[0] - a[0]).map(x => x[1])).slice(0, n)
    .map(p => {
      const c = { ...p }; if (!vwSeen.has(p.id)) vwSeen.add(p.id);
      laneClaim(p, 'reel'); c._vid = p.id + '~' + env.random().toString(36).slice(2, 6); return c;
    });
  vwQueue.push(...picks); return picks;
}
/** Reset the reel queue (web: opening a nation reel). */
export function vwReset(): void { vwQueue.length = 0; vwSeen.clear(); }
