// ─── SURFACES: SEARCH ≠ VOID FEED ──────────────────────────────────────────
// SEARCH's grid used to be allPosts re-sorted: 34 of 34 cards were posts the feed
// had already rendered. Search now has its own discovery sources and the two
// surfaces are mutually exclusive for the session, on the same three keys admitPost
// dedupes by: id, normalised text (_normText/_h), link (_linkKey/_h over
// _link/_url/sourceUrl).
//   feed   owns: every post it rendered + everything QUEUED for it (allPosts minus _offFeed)
//   search owns: every card it rendered
// First claim wins. admitPost's persisted seen-sets are untouched (session-only).
import { env } from '../env.ts';
import type { Post } from '../types.ts';
import { isFeedMeta, isMuted } from '../rank/filters.ts';
import { _h, _linkKey, _normText } from '../rank/seen.ts';
import { inferTags } from '../rank/tags.ts';
import { decodeEnt, nfFetchJson, nfHost, urlKey } from '../util.ts';
import { bskyFeedUrl, bskyToPost } from './bluesky.ts';
import { lemmyToPost, mastoToPost, ptRows } from './fedi.ts';
import { allPosts, emitPostsChanged, findPost } from './store.ts';

type SurfaceName = 'feed' | 'search';
interface Registry { ids: Set<string>; text: Set<string>; link: Set<string>; }
export const SURFACES: Record<SurfaceName, Registry> = {
  feed: { ids: new Set(), text: new Set(), link: new Set() },
  search: { ids: new Set(), text: new Set(), link: new Set() },
};
const _surfKeyCache = new WeakMap<object, { t: string; l: string[] }>();
export function _surfKeys(p: Post) {
  let k = _surfKeyCache.get(p); if (k) return k;
  const t = _normText(p.body);
  const l = [...new Set([p._link, p._url, p.sourceUrl].map(u => u ? _linkKey(u) : '').filter(Boolean).map(_h))];
  k = { t: t.length > 15 ? _h(t) : '', l }; _surfKeyCache.set(p, k); return k;
}
export function _surfHas(name: SurfaceName, p: Post | null | undefined): boolean {
  const R = SURFACES[name]; if (!p || !(R.ids.size || R.text.size || R.link.size)) return false;
  if (R.ids.has(p.id)) return true;
  const k = _surfKeys(p);
  return (!!k.t && R.text.has(k.t)) || k.l.some(x => R.link.has(x));
}
export function surfaceClaim(p: Post | null | undefined, name: SurfaceName): void {
  if (!p || !p.id) return; const R = SURFACES[name], k = _surfKeys(p);
  R.ids.add(p.id); if (k.t) R.text.add(k.t); k.l.forEach(x => R.link.add(x));
}
let _fqRef: Post[] | null = null, _fqN = 0;
function _syncFeedQueue() {
  if (_fqRef !== allPosts || _fqN > allPosts.length) { _fqRef = allPosts; _fqN = 0; }
  for (; _fqN < allPosts.length; _fqN++) {
    const p = allPosts[_fqN];
    // _offFeed = nation pane / opened-from-search: not the feed's. A post search
    // already showed can land in allPosts later; the feed refuses it.
    if (p && !p._offFeed && !_surfHas('search', p)) surfaceClaim(p, 'feed');
  }
}
/**
 * May `mine` show this post? Web parity note: the moderation layer wraps this so a
 * hidden/blocked post is never free anywhere — pass `hidden` (api/moderation) in.
 */
export function surfaceFree(p: Post, mine: SurfaceName, hidden?: (p: Post) => boolean): boolean {
  if (hidden && hidden(p)) return false;
  if (mine === 'search') { _syncFeedQueue(); return !_surfHas('feed', p); }
  return !_surfHas('search', p);
}

// Feed / reel lane exclusivity by post id (first claim wins).
const _lane = new Map<string, string>();
export const laneFree = (p: Post, mine: string) => { const cur = _lane.get(p.id); return !cur || cur === mine; };
export const laneClaim = (p: Post, mine: string) => { if (!_lane.has(p.id)) _lane.set(p.id, mine); };

// ─── SEARCH DISCOVERY SOURCES ──────────────────────────────────────────────
// None of these is read by the feed, reels or the nation pane. Verified 2026-09-13:
// mastodon.social trends (statuses, links, tags + top tag timeline), lemmy.world
// Hot, sepiasearch trending, Bluesky 'hot-classic' + 'for-science' (neither is in
// BSKY_FEEDS or REEL_FEEDS).
export const SEARCH_BSKY_FEEDS = [
  'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/hot-classic',
  'at://did:plc:jfhpnnst6flqway4eaeqzj2a/app.bsky.feed.generator/for-science',
];
export const searchPosts: Post[] = [];
const _searchById = new Map<string, Post>(), _searchPoolKeys: Registry = { ids: new Set(), text: new Set(), link: new Set() };
const _sd = { mOff: 0, lPage: 1, ptStart: 0, tagIdx: 0, bskyIdx: 0, bskyCur: {} as Record<string, string>, loading: false, last: 0 };
const _sqPool = new Map<string, Post[]>();
export function searchPostById(id: string): Post | null { return _searchById.get(id) || null; }
export function searchQueryResults(q: string): Post[] { return _sqPool.get(q) || []; }
export function _sdOk(p: Post | null | undefined): p is Post {
  if (!p || !p.id || _searchById.has(p.id)) return false;
  if (!(String(p.body || '').trim().length >= 12 || p._img || p._video)) return false;
  if (p._graphic || isFeedMeta(p.body) || isMuted(p)) return false;
  const k = _surfKeys(p);            // no duplicate cards inside search's own pool either
  if (_searchPoolKeys.ids.has(p.id) || (k.t && _searchPoolKeys.text.has(k.t)) || k.l.some(x => _searchPoolKeys.link.has(x))) return false;
  _searchPoolKeys.ids.add(p.id); if (k.t) _searchPoolKeys.text.add(k.t); k.l.forEach(x => _searchPoolKeys.link.add(x));
  _searchById.set(p.id, p); return true;
}
const _SD_NATION = { n: '' };
export async function _sdMastoStatuses(): Promise<Post[]> {
  const d = await nfFetchJson(`https://mastodon.social/api/v1/trends/statuses?limit=40&offset=${_sd.mOff}`);
  if (!Array.isArray(d)) return [];
  _sd.mOff = d.length ? _sd.mOff + d.length : 0;
  return d.map(x => mastoToPost(x, _SD_NATION)).filter(Boolean) as Post[];
}
export async function _sdMastoLinks(): Promise<Post[]> {
  const d = await nfFetchJson('https://mastodon.social/api/v1/trends/links?limit=20');
  if (!Array.isArray(d)) return [];
  return d.filter(x => x && x.url && x.title).map(x => {
    const host = nfHost(x.url);
    const uses = (x.history || []).reduce((s: number, h: any) => s + (+h.uses || 0), 0), accts = (x.history || []).reduce((s: number, h: any) => s + (+h.accounts || 0), 0);
    return {
      id: 'mdl_' + urlKey(x.url), style: x.image ? 'image' : 'take', country: '', iso: '', tags: inferTags(x.title + ' ' + (x.description || ''), []),
      body: decodeEnt(x.title), _desc: decodeEnt(String(x.description || '')).slice(0, 400), score: uses, replies: accts,
      time: Date.parse(x.published_at || '') || env.now(), source: 'news', _author: x.provider_name || host, _handle: '@' + host,
      _img: x.image || '', _video: '', _link: x.url, _url: x.url, sourceUrl: x.url, _social: false, provenance: { sourceHost: host }, imgHue: 270,
    } as Post;
  });
}
export async function _sdMastoTag(): Promise<Post[]> {
  const tags = await nfFetchJson('https://mastodon.social/api/v1/trends/tags?limit=10');
  if (!Array.isArray(tags) || !tags.length) return [];
  const t = tags[_sd.tagIdx++ % tags.length];
  const d = await nfFetchJson(`https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(t.name)}?limit=20`);
  return Array.isArray(d) ? d.map(x => mastoToPost(x, _SD_NATION)).filter(Boolean) as Post[] : [];
}
export async function _sdLemmy(): Promise<Post[]> {
  const d = await nfFetchJson(`https://lemmy.world/api/v3/post/list?type_=All&sort=Hot&limit=30&page=${_sd.lPage}`);
  const list = (d && d.posts) || [];
  _sd.lPage = list.length ? _sd.lPage + 1 : 1;
  return list.map((v: any) => lemmyToPost(v, _SD_NATION)).filter(Boolean);
}
export async function _sdPeertube(): Promise<Post[]> {
  const d = await nfFetchJson(`https://sepiasearch.org/api/v1/search/videos?sort=-trending&count=15&start=${_sd.ptStart}&nsfw=false`, 10000);
  const list = (d && d.data) || [];
  _sd.ptStart = list.length && _sd.ptStart < 300 ? _sd.ptStart + list.length : 0;
  return ptRows(list, 8);
}
export async function _sdBsky(): Promise<Post[]> {
  const feed = SEARCH_BSKY_FEEDS[_sd.bskyIdx++ % SEARCH_BSKY_FEEDS.length], cur = _sd.bskyCur[feed] || '';
  const d = await nfFetchJson(bskyFeedUrl(feed, cur));
  if (!d) return [];
  _sd.bskyCur[feed] = d.cursor || '';
  return (d.feed || []).filter((it: any) => !/Repost/i.test((it.reason && it.reason.$type) || '')).map(bskyToPost).filter(Boolean);
}
/** One discovery round (at most every 4s). Round-robin across sources so no network owns the grid. */
export async function pullSearchDiscovery(): Promise<number> {
  if (_sd.loading || env.now() - _sd.last < 4000) return 0;
  _sd.loading = true;
  try {
    const buckets = (await Promise.allSettled([_sdMastoStatuses(), _sdLemmy(), _sdBsky(), _sdPeertube(), _sdMastoLinks(), _sdMastoTag()]))
      .map(r => r.status === 'fulfilled' && Array.isArray(r.value) ? r.value.filter(_sdOk) : []);
    const add: Post[] = [];
    for (let i = 0, more = true; more; i++) { more = false; for (const b of buckets) if (i < b.length) { add.push(b[i]); more = true; } }
    searchPosts.push(...add);
    if (add.length) emitPostsChanged('search');
    return add.length;
  } catch { return 0; } finally { _sd.loading = false; _sd.last = env.now(); }
}
/** A typed query also asks Lemmy search, PeerTube search and a Mastodon hashtag timeline, once per query. */
export async function pullSearchQuery(q: string): Promise<Post[]> {
  if (_sqPool.has(q)) return _sqPool.get(q)!; _sqPool.set(q, []);
  const qe = encodeURIComponent(q), tag = /^[\p{L}\p{N}_]{3,}$/u.test(q) ? q : '';
  const res = await Promise.allSettled([
    nfFetchJson(`https://lemmy.world/api/v3/search?q=${qe}&type_=Posts&sort=TopMonth&limit=20`).then(d => ((d && d.posts) || []).map((v: any) => lemmyToPost(v, _SD_NATION)).filter(Boolean)),
    nfFetchJson(`https://sepiasearch.org/api/v1/search/videos?search=${qe}&sort=-match&count=10&nsfw=false`, 10000).then(d => ptRows((d && d.data) || [], 5)),
    tag ? nfFetchJson(`https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=20`).then(d => Array.isArray(d) ? d.map(x => mastoToPost(x, _SD_NATION)).filter(Boolean) : []) : Promise.resolve([]),
  ]);
  const got = res.flatMap(r => r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []).filter(_sdOk);
  _sqPool.set(q, got);
  if (got.length) emitPostsChanged('search');
  return got;
}
/** Search cards are not in allPosts; register the tapped one OFF the feed so a thread can open it. */
export function openSearchPost(id: string): Post | null {
  if (!allPosts.some(x => x.id === id)) { const p = searchPostById(id) || findPost(id); if (!p) return null; p._offFeed = true; allPosts.push(p); }
  return allPosts.find(x => x.id === id) || null;
}
