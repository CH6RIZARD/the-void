// Reddit public .json. NOTE: www.reddit.com answers 403 with no CORS header to a
// browser, so on the web this only worked through the proxy. Natively there is no
// CORS, but Reddit still rate-limits unauthenticated clients; kept as the web had it.
import { env } from '../env.ts';
import type { Post } from '../types.ts';
import { stampRegion } from '../data/regions.ts';
import { admitPost } from '../rank/seen.ts';
import { SUB_TAGS, inferTags } from '../rank/tags.ts';
import { decodeEnt } from '../util.ts';
import { allPosts, emitPostsChanged } from './store.ts';

export const FEED_SUBS = ['worldnews', 'geopolitics', 'news', 'UkrainianConflict', 'worldevents', 'InternationalNews', 'MiddleEastNews', 'CombatFootage'];
let _subIdx = 0; const _subAfter: Record<string, string> = {};

export function redditToPost(ch: any): Post | null {
  // over_18 is deliberately NOT a reject condition. Conflict footage is the product;
  // the post is tagged 'graphic' and the per-user ranker decides.
  const d = (ch && ch.data) || {}; if (d.stickied || !d.id) return null;
  let img = '', vid = '', style = 'take';
  try {
    const prev = d.preview && d.preview.images && d.preview.images[0];
    if (d.is_video && d.media && d.media.reddit_video) { vid = d.media.reddit_video.fallback_url || ''; style = 'video'; }
    else if (prev && prev.variants && prev.variants.mp4) { vid = decodeEnt(prev.variants.mp4.source.url); style = 'video'; }
    if (prev && prev.source) img = decodeEnt(prev.source.url);
    if (!img && /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(d.url || '')) img = d.url;
    if (!img && d.thumbnail && /^https?:/.test(d.thumbnail)) img = d.thumbnail;
    if (!vid && img && style !== 'video') style = 'image';
  } catch { /* */ }
  if (!img && !vid) style = 'take';
  const sub = String(d.subreddit || '').toLowerCase();
  const seedTags = [...(SUB_TAGS[sub] || []), ...(d.over_18 || d.spoiler ? ['graphic'] : [])];
  return stampRegion({
    id: 'rd_' + d.id, style, country: (d.link_flair_text || '').slice(0, 40), iso: '',
    tags: inferTags(d.title, seedTags), _graphic: !!(d.over_18 || d.spoiler),
    body: decodeEnt(d.title || ''), score: d.score || 0, replies: d.num_comments || 0,
    time: (d.created_utc || 0) * 1000 || env.now(), source: 'reddit', _author: 'r/' + (d.subreddit || 'world'),
    _handle: 'u/' + (d.author || 'anon'), _img: img, _video: vid, _url: 'https://reddit.com' + (d.permalink || ''),
    _social: true, provenance: { sourceHost: 'reddit.com' }, imgHue: 270,
  } as Post);
}

/** One page across rotating subs, `after` cursors (null cursor restarts a sub). */
export async function pullRedditPage(): Promise<Post[]> {
  for (let attempt = 0; attempt < FEED_SUBS.length; attempt++) {
    const sub = FEED_SUBS[_subIdx % FEED_SUBS.length]; _subIdx++;
    const after = _subAfter[sub] || '';
    try {
      const u = `https://www.reddit.com/r/${sub}/hot.json?limit=25&raw_json=1${after ? '&after=' + after : ''}`;
      const r = await env.fetch(u, { headers: { Accept: 'application/json' } }); if (!r.ok) continue;
      const d = await r.json(); const kids = (d && d.data && d.data.children) || [];
      _subAfter[sub] = (d && d.data && d.data.after) || '';
      const got: Post[] = [];
      for (const p of kids.map(redditToPost)) if (admitPost(p)) { allPosts.push(p as Post); got.push(p as Post); }
      if (got.length) { emitPostsChanged('feed'); return got; }
    } catch { /* */ }
  }
  return [];
}
