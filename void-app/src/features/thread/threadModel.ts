// Thread data helpers: _tcTree / _tcSort / threadSort (void_thread_sort) / the
// optimistic write path (_threadAddReply) with the VMod terms gate, and a hook that
// re-renders a thread whenever its replies change.
import { useEffect, useState } from 'react';
import { addReply, boltComment, env, loadUser, onRepliesChanged, saveUser, threadComments, type Comment } from '../../core';
import { voidToast } from '../../ui/Toast';
import { requireTerms } from '../feed/ModerationSheet';
import { touchPost } from '../feed/reactions';

export type ThreadSort = 'top' | 'new';

let sort: ThreadSort = (() => {
  try {
    return env.storage.getItem('void_thread_sort') === 'new' ? 'new' : 'top';
  } catch {
    return 'top';
  }
})();
const sortSubs = new Set<() => void>();
export function getThreadSort(): ThreadSort {
  return sort;
}
export function setThreadSort(s: ThreadSort): void {
  sort = s;
  try {
    env.storage.setItem('void_thread_sort', s);
  } catch {}
  sortSubs.forEach((f) => f());
}
export function useThreadSort(): ThreadSort {
  const [, setN] = useState(0);
  useEffect(() => {
    const f = () => setN((n) => n + 1);
    sortSubs.add(f);
    return () => {
      sortSubs.delete(f);
    };
  }, []);
  return sort;
}

export function tcTree(all: Comment[]) {
  const ids = new Set(all.map((c) => c.id));
  const kids: Record<string, Comment[]> = {};
  all.forEach((c) => {
    if (c.parentId && c.parentId !== c.id && ids.has(c.parentId)) (kids[c.parentId] = kids[c.parentId] || []).push(c);
  });
  return { ids, kids };
}

export function tcSort(list: Comment[], s: ThreadSort = sort): Comment[] {
  return list.sort(s === 'top' ? (a, b) => (b.bolts || 0) - (a.bolts || 0) || (b.time || 0) - (a.time || 0) : (a, b) => (b.time || 0) - (a.time || 0));
}

/** Local bump for a thread's comment list (bolts, local replies). */
const localSubs = new Map<string, Set<() => void>>();
export function bumpThread(postId: string): void {
  localSubs.get(postId)?.forEach((f) => f());
  touchPost(postId);
}

/** Re-render on remote replies landing, local writes and bolt toggles for this post. */
export function useThreadVersion(postId: string): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const f = () => setN((x) => x + 1);
    let s = localSubs.get(postId);
    if (!s) localSubs.set(postId, (s = new Set()));
    s.add(f);
    const off = onRepliesChanged((id) => {
      if (id === postId) f();
    });
    return () => {
      s!.delete(f);
      off();
    };
  }, [postId]);
  return n;
}

export function getThreadComments(postId: string): Comment[] {
  try {
    return threadComments(postId);
  } catch {
    return [];
  }
}

export function toggleCommentBolt(postId: string, cid: string): void {
  boltComment(postId, cid, () => voidToast('SIGNAL LOST · RETRY'));
  bumpThread(postId);
}

/** The viewer's display name for a local comment (web USER.name). */
export function viewerName(authName?: string | null): string {
  if (authName) return authName;
  try {
    return loadUser().name || 'anon';
  } catch {
    return 'anon';
  }
}

/**
 * submitComment / submitReply behind the terms gate. Returns via `done(id)` once the
 * reply is stored (optimistic); VoidAPI.reply runs inside core addReply.
 */
export function postReply(postId: string, author: string, text: string, parentId: string | null, done: (id: string) => void): void {
  const t = text.trim();
  if (!t) return;
  requireTerms(() => {
    const id = addReply(postId, author, t, parentId, null, () => voidToast('SIGNAL LOST · RETRY'));
    try {
      const u = loadUser();
      u.posts = (u.posts || 0) + 1;
      saveUser(u);
    } catch {}
    bumpThread(postId);
    done(id);
  });
}
