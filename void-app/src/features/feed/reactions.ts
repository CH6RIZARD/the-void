// postReactions / react('fire') / repost() for the feed card and the thread OP.
//
// The ONE app-wide optimistic reaction state lives in src/features/reels/reelStore.ts
// (postReactions, toggleBolt, toggleRepost: VoidAPI + rollback + "SIGNAL LOST · RETRY"
// + light haptics). This file only adapts it for PostCard / ThreadScreen, so a bolt on a
// reel shows on the feed card and in the thread, and vice versa.
import { useEffect, useState } from 'react';
import { postReactions, toggleBolt, toggleRepost as reelToggleRepost, useReelStoreVersion, type Reaction } from '../reels/reelStore';

export type { Reaction };

const EMPTY: Reaction = { fire: 0, rank: 0, slash: 0, mf: false, mr: false, ms: false };

// Per-post repaint for things the reel store does not track (reply counts synced by core).
const listeners = new Map<string, Set<() => void>>();
export function touchPost(id: string): void {
  listeners.get(id)?.forEach((l) => {
    try {
      l();
    } catch {}
  });
}

/** Re-renders when any reaction changes (reel store) or this post's counts were touched. */
export function usePostReaction(id: string): Reaction {
  useReelStoreVersion();
  const [, setN] = useState(0);
  useEffect(() => {
    let s = listeners.get(id);
    if (!s) listeners.set(id, (s = new Set()));
    const f = () => setN((n) => n + 1);
    s.add(f);
    return () => {
      s!.delete(f);
    };
  }, [id]);
  return postReactions[id] || EMPTY;
}

/** web react(postId,'fire') */
export const fireBolt = (postId: string) => toggleBolt(postId);
/** web repost(postId) */
export const toggleRepost = (postId: string) => reelToggleRepost(postId);

/** Displayed bolt count: p.score + local fire delta. */
export const boltCount = (score: number, r: Reaction) => Math.max(0, (score || 0) + (r.fire || 0));
