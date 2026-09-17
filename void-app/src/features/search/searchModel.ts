// Data half of renderSearch(q) from void2-final.html. Pure over core state; the
// screen renders what this returns. The moderation wrapper on surfaceFree (hidden
// posts are never free anywhere) is folded in via moderation.hidden.
import {
  BIO,
  LIVE_CHANNELS,
  _surfKeys,
  allPosts,
  moderation,
  pullSearchDiscovery,
  pullSearchQuery,
  reelPosts,
  searchPosts,
  searchQueryResults,
  surfaceClaim,
  surfaceFree,
} from '../../core';
import type { Post } from '../../core';

export type SearchFilter = 'all' | 'live' | 'controversy' | 'conflict' | 'surveillance' | 'theology' | 'power';

/** <div class="filter-row"> — order and labels exactly as the web markup. */
export const FILTERS: Array<{ f: SearchFilter; label: string }> = [
  { f: 'all', label: 'ALL' },
  { f: 'live', label: 'LIVE' },
  { f: 'controversy', label: 'CONTROVERSY' },
  { f: 'conflict', label: 'CONFLICT' },
  { f: 'surveillance', label: 'SURVEILLANCE' },
  { f: 'theology', label: 'THEOLOGY' },
  { f: 'power', label: 'POWER' },
];

export interface LiveChannelRef {
  n: string;
  id: string;
  vid?: string;
}

export const channels = (): LiveChannelRef[] => LIVE_CHANNELS as unknown as LiveChannelRef[];

export type SearchBlock =
  | { kind: 'label'; key: string; text: string; live?: boolean }
  | { kind: 'feat'; key: string; ch: LiveChannelRef }
  | { kind: 'row'; key: string; chs: LiveChannelRef[] }
  | { kind: 'post'; key: string; post: Post; index: number }
  | { kind: 'empty'; key: string };

export interface SearchRender {
  sig: string;
  blocks: SearchBlock[];
}

const matchesFilter = (p: Post, f: string) => (p.tags || []).some((t) => t === f) || (p.body || '').toLowerCase().includes(f);

/** Channel row keyed by its slot, so a tile keeps its player when the posts around it change. */
const row = (slot: string, chs: LiveChannelRef[]): SearchBlock => ({ kind: 'row', key: 'row:' + slot + ':' + chs.map((c) => c.id).join(','), chs });

/**
 * renderSearch(q). Side effects exactly as the web: kicks pullSearchQuery for a typed
 * query, pullSearchDiscovery when fewer than 24 free cards remain (no query), and
 * claims every rendered card for the 'search' surface.
 */
export function buildSearch(q: string, filter: SearchFilter): SearchRender {
  const LC = channels();
  const lq = String(q || '').trim().toLowerCase();
  if (filter === 'live') {
    return {
      sig: 'live|' + q,
      blocks: [
        { kind: 'label', key: 'lbl:live', text: 'LIVE NOW', live: true },
        { kind: 'feat', key: 'feat:' + LC[0].id, ch: LC[0] },
        row('a', LC.slice(1, 3)),
        row('b', LC.slice(3, 5)),
        row('c', LC.slice(5, 7)),
      ],
    };
  }

  if (lq) pullSearchQuery(lq).catch(() => {});
  const base: Post[] = lq ? [...searchQueryResults(lq), ...searchPosts, ...reelPosts, ...allPosts] : searchPosts;
  const seenId = new Set<string>();
  let pool = base.filter((p) => p && p.id && !seenId.has(p.id) && !!seenId.add(p.id));
  if (lq)
    pool = pool.filter(
      (p) =>
        [p.body, p._desc, p.country, p._author].some((x) => String(x || '').toLowerCase().includes(lq)) ||
        (p.tags || []).some((t) => t.toLowerCase().includes(lq)),
    );
  if (filter !== 'all') pool = pool.filter((p) => matchesFilter(p, filter));
  const boost = new Map<Post, number>();
  pool.forEach((p) => boost.set(p, (p.tags || []).reduce((n, t) => n + (BIO.tags[t] || 0), 0)));
  pool = pool
    .map((p, i) => [p, i] as [Post, number])
    .sort((a, b) => boost.get(b[0])! - boost.get(a[0])! || (lq ? (b[0].score || 0) - (a[0].score || 0) : a[1] - b[1]))
    .map((x) => x[0]);

  let posts: Post[] = [];
  const pickText = new Set<string>();
  let free = 0;
  for (const p of pool) {
    if (!surfaceFree(p, 'search', moderation.hidden)) continue;
    free++;
    if (posts.length >= 12) continue;
    const t = _surfKeys(p).t;
    if (t && pickText.has(t)) continue;
    if (t) pickText.add(t);
    posts.push(p);
  }
  if (!lq && free < 24) pullSearchDiscovery().catch(() => 0); // keep discovery stocked ahead of the exclusions
  const sig = filter + '|' + q + '|' + posts.map((p) => p.id).join(',');
  posts.forEach((p) => surfaceClaim(p, 'search'));
  if (filter !== 'all') posts = posts.filter((p) => matchesFilter(p, filter));

  const blocks: SearchBlock[] = [
    { kind: 'label', key: 'lbl:live', text: 'LIVE NOW', live: true },
    { kind: 'feat', key: 'feat:' + LC[0].id, ch: LC[0] },
    row('a', LC.slice(1, 3)),
  ];
  if (posts.length) {
    blocks.push({ kind: 'label', key: 'lbl:signal', text: 'SIGNAL FEED' });
    posts.slice(0, 12).forEach((p, i) => {
      blocks.push({ kind: 'post', key: 'post:' + p.id, post: p, index: i });
      if ((i + 1) % 4 === 0) {
        const off = (3 + Math.floor(i / 4) * 2) % LC.length;
        blocks.push(row('p' + i, [0, 1].map((j) => LC[(off + j) % LC.length])));
      }
    });
  } else blocks.push({ kind: 'empty', key: 'empty' });
  return { sig, blocks };
}
