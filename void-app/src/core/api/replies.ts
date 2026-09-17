// Reply threading: local optimistic comments + remote replies from Void (Supabase),
// Bluesky (getPostThread), and the fediverse (Mastodon context, Lemmy comment list,
// PeerTube comment threads). The thread count everywhere = what is renderable.
import { env } from '../env.ts';
import type { Comment, Post } from '../types.ts';
import { allPosts, findPost } from '../feed/store.ts';
import { htmlText, fediHost, nfFetchJson } from '../util.ts';
import { filterComments } from './moderation.ts';
import { VoidAPI } from './voidApi.ts';

export const _remoteReplies: Record<string, Comment[]> = {};   // postId -> comments
const _remoteLoading: Record<string, number> = {};
type Listener = (postId: string) => void;
const _listeners = new Set<Listener>();
/** Fires when a post's remote replies (and so its count) changed — re-render that thread. */
export function onRepliesChanged(fn: Listener): () => void { _listeners.add(fn); return () => { _listeners.delete(fn); }; }
function changed(postId: string) { syncReplyCount(postId); for (const l of _listeners) { try { l(postId); } catch { /* */ } } }
export function repliesLoading(postId: string): boolean { return !!_remoteLoading[postId]; }

export function bskyReplyToComment(node: any, parentId: string | null): Comment | null {
  const p = (node && node.post) || {}, rec = p.record || {}, au = p.author || {};
  if (!rec.text) return null;
  return {
    id: 'r_' + (p.cid || p.uri || env.random()), author: au.displayName || au.handle || 'bluesky', handle: '@' + (au.handle || 'bsky'),
    text: rec.text, time: rec.createdAt ? Date.parse(rec.createdAt) : env.now(), bolts: p.likeCount || 0,
    parentId: parentId || null, remote: true,                  // cannot be edited or posted back to
  };
}

export const FEDI_REPLY_SOURCES: Record<string, 1> = { mastodon: 1, lemmy: 1, peertube: 1 };

/** Load remote replies for a post: Void UUID -> Supabase; fedi -> instances; else Bluesky thread. */
export async function loadRemoteReplies(postId: string): Promise<void> {
  const p = findPost(postId);
  if (!p || _remoteLoading[postId]) return;
  if (VoidAPI._uuid(postId)) return loadVoidReplies(postId);
  if (FEDI_REPLY_SOURCES[p.source]) return loadFediReplies(p);
  if (!p._uri || _remoteReplies[postId]) return;
  _remoteLoading[postId] = 1;
  try {
    const u = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?depth=2&parentHeight=0&uri=' + encodeURIComponent(p._uri);
    const r = await env.fetch(u, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('thread ' + r.status);
    const d = await r.json();
    const out: Comment[] = [];
    const walk = (node: any, parentId: string | null) => {
      for (const child of (node && node.replies) || []) {
        const c = bskyReplyToComment(child, parentId);
        if (!c) continue;
        out.push(c);
        walk(child, c.id);                      // one more level -> nested replies
      }
    };
    walk(d.thread, null);
    _remoteReplies[postId] = out;
  } catch {
    _remoteReplies[postId] = [];                // don't retry in a loop; the honest count is what is renderable
  } finally { delete _remoteLoading[postId]; changed(postId); }
}

// Two places can answer a fedi post: the instance the feed pulled it from (local id
// on the post) and its HOME instance (id parsed off its URL). Both are asked at once.
export function fediReplyTargets(p: Partial<Post>): Array<{ u: string; kind: 'masto' | 'lemmy' | 'peertube' }> {
  const out: Array<{ u: string; kind: 'masto' | 'lemmy' | 'peertube' }> = [];
  const add = (u: string, kind: 'masto' | 'lemmy' | 'peertube') => { if (u && !out.some(t => t.u === u)) out.push({ u, kind }); };
  let home: { host: string; pathname: string } | null = null;
  try { const m = /^https?:\/\/([^\/?#]+)([^?#]*)/i.exec(String(p._url || p.sourceUrl || '')); if (m) home = { host: m[1].toLowerCase(), pathname: m[2] || '/' }; } catch { /* */ }
  if (p.source === 'mastodon') {
    if (p._mastoId) add(`https://${p._mastoHost || 'mastodon.social'}/api/v1/statuses/${encodeURIComponent(p._mastoId)}/context`, 'masto');
    const m = home && home.pathname.match(/^\/(?:@[^/]+|users\/[^/]+\/statuses)\/(\d+)\/?$/);
    if (m) add(`https://${home!.host}/api/v1/statuses/${m[1]}/context`, 'masto');
  } else if (p.source === 'lemmy') {
    const q = '&sort=Top&limit=50&max_depth=3&type_=All';
    if (p._lemmyId) add(`https://${p._lemmyHost || 'lemmy.world'}/api/v3/comment/list?post_id=${encodeURIComponent(p._lemmyId)}${q}`, 'lemmy');
    const m = home && home.pathname.match(/^\/post\/(\d+)\/?$/);
    if (m) add(`https://${home!.host}/api/v3/comment/list?post_id=${m[1]}${q}`, 'lemmy');
  } else if (p.source === 'peertube') {
    const m = home && home.pathname.match(/\/(?:videos\/watch|w)\/([0-9a-f-]{8,}|[A-Za-z0-9]{16,24})\/?$/);
    const id = (m && m[1]) || String(p.id || '').replace(/^pt_(?:[^:]+:)?/, '');
    if (home && id) add(`https://${home.host}/api/v1/videos/${encodeURIComponent(id)}/comment-threads?count=25&sort=-createdAt`, 'peertube');
  }
  return out;
}

// PeerTube lists top-level threads flat; each thread's replies are a second call. The
// five busiest threads are expanded (instances rate-limit to ~50 calls/10s).
export async function peertubeThreadsToComments(d: any, u: string): Promise<Comment[]> {
  const base = u.replace(/\?.*$/, ''), out: Comment[] = [];
  const one = (cm: any, parentId: string | null): Comment | null => {
    if (!cm || cm.isDeleted || cm.deletedAt || !cm.account) return null;
    const text = /<[a-z][^>]*>/i.test(cm.text || '') ? htmlText(cm.text) : String(cm.text || '').trim();
    if (!text) return null;
    const a = cm.account;
    return {
      id: 'ptc_' + cm.id, author: a.displayName || a.name || 'peertube', handle: '@' + (a.name || 'peertube') + (a.host ? '@' + a.host : ''),
      text, time: Date.parse(cm.createdAt) || env.now(), bolts: 0, parentId: parentId || null, remote: true,
    };
  };
  const tops = (d && d.data) || [];
  tops.forEach((cm: any) => { const c = one(cm, null); if (c) out.push(c); });
  const busy = tops.filter((cm: any) => (cm.totalReplies || 0) > 0).sort((a: any, b: any) => b.totalReplies - a.totalReplies).slice(0, 5);
  await Promise.all(busy.map(async (cm: any) => {
    const t = await nfFetchJson(`${base}/${cm.id}`, 7000); if (!t) return;
    const walk = (nodes: any[], parentId: string, depth: number) => { for (const n of nodes || []) { const c = one(n.comment, parentId); if (!c) continue; out.push(c); if (depth < 3) walk(n.children, c.id, depth + 1); } };
    walk(t.children, 'ptc_' + cm.id, 1);
  }));
  return out;
}
export function mastoContextToComments(d: any): Comment[] {
  const list = (d && d.descendants) || [], ids = new Set(list.map((s: any) => String(s.id)));
  return list.map((s: any) => {
    if (!s || s.visibility === 'direct') return null;
    // Replies open with the @mentions Mastodon threads automatically; drop the lead run.
    const text = htmlText(s.content || '').replace(/^(?:\s*@[\w.\-]+(?:@[\w.\-]+)?)+\s*/, '').trim();
    const img = ((s.media_attachments || []).find((m: any) => m.type === 'image') || {});
    if (!text && !img.url) return null;
    const a = s.account || {};
    return {
      id: 'mc_' + s.id, author: a.display_name || a.username || 'mastodon', handle: '@' + (a.acct || a.username || 'mastodon'),
      text: s.spoiler_text ? `${s.spoiler_text}\n\n${text}` : text, img: img.preview_url || img.url || '',
      time: Date.parse(s.created_at) || env.now(), bolts: s.favourites_count || 0,
      parentId: s.in_reply_to_id && ids.has(String(s.in_reply_to_id)) ? 'mc_' + s.in_reply_to_id : null, remote: true,
    };
  }).filter(Boolean);
}
export function lemmyCommentsToComments(d: any): Comment[] {
  const md = (t: unknown) => String(t || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^>\s?/gm, '').replace(/[*_`~]{1,3}/g, '').trim();
  return ((d && d.comments) || []).map((v: any) => {
    const cm = (v && v.comment) || {}, cr = (v && v.creator) || {}, k = (v && v.counts) || {};
    if (cm.removed || cm.deleted) return null;
    const text = md(cm.content); if (!text) return null;
    const path = String(cm.path || '').split('.');
    const pub = String(cm.published || '');
    return {
      id: 'lc_' + cm.id, author: cr.display_name || cr.name || 'lemmy', handle: '@' + (cr.name || 'lemmy') + (fediHost(cr.actor_id) ? '@' + fediHost(cr.actor_id) : ''),
      text, time: Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(pub) ? pub : pub + 'Z') || env.now(), bolts: k.score || k.upvotes || 0,
      parentId: path.length > 2 ? 'lc_' + path[path.length - 2] : null, remote: true,
    };
  }).filter(Boolean);
}

const _fediFailAt: Record<string, number> = {}, _fediInflight: Record<string, number> = {};
/**
 * Ask every target at once; whichever lands first renders, and a later FULLER answer
 * replaces it only while no reply overlay is open on it (`overlayOpen`). Cached per
 * post. A dead instance is not re-asked for 30s.
 */
export function loadFediReplies(p: Post, overlayOpen: (postId: string) => boolean = () => false): Promise<void> | undefined {
  const postId = p.id;
  if (_remoteLoading[postId] || _fediInflight[postId] || _remoteReplies[postId]) return;
  if (_fediFailAt[postId] && env.now() - _fediFailAt[postId] < 30000) return;
  const targets = fediReplyTargets(p);
  if (!targets.length) { _remoteReplies[postId] = []; return; }
  _fediInflight[postId] = 1;
  // A post the source says has no replies opens on "BE FIRST" at once; the check
  // still runs quietly and deals in anything federation had not counted yet.
  if ((p.replies || 0) > 0) _remoteLoading[postId] = 1;
  let best: Comment[] | null = null;
  const land = (list: Comment[] | null) => {
    if (!list) return;
    const cur = _remoteReplies[postId];
    if (cur && (list.length <= cur.length || overlayOpen(postId))) return;
    _remoteReplies[postId] = list; best = list;
    changed(postId);
  };
  return Promise.all(targets.map(t => nfFetchJson(t.u, 8000)
    .then(d => d ? (t.kind === 'masto' ? mastoContextToComments(d) : t.kind === 'peertube' ? peertubeThreadsToComments(d, t.u) : lemmyCommentsToComments(d)) : null)
    .catch(() => null).then(land)))
    .then(() => { /* */ })
    .finally(() => {
      delete _remoteLoading[postId]; delete _fediInflight[postId];
      // Every instance failed: no cache (next open asks again), upstream count left alone.
      if (!best) _fediFailAt[postId] = env.now(); else delete _fediFailAt[postId];
      for (const l of _listeners) { try { l(postId); } catch { /* */ } }
    });
}

export async function loadVoidReplies(postId: string): Promise<void> {
  if (_remoteLoading[postId] || _remoteReplies[postId]) return;
  _remoteLoading[postId] = 1;
  try {
    const res = await VoidAPI.replies(postId);
    if (res && res.local) { syncReplyCount(postId); return; }
    const items = (res && res.items) || [];
    const toC = (row: any, parentId: string | null): Comment => {
      const prof = row.profiles || {};
      return {
        id: row.id, author: prof.display_name || prof.handle || 'void',
        handle: prof.handle ? ('@' + String(prof.handle).replace(/^@/, '')) : '@void',
        text: row.body || '', time: row.created_at ? Date.parse(row.created_at) : env.now(),
        bolts: row.rank_score || 0, parentId: parentId || null, authorId: row.author_id || null, remote: true,
      };
    };
    _remoteReplies[postId] = items.map((row: any) => toC(row, null));
    changed(postId);
    // Nested replies (reply_to = parentId) are not returned by replies(); walk 3 levels.
    if (!VoidAPI.base && VoidAPI._sbReady()) {
      try {
        let frontier = _remoteReplies[postId].map(c => c.id).filter(id => VoidAPI._uuid(id));
        for (let depth = 0; depth < 3 && frontier.length; depth++) {
          const rows = await VoidAPI._sb('/rest/v1/posts?reply_to=in.(' + frontier.slice(0, 100).join(',') + ')&select=id,reply_to,author_id,body,rank_score,created_at,profiles:author_id(handle,display_name)&order=created_at.asc&limit=200', 'GET');
          const add = (rows || []).map((row: any) => toC(row, row.reply_to));
          if (!add.length) break;
          _remoteReplies[postId] = _remoteReplies[postId].concat(add);
          frontier = add.map((c: Comment) => c.id);
        }
        if (_remoteReplies[postId].length > items.length) changed(postId);
      } catch { /* */ }
    }
  } catch {
    if (!_remoteReplies[postId]) _remoteReplies[postId] = [];
    syncReplyCount(postId);
  } finally { delete _remoteLoading[postId]; }
}

// ─── LOCAL COMMENTS + BOLT OVERLAY ───────────────────────────────────────
export function localComments(postId: string): Comment[] {
  let raw: any[] = [];
  try { raw = JSON.parse(env.storage.getItem('vc_' + postId) || '[]'); } catch { raw = []; }
  return raw.map((c, i) => ({ ...c, id: c.id || ('c' + i + '_' + (c.time || 0)), bolts: c.bolts || 0 }));
}
export function saveThreadComments(postId: string, list: Comment[]): void { try { env.storage.setItem('vc_' + postId, JSON.stringify(list)); } catch { /* */ } }
// Bolt state for REMOTE replies has nowhere local to live: an overlay keyed by comment id.
export function boltOverlay(postId: string): Record<string, number | boolean> { try { return JSON.parse(env.storage.getItem('vcb_' + postId) || '{}') || {}; } catch { return {}; } }
export function saveBoltOverlay(postId: string, o: Record<string, number | boolean>): void { try { env.storage.setItem('vcb_' + postId, JSON.stringify(o)); } catch { /* */ } }

/**
 * Every comment for a thread: remote (with local bolt overlay) + local. A reply
 * written here is kept locally and, once VoidAPI.reply lands, stamped with the
 * server id (remoteId); the fetched copy is then dropped and its children
 * re-pointed at the local card. Moderation-filtered (blocked authors / reported).
 */
export function threadComments(postId: string): Comment[] {
  const ov = boltOverlay(postId);
  const local = localComments(postId);
  const r2l: Record<string, string> = {}; local.forEach(c => { if (c.remoteId) r2l[c.remoteId] = c.id; });
  const remote = (_remoteReplies[postId] || []).filter(c => !r2l[c.id]).map(c => ({
    ...c, parentId: (c.parentId && r2l[c.parentId]) || c.parentId, mine: !!ov[c.id], bolts: (c.bolts || 0) + (ov[c.id] ? 1 : 0),
  }));
  return filterComments((remote as Comment[]).concat(local), findPost(postId));
}
/** One number, everywhere: post.replies = renderable comments. Returns it. */
export function syncReplyCount(postId: string): number {
  const p = allPosts.find(x => x.id === postId); if (!p) return 0;
  const n = threadComments(postId).length;
  p.replies = n;
  return n;
}

/** Toggle a bolt on a comment (remote -> overlay, local -> the stored copy). Returns the new state. */
export function boltComment(postId: string, cid: string, onError?: () => void): boolean | undefined {
  const remote = (_remoteReplies[postId] || []).some(c => c.id === cid);
  let on: boolean;
  if (remote) {
    // Remote reply: toggle the overlay, never rewrite the fetched copy.
    const ov = boltOverlay(postId);
    on = !ov[cid];
    if (on) ov[cid] = 1; else delete ov[cid];
    saveBoltOverlay(postId, ov);
  } else {
    const list = localComments(postId); const c = list.find(x => x.id === cid); if (!c) return undefined;
    c.mine = !c.mine; c.bolts = Math.max(0, (c.bolts || 0) + (c.mine ? 1 : -1));
    on = !!c.mine;
    saveThreadComments(postId, list);
  }
  loadRemoteReplies(postId);               // real replies from the source, if any
  VoidAPI.bolt(cid, on).catch(() => onError && onError());
  return on;
}

/**
 * Optimistic reply: stored locally at once, then VoidAPI.reply; the server id is
 * stamped back as remoteId. parentId null = deck-level comment. Returns the local id.
 * (Caller bumps the profile post counter; the web did USER.posts++.)
 */
export function addReply(postId: string, author: string, text: string, parentId: string | null, img?: string | null, onError?: () => void): string {
  const comments = localComments(postId);
  const id = 'c' + env.now();
  let apiParent = parentId || null;
  if (apiParent) { const lp = comments.find(x => x.id === apiParent); if (lp && lp.remoteId) apiParent = lp.remoteId; }
  comments.push({ id, author, text, time: env.now(), img: img || null, parentId: parentId || null, bolts: 0 } as any);   // same stored shape as the web
  saveThreadComments(postId, comments);
  Promise.resolve().then(() => VoidAPI.reply(postId, text, apiParent)).then(res => {
    const rid = res && res.reply && res.reply.id; if (!rid) return;
    const l = localComments(postId), c = l.find(x => x.id === id);
    if (c) { c.remoteId = rid; saveThreadComments(postId, l); }
  }).catch(() => onError && onError());
  syncReplyCount(postId);
  return id;
}
