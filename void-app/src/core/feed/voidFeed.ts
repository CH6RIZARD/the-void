// The VOID feed pipeline: pull (proxy -> Bluesky -> Reddit), Void users' own drops
// from Supabase, and the append-only batch selection renderFeed() did.
import { env } from '../env.ts';
import type { Post } from '../types.ts';
import { VoidAPI } from '../api/voidApi.ts';
import { VoidAuth } from '../api/auth.ts';
import { orderFeedBatch } from '../rank/order.ts';
import { setRefreshBoost } from '../rank/bio.ts';
import { admitPost } from '../rank/seen.ts';
import { pullBlueskyPage } from './bluesky.ts';
import { pullProxyPage, resetProxyOffset } from './proxy.ts';
import { pullRedditPage } from './reddit.ts';
import { laneClaim, laneFree, surfaceClaim, surfaceFree } from './search.ts';
import { allPosts, emitPostsChanged, trimStore } from './store.ts';
import { timed } from '../slow.ts';

let feedLoading = false;
export type FeedPullResult = 'ok' | 'empty' | 'busy' | 'error';
/**
 * One VOID-feed pull. Proxy first when configured; then Bluesky getFeed (the only
 * source that worked browser-direct); then Reddit. 'empty' with nothing held is
 * the web's "NO VERIFIED SIGNAL — CHECK CONNECTION AND RETRY".
 */
export async function pullVoidFeed(): Promise<FeedPullResult> {
  if (feedLoading) return 'busy'; feedLoading = true;
  try {
    if (env.proxyBase) {
      try {
        const posts = await pullProxyPage();
        let added = 0; for (const p of posts) if (admitPost(p)) { allPosts.push(p); added++; }
        if (added) { emitPostsChanged('feed'); return 'ok'; }
      } catch { /* fall through to direct sources */ }
    }
    let ok = (await pullBlueskyPage()).length > 0;
    if (!ok) ok = (await pullRedditPage()).length > 0;
    trimStore(new Set(_rendered));   // keep the store bounded; on-screen rows are safe
    return ok ? 'ok' : 'empty';
  } catch { return 'error'; } finally { feedLoading = false; }
}

// ─── APPEND-ONLY RENDER MODEL ────────────────────────────────────────────
// Posts already on screen KEEP their position permanently. Only the newly arrived
// tail is ranked and appended (re-sorting everything restarted videos and jumped
// posts under the reader's thumb).
export const _rendered = new Set<string>();
export const _evicted = new Set<string>();   // windowed out of the list; must not come back as fresh

/**
 * The next batch to append (web renderFeed minus DOM): fresh, on-feed, lane/surface
 * free, ordered by orderFeedBatch. Marks them rendered and claims the feed surface.
 * `hidden` = moderation predicate (blocked author / hidden post).
 */
export function nextFeedBatch(hidden?: (p: Post) => boolean, exclude?: Set<string>): Post[] {
  return timed('nextFeedBatch', () => nextFeedBatchInner(hidden, exclude));
}
function nextFeedBatchInner(hidden?: (p: Post) => boolean, exclude?: Set<string>): Post[] {
  let fresh = peekFeedFresh(hidden, exclude);
  if (!fresh.length) return [];
  fresh = staleLast(orderFeedBatch(fresh));
  fresh.forEach(p => { _rendered.add(p.id); laneClaim(p, 'feed'); surfaceClaim(p, 'feed'); });
  return fresh;
}
// ─── SETTLE FIRST, THEN STAY LIVE (web renderFeed, same rules) ───────────
// Append-by-arrival let whichever source answered FIRST own the top of the feed for
// the session: signed in, that is the Void backend, so a user's days-old drop sat
// above every newer post. Posts older than FEED_MAX_AGE_H never enter the feed; the
// screen re-ranks everything while it settles and sorts stale posts after fresh
// ones; once settled, anything newer than what is shown waits for a pull-to-refresh.
// See VoidFeedScreen.
export const FEED_MAX_AGE_H = 48;
export const FEED_SETTLE_MS = 20000;
export const FEED_STALE_H = 24;
/** Refresh depth (web refreshVoidFeed): pull up to PULLS pages for MIN unseen; replace with only unseen at REPLACE+. */
export const FEED_REFRESH_MIN = 20;
export const FEED_REFRESH_PULLS = 3;
export const FEED_REFRESH_REPLACE = 8;
/** Fresh posts that would be dealt next, WITHOUT dealing them. */
export function peekFeedFresh(hidden?: (p: Post) => boolean, exclude?: Set<string>): Post[] {
  const oldest = env.now() - FEED_MAX_AGE_H * 3600000;
  return allPosts.filter(p => !_rendered.has(p.id) && !_evicted.has(p.id) && !(exclude && exclude.has(p.id)) && !p._offFeed && (p.time || 0) >= oldest && laneFree(p, 'feed') && surfaceFree(p, 'feed', hidden));
}
/** Posts older than FEED_STALE_H follow the fresh ones; rank order kept inside each group. */
export function staleLast(list: Post[]): Post[] {
  const cut = env.now() - FEED_STALE_H * 3600000;
  return list.filter(p => (p.time || 0) >= cut).concat(list.filter(p => (p.time || 0) < cut));
}
/** Re-deal the whole feed, ranked together; `lead` ids (if any) go first for this one pass. */
export function rebuildFeedBatch(hidden?: (p: Post) => boolean, lead?: Set<string> | null, exclude?: Set<string>): Post[] {
  return timed('rebuildFeedBatch', () => rebuildFeedBatchInner(hidden, lead, exclude));
}
function rebuildFeedBatchInner(hidden?: (p: Post) => boolean, lead?: Set<string> | null, exclude?: Set<string>): Post[] {
  _rendered.clear(); _evicted.clear();
  if (lead && lead.size) setRefreshBoost(lead);
  try { return nextFeedBatch(hidden, exclude); } finally { if (lead && lead.size) setRefreshBoost(null); }
}
/** A list that windows old rows away reports them here (FEED_DOM_MAX=90, trim 30). */
export const FEED_WINDOW = { max: 90, trim: 30 };
export function markEvicted(ids: string[]): void { ids.forEach(id => _evicted.add(id)); }

let _refreshing = false;
/**
 * Pull-to-refresh. Pull BEFORE rendering; whatever arrived in THIS pull leads the
 * feed (refresh lift for one ordering pass), then the list is rebuilt. Returns the
 * rebuilt first batch, or null if a refresh was already running.
 */
export async function refreshVoidFeed(hidden?: (p: Post) => boolean): Promise<Post[] | null> {
  if (_refreshing) return null; _refreshing = true;
  try {
    resetProxyOffset();
    // Everything not yet seen leads: this pull's arrivals AND posts held back since the
    // feed settled (only a refresh shows them). Seen = on screen now or windowed out.
    const had = new Set([..._rendered, ..._evicted]);
    try { await pullSupabasePosts(true); } catch { /* */ }   // Void users' own drops (with media)
    // Depth: one pull is ~12 usable posts. Pull (bounded) until a screenful-and-more is
    // unseen, then show ONLY unseen posts - what was already read is gone, not reshuffled.
    const oldest = env.now() - FEED_MAX_AGE_H * 3600000;
    const unseen = () => allPosts.filter(p => !had.has(p.id) && !p._offFeed && (p.time || 0) >= oldest && laneFree(p, 'feed') && surfaceFree(p, 'feed', hidden)).length;
    for (let i = 0; i < FEED_REFRESH_PULLS && unseen() < FEED_REFRESH_MIN; i++) {
      const before = unseen();
      await pullVoidFeed();
      if (unseen() === before && i) break;   // sources are dry right now
    }
    setRefreshBoost(new Set(allPosts.filter(p => !had.has(p.id)).map(p => p.id)));
    _rendered.clear(); _evicted.clear();
    if (unseen() >= FEED_REFRESH_REPLACE) had.forEach(id => _evicted.add(id));
    return nextFeedBatch(hidden);
  } finally { setRefreshBoost(null); _refreshing = false; }
}

// ─── VOID USERS' OWN DROPS ──────────────────────────────────────────────
export function mediaKindFromUrl(u: unknown): 'video' | 'audio' | 'image' {
  const e = (String(u || '').match(/\.([a-z0-9]+)(?:$|\?)/i) || [])[1] || '';
  return /^(mp4|webm|mov)$/i.test(e) ? 'video' : /^(weba|ogg|oga|m4a|mp3)$/i.test(e) ? 'audio' : 'image';
}
/** Server row (posts + profiles + post_media) -> the app's post shape. */
export function sbPostToApp(row: any): Post | null {
  if (!row || !row.id) return null;
  const media = (row.post_media || []).slice().sort((a: any, b: any) => (a.ordinal || 0) - (b.ordinal || 0))
    .map((m: any) => ({ url: m.url, kind: m.kind || mediaKindFromUrl(m.url), dur: m.duration_s }));
  const imgs = media.filter((m: any) => m.kind === 'image').map((m: any) => m.url);
  const vids = media.filter((m: any) => m.kind === 'video').map((m: any) => m.url);
  const auds = media.filter((m: any) => m.kind === 'audio');
  const prof = row.profiles || {};
  const handle = String(prof.handle || 'void');
  const me = VoidAPI._uid();
  const p: Post = {
    id: row.id, source: 'void', style: 'drop', _isoColor: '#5b21d4', _author: prof.display_name || handle, _handle: '@' + handle, _authorId: row.author_id,
    body: row.body || '', tags: ['void'], time: Date.parse(row.created_at) || env.now(), score: row.rank_score || 0, replies: 0, reposts: 0, country: '', iso: '', _sb: true,
  };
  if (me && row.author_id === me) p._user = true;
  if (imgs.length) { p._img = imgs[0]; p._imgs = imgs; }
  if (vids.length) p._video = vids[0];
  if (auds.length) { p._audio = auds[0].url; if (auds[0].dur) p._audioDur = auds[0].dur; }
  const n = imgs.length + vids.length;
  p.style = auds.length ? 'audio' : n > 1 ? (imgs.length ? 'carousel' : 'video') : vids.length ? 'video' : imgs.length ? 'image' : 'drop';
  return p;
}
let _sbPostsAt = 0;
/** Posts written by Void users, merged into allPosts by id (throttled to 20s unless forced). */
export async function pullSupabasePosts(force?: boolean): Promise<{ added: number; mine: number }> {
  if (!VoidAuth.configured()) return { added: 0, mine: 0 };
  if (!force && env.now() - _sbPostsAt < 20000) return { added: 0, mine: 0 };
  _sbPostsAt = env.now();
  let rows: any[] = [];
  try { rows = await VoidAPI.recentPosts(40); } catch { return { added: 0, mine: 0 }; }
  const have = new Set(allPosts.map(p => p.id));
  let added = 0, mine = 0;
  for (const row of rows || []) {
    if (have.has(row.id)) continue;
    const p = sbPostToApp(row); if (!p) continue;
    allPosts.push(p); added++; if (p._user) mine++;
  }
  if (added) emitPostsChanged('feed');
  return { added, mine };
}
