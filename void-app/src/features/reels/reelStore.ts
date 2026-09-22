// Engagement + queue state for the immersive reel engine (web: postReactions/react()/
// repost()/repaintRepost(), vwFollowSet/vwFollow, vwFire/vwLess, openNationReel,
// openReel, fillGlobeReels). Every write is optimistic through VoidAPI with the
// standard rollback toast.
//
// NOTE: postReactions is app-wide on the web (feed card, thread and reel rail share
// it). No shared native store existed when this was written, so it lives here and is
// exported; the feed/thread agents can import it (or this file can re-export theirs).
import { useSyncExternalStore } from 'react';
import * as Haptics from 'expo-haptics';
import {
  C,
  VoidAPI,
  allPosts,
  env,
  findPost,
  learnReact,
  moderation,
  pullReelPage,
  reelPosts,
  resolveRegion,
  vwBump,
  vwFill,
  vwQueue,
  vwRecentHas,
  vwRemember,
  vwReset,
  vwSeen,
} from '../../core';
import type { Post } from '../../core';
import { voidToast } from '../../ui/Toast';
import { baseId } from '../search/format';

// ─── tiny subscribable store ─────────────────────────────────────────────
let version = 0;
const listeners = new Set<() => void>();
const bump = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
/** Re-render when any reaction / follow changes. */
export function useReelStoreVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

// ─── postReactions ───────────────────────────────────────────────────────
export interface Reaction {
  fire: number;
  rank: number;
  slash: number;
  mf: boolean;
  mr: boolean;
  ms: boolean;
  mrp?: boolean;
}
export const postReactions: Record<string, Reaction> = {};
export function reactionOf(id: string): Reaction {
  return postReactions[id] || (postReactions[id] = { fire: 0, rank: 0, slash: 0, mf: false, mr: false, ms: false });
}

const TOAST_LOST = 'SIGNAL LOST · RETRY';
const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

/** react(postId,'fire') — toggle, optimistic, BIO learn on, VoidAPI.bolt with rollback. */
export function toggleBolt(postId: string): void {
  const r = reactionOf(postId);
  const p = findPost(postId);
  r.mf = !r.mf;
  r.fire = (r.fire || 0) + (r.mf ? 1 : -1);
  if (r.mf) learnReact(p, postId, 'fire');
  tap();
  bump();
  VoidAPI.bolt(postId, !!r.mf).catch(() => {
    r.mf = !r.mf;
    r.fire = (r.fire || 0) + (r.mf ? 1 : -1);
    bump();
    voidToast(TOAST_LOST);
  });
}
export function boltCount(item: Post): number {
  const id = baseId(item.id);
  const p = findPost(id) || item;
  return Math.max(0, (p.score || 0) + ((postReactions[id] && postReactions[id].fire) || 0));
}

/** repost(postId) — p.reposts moves with the flip; rollback reaches the UI. */
export function toggleRepost(postId: string): void {
  const r = reactionOf(postId);
  const p = findPost(postId);
  r.mrp = !r.mrp;
  if (p) p.reposts = Math.max(0, (p.reposts || 0) + (r.mrp ? 1 : -1));
  tap();
  bump();
  VoidAPI.repost(postId, !!r.mrp).catch(() => {
    r.mrp = !r.mrp;
    if (p) p.reposts = Math.max(0, (p.reposts || 0) + (r.mrp ? 1 : -1));
    bump();
    voidToast(TOAST_LOST);
  });
}
export function repostCount(item: Post): number {
  const p = findPost(baseId(item.id)) || item;
  return p.reposts || 0;
}

// ─── FOLLOW (vwFollow) ───────────────────────────────────────────────────
const following = new Set<string>();
export const vwHandleOf = (p: Partial<Post> | null | undefined) => String((p && (p._handle || p._author)) || '').replace(/^@/, '').toLowerCase();
export const isFollowing = (p: Partial<Post> | null | undefined) => following.has(vwHandleOf(p));
/** Optimistic, mirrored onto every card by the same author (re-render), rolled back on rejection. */
export function toggleFollow(item: Post): void {
  const p = findPost(baseId(item.id)) || item;
  const h = vwHandleOf(p);
  if (!h) return;
  const on = !following.has(h);
  on ? following.add(h) : following.delete(h);
  tap();
  bump();
  VoidAPI.follow(h, on).catch(() => {
    on ? following.delete(h) : following.add(h);
    bump();
    voidToast(TOAST_LOST);
  });
}

/** vwShare(pid): the web copies location#pid; native hands the same link to the share sheet. */
export const SHARE_BASE = 'https://void-app-d35c.pages.dev/';
export function shareLink(pid: string): string {
  return SHARE_BASE + '#' + pid;
}

/** vwFire: bolt toggle + strong affinity. */
export function vwFire(item: Post): void {
  const pid = baseId(item.id);
  const p = findPost(pid);
  toggleBolt(pid);
  if (p) vwBump(p.tags, 1.5);
}
/** vwLess: affinity down (the scroll to the next card is the view's job). */
export function vwLess(item: Post): void {
  const p = findPost(baseId(item.id));
  if (p) vwBump(p.tags, -2.5);
}

/** The moderation layer's vwItemHtml wrapper: hidden posts never render. */
export const reelVisible = (p: Post) => !moderation.hidden(findPost(baseId(p.id)) || p);

// ─── QUEUE SEEDING ───────────────────────────────────────────────────────
/** fillGlobeReels(): fresh FOR YOU queue (any style, video-only by vwFill). */
export function seedInline(): Post[] {
  vwReset();
  return vwFill(6, true).filter(reelVisible);
}

/** Resolve ?nation= (ISO code or country name) to {code, name}. */
export function resolveNation(nation: string): { code: string; name: string } {
  const raw = String(nation || '').trim();
  const upper = raw.toUpperCase();
  const byIso = /^[A-Z]{2}$/.test(upper) ? (C as Array<{ n: string; iso: string }>).find((c) => c.iso === upper) : undefined;
  if (byIso) return { code: byIso.iso, name: byIso.n };
  const reg = resolveRegion(raw);
  const code = (reg && reg.code) || '';
  const named = (C as Array<{ n: string; iso: string }>).find((c) => c.iso === code);
  return { code, name: named ? named.n : raw };
}

/**
 * openNationReel(nation, postId): the queue is seeded from the nation's own pool
 * first (matched on the resolved region code, not raw country strings), then blends
 * back into the global ranking with vwFill(4, true).
 */
export function seedNation(nation: string, postId?: string | null): Post[] {
  const { code: want, name } = resolveNation(nation);
  const pool = allPosts.filter((p) => (want && (p._region === want || p.iso === want)) || p.country === name || p.country === nation);
  vwReset();
  const start = (postId && allPosts.find((p) => p.id === postId)) || pool[0];
  if (start) {
    vwQueue.push({ ...start, _vid: start.id + '~n' });
    vwSeen.add(start.id);
    vwRemember(start);
  }
  pool
    .filter((p) => !vwSeen.has(p.id) && !vwRecentHas(p))
    .slice(0, 5)
    .forEach((p) => {
      vwSeen.add(p.id);
      vwRemember(p);
      vwQueue.push({ ...p, _vid: p.id + '~' + env.random().toString(36).slice(2, 6) });
    });
  vwFill(4, true);
  return vwQueue.slice().filter(reelVisible);
}

/**
 * openReel(postId) phase 1 (synchronous): the tapped clip, already in hand, plays
 * while the rest loads. Returns the seeded list (0 or 1 item).
 */
export function seedOpenReel(postId: string): Post[] {
  vwReset();
  const start = findPost(postId);
  if (start && start._video) {
    vwQueue.push({ ...start, _vid: start.id + '~s' });
    vwSeen.add(start.id);
    vwRemember(start); // by VIDEO too: a repost of this clip must not come back as card 2
  }
  return vwQueue.slice().filter(reelVisible);
}
/** openReel phase 2: AWAIT the first pull when the pool is thin, then vwFill(5) (video styles only). */
export async function fillOpenReel(): Promise<Post[]> {
  if (reelPosts.length < 8) {
    try {
      await pullReelPage();
    } catch {}
  }
  return vwFill(5).filter(reelVisible);
}

/** Near the end → append four (ct.onscroll in every reel surface). */
export function appendMore(): Post[] {
  return vwFill(4, true).filter(reelVisible);
}

/** vwObserve dwell: mild positive signal for the card in view. */
export function dwell(item: Post): void {
  const p = findPost(baseId(item.id));
  if (p) vwBump(p.tags, 0.3);
}
