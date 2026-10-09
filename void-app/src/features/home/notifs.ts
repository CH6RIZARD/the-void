// Mail (notifications) — the sectioned ledger behind the mailbox (handoff THE-VOID-22b §3).
//
// Rows come from the `notifications` table (migration 001, trigger-written): type is
// rank | slash | follow | reply | message. rank -> bolt, reply -> reply, follow ->
// follow; slash (a downvote) and message (DMs have their own badge) are not shown.
// Bolts on one drop collapse into one row (`@a, @b and 213 others bolted your drop`);
// follows collapse per section. `read_at` is the persistence: opening Mail marks every
// unread row read, so the badge stays down across launches.
import { useSyncExternalStore } from 'react';
import { VoidAPI, findPost } from '../../core/index.ts';

export type NotifKind = 'bolt' | 'reply' | 'follow' | 'void' | 'mention' | 'repost';
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
}

type Media = Array<{ url: string; ordinal: number }>;
export interface Row {
  id: string;
  type: string;
  read_at: string | null;
  created_at: string;
  actor?: { id: string; handle: string; display_name: string | null } | null;
  post?: { id: string; body: string; reply_to: string | null; post_media?: Media; parent?: { id: string; body: string; post_media?: Media } | null } | null;
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
    } else if (r.type === 'follow' && a) {
      const probe: Notif = { id: '', kind: 'follow', by: [], others: 0, time, unread: un };
      const key = sectionOf(probe, now);
      let n = follows.get(key);
      if (!n) {
        n = { ...probe, id: 'f:' + key };
        follows.set(key, n);
        out.push(n);
      }
      addActor(n, a);
    } else if (r.type === 'reply' && r.post) {
      const embedded = r.post.parent;
      const local = !embedded && r.post.reply_to ? findPost(r.post.reply_to) : null;
      const parent = embedded ? { id: embedded.id, body: embedded.body || '', img: img(embedded.post_media) } : local ? { id: local.id, body: local.body || '', img: local._img } : undefined;
      out.push({ id: r.id, kind: 'reply', by: a ? [a] : [], others: 0, text: r.post.body || '', post: parent, time, unread: un });
    }
  }
  return out.sort((x, y) => y.time - x.time);
}

const SELECT = 'id,type,read_at,created_at,actor:actor_id(id,handle,display_name),post:post_id(id,body,reply_to,post_media(url,ordinal),parent:reply_to(id,body,post_media(url,ordinal)))';
const SELECT_FLAT = 'id,type,read_at,created_at,actor:actor_id(id,handle,display_name),post:post_id(id,body,reply_to,post_media(url,ordinal))';

export async function pullNotifs(): Promise<void> {
  if (loading || !VoidAPI._sbReady()) return;
  loading = true;
  try {
    const me = VoidAPI._uid()!;
    const q = (s: string) => '/rest/v1/notifications?user_id=eq.' + encodeURIComponent(me) + '&type=in.(rank,follow,reply)&select=' + s + '&order=created_at.desc&limit=120';
    let rows: Row[];
    try {
      rows = await VoidAPI._sb(q(SELECT));
    } catch {
      rows = await VoidAPI._sb(q(SELECT_FLAT));
    }
    items = groupRows(Array.isArray(rows) ? rows : []);
    unread = items.filter((n) => n.unread).length;
    emit();
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
