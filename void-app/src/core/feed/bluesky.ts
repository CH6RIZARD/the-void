// Bluesky — the primary no-backend source. The public AppView sends
// Access-Control-Allow-Origin:* and getFeed carries real image + video media and
// paginates via cursor.
//
// The old single source was 'whats-hot', a TRANSPORT choice that silently became an
// EDITORIAL one (~89% no topical signal). These are topical feed generators rotated
// per page so no single feed dominates and the feed never runs dry.
// NOTE: app.bsky.feed.searchPosts answers 403 unauthenticated — no keyword path.
import { env, onConfigure } from '../env.ts';
import type { Post } from '../types.ts';
import { stampRegion } from '../data/regions.ts';
import { feedGate } from '../rank/filters.ts';
import { inferTags } from '../rank/tags.ts';
import { allPosts } from './store.ts';

export const BSKY_FEEDS = [
  // Ordered by MEASURED yield against inferTags() (50-60 posts sampled per feed):
  //   aaahy7 24 matched/13 +media · aaagsz 35/9 · aaalrz 24/5 · aaadhh 10/4 · whats-hot 4/3 (39 img, 9 vid)
  // The mainstream news generators (verified-news, news-2-0) are REMOVED: they made
  // the app "wire copy", and verified-news had 0 images in 49 posts.
  'at://did:plc:aqas4wywoe44zdhz6tsc7wc7/app.bsky.feed.generator/aaahy7kprt3xy',
  'at://did:plc:aqas4wywoe44zdhz6tsc7wc7/app.bsky.feed.generator/aaagszaa6pbug',
  'at://did:plc:rmnjia7e5eh3jamsizupx5yc/app.bsky.feed.generator/aaalrzaywm6ls',
  'at://did:plc:7mtqkeetxgxqfyhyi2dnyga2/app.bsky.feed.generator/aaadhh6hwvaca',
  // WORLD lane: every feed above is US + Middle-East politics (296 live posts, ZERO
  // Nepal mentions while its flood toll passed 1,300). Mostly wire copy the gate
  // refuses, but fast disaster reports pass feedGate's breaking exemption.
  'at://did:plc:3sn6bogankaicebzdb7liro3/app.bsky.feed.generator/aaajaq4ut77am',
  // whats-hot kept LAST: ~7% on-topic but the most media; the tag gate drops the rest.
  'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot',
];

export const BSKY_APPVIEW = 'https://public.api.bsky.app/xrpc';
export function bskyFeedUrl(feed: string, cursor?: string, limit = 30): string {
  return BSKY_APPVIEW + '/app.bsky.feed.getFeed?feed=' + encodeURIComponent(feed) + '&limit=' + limit + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
}

// Cursors and rotation persist: without this every launch restarted at page one of
// feed one and re-served content already read.
export let _bskyCursors: Record<string, string> = {};
export let _bskyIdx = 0;
function loadBsky() {
  try { _bskyCursors = JSON.parse(env.storage.getItem('void_bsky_cursors') || '{}') || {}; } catch { _bskyCursors = {}; }
  _bskyIdx = parseInt(env.storage.getItem('void_bsky_idx') || '0', 10) || 0;
}
loadBsky();
onConfigure(loadBsky);
function _saveBskyState() {
  try {
    env.storage.setItem('void_bsky_cursors', JSON.stringify(_bskyCursors));
    env.storage.setItem('void_bsky_idx', String(_bskyIdx));
  } catch { /* */ }
}

/** A person's name, without the appview's domain suffix stapled to it. */
export function dispHandle(h?: string): string {
  return String(h || '').replace(/\.bsky\.social$/i, '') || 'void';
}

/** A source/host as shown on screen: the appview is plumbing, it reads as VOID. */
export function srcName(s?: string): string {
  const v = String(s || 'void').toLowerCase();
  return /^(bluesky|bsky|(cdn\.|public\.api\.)?bsky\.app)$/.test(v) ? 'void' : v;
}

/** Where a post's share link points: the original, unless the original is the appview. */
export function shareUrl(p: { id: string; source?: string; sourceUrl?: string; _url?: string }): string {
  const orig = srcName(p.source) === 'void' ? '' : p.sourceUrl || p._url;
  return orig || `https://void-app-d35c.pages.dev/#${p.id}`;
}

export function bskyToPost(item: any): Post {
  const post = (item && item.post) || {}, rec = post.record || {}, emb = post.embed || {};
  let img = '', vid = '', style = 'take';
  const im = emb.images || (emb.media && emb.media.images) || [];
  // Multi-image posts keep the whole set so they render as a swipeable carousel.
  let imgs: string[] = [];
  if (im && im.length) {
    imgs = im.map((x: any) => x.fullsize || x.thumb || '').filter(Boolean);
    img = imgs[0] || ''; style = imgs.length > 1 ? 'carousel' : 'image';
  }
  if (/embed\.video/.test(emb.$type || '') || (emb.media && /embed\.video/.test(emb.media.$type || ''))) { vid = emb.playlist || (emb.media && emb.media.playlist) || ''; img = emb.thumbnail || (emb.media && emb.media.thumbnail) || img; if (vid) style = 'video'; }
  if (!img && !vid) style = 'take';
  const au = post.author || {}, handle = au.handle || '', rkey = String(post.uri || '').split('/').pop();
  // Labels are a SIGNAL, never a filter: a labelled post is tagged 'graphic' and the
  // ranker decides per user. Self-labels on the record, moderation labels on the post.
  const labs = [...(post.labels || []), ...((rec.labels && rec.labels.values) || [])]
    .map((l: any) => String((l && l.val) || '').toLowerCase());
  const graphic = labs.some(v => /graphic|gore|violen|corpse|nsfw|porn|sexual|nudity/.test(v));
  //  _reposts/_quotes — a QUOTE is the closest thing to an argument signal here.
  //  _link — external article URL, for same-story dedupe.  _repost — a re-surface.
  //  _wire — posted by an organisation (handle is its own domain, not *.bsky.social).
  const ext = (emb.external && emb.external.uri) || ((rec.embed && rec.embed.external && rec.embed.external.uri) || '');
  const wire = !!handle && !/\.bsky\.social$/i.test(handle) && /\./.test(handle);
  return stampRegion({
    id: 'bsky_' + (post.cid || post.uri || env.random()), style, country: '', iso: '',
    tags: inferTags(rec.text, graphic ? ['graphic'] : []), _graphic: graphic,
    _reposts: post.repostCount || 0, _quotes: post.quoteCount || 0, _link: ext, _wire: wire,
    _repost: /Repost/i.test((item && item.reason && item.reason.$type) || ''),
    body: rec.text || '', score: post.likeCount || 0, replies: post.replyCount || 0,
    time: rec.createdAt ? Date.parse(rec.createdAt) : env.now(), source: 'bluesky',
    _author: au.displayName || dispHandle(handle), _handle: '@' + dispHandle(handle), _img: img, _imgs: imgs, _video: vid,
    _url: handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : '', _social: true,
    // The at:// URI is what getPostThread needs (replies).
    _uri: post.uri || '',
    provenance: { sourceHost: 'bsky.app' }, imgHue: 270,
  } as Post);
}

/**
 * One page of the VOID feed from Bluesky: rotate across the topical feeds (each with
 * its own cursor), gate every item, and keep pulling across feeds until at least
 * MIN_PER_PULL land (ending on 2-3 posts looked broken). Admitted posts are pushed
 * to allPosts. Returns the posts added this pull. Does NOT emit: pullVoidFeed emits
 * once with the proxy's posts, so the mixer deals both sources in one batch.
 */
export async function pullBlueskyPage(): Promise<Post[]> {
  const MIN_PER_PULL = 10; const got: Post[] = [];
  for (let attempt = 0; attempt < BSKY_FEEDS.length; attempt++) {
    const feed = BSKY_FEEDS[_bskyIdx % BSKY_FEEDS.length]; _bskyIdx++;
    const cur = _bskyCursors[feed] || '';
    try {
      const r = await env.fetch(bskyFeedUrl(feed, cur), { headers: { Accept: 'application/json' } }); if (!r.ok) continue;
      const d = await r.json(); _bskyCursors[feed] = d.cursor || ''; _saveBskyState(); // empty cursor => feed restarts next visit
      for (const it of (d.feed || [])) {
        const p = bskyToPost(it);
        if (!p || feedGate(p)) continue;
        allPosts.push(p); got.push(p);
      }
      if (got.length >= MIN_PER_PULL) return got;
    } catch { /* next feed */ }
  }
  return got;
}
