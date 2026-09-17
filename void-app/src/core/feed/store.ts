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
