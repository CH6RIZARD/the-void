// In-memory post pools. Real upstream items only — no seed/fabricated content is
// ever admitted. allPosts also holds off-feed items (nation pane, opened search
// cards) flagged _offFeed so thread/photo lookups resolve them.
import type { Post } from '../types.ts';

export const allPosts: Post[] = [];
export const reelPosts: Post[] = [];

// Reel cards live in reelPosts, feed cards in allPosts. Any lookup by id must check BOTH.
export function findPost(id: string): Post | undefined { return allPosts.find(x => x.id === id) || reelPosts.find(x => x.id === id); }

type Listener = (reason: 'feed' | 'reels' | 'nation' | 'search') => void;
const _listeners = new Set<Listener>();
/** Subscribe to pool growth (replaces the web's direct renderFeed() calls). */
export function onPostsChanged(fn: Listener): () => void { _listeners.add(fn); return () => { _listeners.delete(fn); }; }
export function emitPostsChanged(reason: 'feed' | 'reels' | 'nation' | 'search'): void { for (const l of _listeners) { try { l(reason); } catch { /* */ } } }

/** Test/reset hook. */
export function resetStore(): void { allPosts.length = 0; reelPosts.length = 0; }

// ─── THE STORE HAS A CEILING ─────────────────────────────────────────────
// allPosts grew without limit: every pull, every poll, every page of infinite
// scroll appended and nothing ever left. The feed screen scans it on each change
// (peekFeedFresh, nextFeedBatch, findPost), so the cost of arriving at the feed
// grew with the session - measured on the test phone, switching to the VOID tab
// blocked 2 s early on and 9 s a few rounds later, while every other tab stayed at
// the ~1.1 s floor of the measurement itself.
//
// The list on screen is 90 rows; holding thousands of post objects behind it buys
// nothing. Oldest first, anything not currently rendered and not held by another
// surface is dropped. Reels keep their own, smaller pool the same way.
export const STORE_MAX = { posts: 600, reels: 300 };
// _offFeed posts are owned by other surfaces (nation deals, opened search
// cards) and immune to the main pass below - but nothing ever CLEARS the flag,
// so an evening of nation browsing turned the ceiling into a floor that only
// rises. They get their own LRU budget instead of immunity: generous enough
// that a mounted nation screen's posts (the newest ~16-48) are never the cut.
const OFF_FEED_MAX = 200;
function trim(list: Post[], max: number, protectedIds: Set<string>): number {
  let removed = 0;
  if (list.length > max) {
    const oldestFirst = list.slice().sort((a, b) => (a.time || 0) - (b.time || 0));
    for (const p of oldestFirst) {
      if (list.length <= max) break;   // splice already shrank it; do not subtract twice
      if (protectedIds.has(p.id) || p._offFeed) continue;   // on screen, or owned elsewhere
      const at = list.indexOf(p);
      if (at >= 0) { list.splice(at, 1); removed++; }
    }
  }
  const off = list.filter(p => p._offFeed && !protectedIds.has(p.id));
  if (off.length > OFF_FEED_MAX) {
    off.sort((a, b) => (a.time || 0) - (b.time || 0));
    for (const p of off.slice(0, off.length - OFF_FEED_MAX)) {
      const at = list.indexOf(p);
      if (at >= 0) { list.splice(at, 1); removed++; }
    }
  }
  return removed;
}
/** Drop the oldest posts nobody is showing. Returns how many went. */
export function trimStore(protectedIds: Set<string> = new Set()): { posts: number; reels: number } {
  return { posts: trim(allPosts, STORE_MAX.posts, protectedIds), reels: trim(reelPosts, STORE_MAX.reels, protectedIds) };
}
