// Mail (notifications) — the sectioned ledger behind the mailbox (handoff THE-VOID-22b §3).
//
// Rows come from the `notifications` table (migrations 001 + 011, trigger-written).
// Shown: rank -> bolt, follow, reply, mention (a drop or a chime), chime (someone chimed
// in on your poll question), chime_bolt (a bolt on your chime), void (The Void put your
// question up). Not shown: slash (a downvote) and message (DMs have their own badge).
// Every row carries `go`, where a tap takes you: a thread (focused on the reply), a
// profile, or a Polls topic page. No row is a dead end.
// Bolts on one drop collapse into one row (`@a, @b and 213 others bolted your drop`);
// follows collapse per section. `read_at` is the persistence: opening Mail marks every
// unread row read, so the badge stays down across launches.
import { useSyncExternalStore } from 'react';
import { VoidAPI, findPost } from '../../core/index.ts';

export type NotifKind = 'bolt' | 'reply' | 'follow' | 'void' | 'mention' | 'repost' | 'chime' | 'chimeBolt';
/** where a tap on the row goes */
export type Go = { thread: string; focus?: string } | { user: string } | { topic: string };
export interface Actor { id: string; handle: string; name: string }
export interface Notif {
  id: string;
  kind: NotifKind;
  by: Actor[];
  others: number;
  /** reply / mention body */
  text?: string;
  /** the drop it happened to (reply: the parent) */
  post?: { id: string; body: string; img?: string };
  /** ms */
  time: number;
  unread: boolean;
  go?: Go;
}

type Media = Array<{ url: string; ordinal: number }>;
export interface Row {
  id: string;
  type: string;
  read_at: string | null;
  created_at: string;
  actor?: { id: string; handle: string; display_name: string | null } | null;
  post?: { id: string; body: string; reply_to: string | null; post_media?: Media; parent?: { id: string; body: string; post_media?: Media } | null } | null;
  question?: { id: string; body: string } | null;
  poll_reply?: { id: string; body: string } | null;
}

let items: Notif[] = [];
let unread = 0;
let loading = false;
let snap = { items, unread };
const subs = new Set<() => void>();
function emit() {
  snap = { items, unread };
  subs.forEach((f) => f());
}

const DAY = 86400000;
export function sectionOf(n: Notif, now = Date.now()): 'new' | 'today' | 'week' {
  return n.unread ? 'new' : now - n.time < DAY ? 'today' : 'week';
}

function actor(r: Row): Actor | null {
  const a = r.actor;
  if (!a) return null;
  const handle = String(a.handle || '').replace(/^@/, '');
  return { id: a.id, handle, name: a.display_name || handle || 'anon' };
}
const img = (m?: Media) => (m || []).slice().sort((a, b) => a.ordinal - b.ordinal).map((x) => x.url)[0];
function addActor(n: Notif, a: Actor | null) {
  if (!a || n.by.some((x) => x.id === a.id)) return;
  if (n.by.length < 3) n.by.push(a);
  else n.others++;
}

/** Group raw rows into Mail rows. Exported for the self-check. */
export function groupRows(rows: Row[], now = Date.now()): Notif[] {
  const out: Notif[] = [];
  const bolts = new Map<string, Notif>();
  const follows = new Map<string, Notif>();
  const chimeBolts = new Map<string, Notif>();
  for (const r of rows) {
    const time = Date.parse(r.created_at) || now;
    const un = !r.read_at;
    const a = actor(r);
    if (r.type === 'rank' && r.post) {
      const key = r.post.id;
      let n = bolts.get(key);
      if (!n) {
        n = { id: 'b:' + key, kind: 'bolt', by: [], others: 0, post: { id: r.post.id, body: r.post.body || '', img: img(r.post.post_media) }, time, unread: un };
        bolts.set(key, n);
        out.push(n);
      }
      if (un) n.unread = true;
      addActor(n, a);
      n.go = { thread: key };
    } else if (r.type === 'chime_bolt' && r.poll_reply && r.question) {
      const key = r.poll_reply.id;
      let n = chimeBolts.get(key);
      if (!n) {
        n = { id: 'cb:' + key, kind: 'chimeBolt', by: [], others: 0, text: r.poll_reply.body || '', post: { id: r.question.id, body: r.question.body || '' }, time, unread: un, go: { topic: r.question.id } };
        chimeBolts.set(key, n);
        out.push(n);
      }
      if (un) n.unread = true;
      addActor(n, a);
    } else if ((r.type === 'chime' || r.type === 'mention') && r.question) {
      // a chime on your question, or an @you inside someone's chime: the topic page
      out.push({ id: r.id, kind: r.type === 'chime' ? 'chime' : 'mention', by: a ? [a] : [], others: 0, text: r.poll_reply?.body || '', post: { id: r.question.id, body: r.question.body || '' }, time, unread: un, go: { topic: r.question.id } });
    } else if (r.type === 'mention' && r.post) {
      out.push({ id: r.id, kind: 'mention', by: a ? [a] : [], others: 0, text: r.post.body || '', post: { id: r.post.id, body: r.post.body || '', img: img(r.post.post_media) }, time, unread: un, go: { thread: r.post.id } });
    } else if (r.type === 'void' && r.question) {
      out.push({ id: r.id, kind: 'void', by: [], others: 0, post: { id: r.question.id, body: r.question.body || '' }, time, unread: un, go: { topic: r.question.id } });
    } else if (r.type === 'follow' && a) {
      const probe: Notif = { id: '', kind: 'follow', by: [], others: 0, time, unread: un };
      const key = sectionOf(probe, now);
      let n = follows.get(key);
      if (!n) {
        n = { ...probe, id: 'f:' + key, go: { user: a.handle } };
        follows.set(key, n);
        out.push(n);
      }
      addActor(n, a);
    } else if (r.type === 'reply' && r.post) {
      const embedded = r.post.parent;
      const local = !embedded && r.post.reply_to ? findPost(r.post.reply_to) : null;
      const parent = embedded ? { id: embedded.id, body: embedded.body || '', img: img(embedded.post_media) } : local ? { id: local.id, body: local.body || '', img: local._img } : undefined;
      // the thread of your drop, opened on this reply (the parent id is on the row even when its body is not)
      const top = parent?.id || r.post.reply_to;
      const go: Go = top ? { thread: top, focus: r.post.id } : { thread: r.post.id };
      out.push({ id: r.id, kind: 'reply', by: a ? [a] : [], others: 0, text: r.post.body || '', post: parent, time, unread: un, go });
    }
  }
  return out.sort((x, y) => y.time - x.time);
}

const BASE = 'id,type,read_at,created_at,actor:actor_id(id,handle,display_name),post:post_id(id,body,reply_to,post_media(url,ordinal),parent:reply_to(id,body,post_media(url,ordinal)))';
const POLL = ',question:question_id(id,body),poll_reply:poll_reply_id(id,body)';
const SELECT_FLAT = 'id,type,read_at,created_at,actor:actor_id(id,handle,display_name),post:post_id(id,body,reply_to,post_media(url,ordinal))';
const TYPES_ALL = 'rank,follow,reply,mention,chime,chime_bolt,void';
const TYPES_001 = 'rank,follow,reply';

export async function pullNotifs(): Promise<void> {
  if (loading || !VoidAPI._sbReady()) return;
  loading = true;
  try {
    const me = VoidAPI._uid()!;
    const q = (types: string, s: string) => '/rest/v1/notifications?user_id=eq.' + encodeURIComponent(me) + '&type=in.(' + types + ')&select=' + s + '&order=created_at.desc&limit=120';
    let rows: Row[];
    try {
      rows = await VoidAPI._sb(q(TYPES_ALL, BASE + POLL));
    } catch {
      // before migration 011 (no poll columns) / without the parent embed
      try {
        rows = await VoidAPI._sb(q(TYPES_001, BASE));
      } catch {
        rows = await VoidAPI._sb(q(TYPES_001, SELECT_FLAT));
      }
    }
    items = groupRows(Array.isArray(rows) ? rows : []);
    unread = items.filter((n) => n.unread).length;
    emit();
    seedFollowing(items);
  } catch {
    /* offline: keep what we had */
  } finally {
    loading = false;
  }
}

/** Opening Mail: everything unread is read from now on. Rows keep their NEW section until the next pull. */
export function markAllSeen(): void {
  if (!unread) return;
  unread = 0;
  emit();
  if (!VoidAPI._sbReady()) return;
  const me = VoidAPI._uid()!;
  VoidAPI._sb('/rest/v1/notifications?user_id=eq.' + encodeURIComponent(me) + '&read_at=is.null', 'PATCH', { read_at: new Date().toISOString() }, { Prefer: 'return=minimal' }).catch(() => {});
}

export function useNotifs(): { items: Notif[]; unread: number } {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => snap,
    () => snap,
  );
}

// ─── follow back ─────────────────────────────────────────────────────────
const following = new Set<string>();
const fsubs = new Set<() => void>();
/** Follow rows show Following for people you already follow, not a stale Follow back. */
async function seedFollowing(list: Notif[]): Promise<void> {
  const people = list.filter((n) => n.kind === 'follow').flatMap((n) => n.by);
  if (!people.length || !VoidAPI._sbReady()) return;
  try {
    const me = VoidAPI._uid()!;
    const ids = people.map((a) => a.id).join(',');
    const rows: Array<{ followee_id: string }> = await VoidAPI._sb('/rest/v1/follows?follower_id=eq.' + encodeURIComponent(me) + '&followee_id=in.(' + ids + ')&select=followee_id');
    const on = new Set((rows || []).map((r) => r.followee_id));
    for (const a of people) if (on.has(a.id)) following.add(a.handle);
    fsubs.forEach((f) => f());
  } catch {
    /* keep the default */
  }
}
export function toggleFollow(handle: string): void {
  const on = !following.has(handle);
  if (on) following.add(handle);
  else following.delete(handle);
  fsubs.forEach((f) => f());
  VoidAPI.follow(handle, on).catch(() => {
    if (on) following.delete(handle);
    else following.add(handle);
    fsubs.forEach((f) => f());
  });
}
export function useFollowing(handle: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      fsubs.add(cb);
      return () => {
        fsubs.delete(cb);
      };
    },
    () => following.has(handle),
    () => following.has(handle),
  );
}
