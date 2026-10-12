// Polls (handoff THE-VOID-22b §4): The Void's question of the moment, the archive, and
// the floor of user-suggested questions with up / down votes.
//
// Shared state lives in Supabase (migration 010: poll_questions, poll_votes,
// poll_replies, poll_reply_likes, read through the poll_board view). Writes are
// optimistic and roll back on rejection; the last pull is cached in env.storage so
// the board shows at once on the next launch. With no Supabase configured (tests,
// a bare dev build) the same store runs on the phone alone.
import { useSyncExternalStore } from 'react';
import { env, loadUser, readJSON, VoidAPI, writeJSON } from '../../core/index.ts';

export interface Topic { id: string; no: number; q: string; /** ms */ t: number; by?: string; live?: boolean }
export interface FloorQ { id: string; q: string; by: string; up: number; down: number; /** ms */ t: number; mine?: boolean }
export interface Chime { id: string; author: string; handle: string; authorId?: string | null; text: string; t: number; likes: number }

export const MINLEN = 12;
export const MAXLEN = 140;
export const GATE_SIZE = 3;

/** The Void's questions, as seeded by 010_polls.sql — shown until the first pull lands. */
const SEED_TOPICS: Topic[] = [
  { id: '00000000-0000-4000-8000-000000000003', no: 3, live: true, t: Date.UTC(2026, 9, 7, 9), q: 'Which live cam do you keep going back to, and what are you waiting to see?' },
  { id: '00000000-0000-4000-8000-000000000002', no: 2, t: Date.UTC(2026, 9, 1, 9), q: 'Does watching a place live make you care about it more, or only feel like you do?' },
  { id: '00000000-0000-4000-8000-000000000001', no: 1, t: Date.UTC(2026, 8, 24, 9), q: 'Which country’s feed surprised you most once you actually scrolled it?' },
];

interface State {
  topics: Topic[];
  floor: FloorQ[];
  /** +1 / -1 per question id; absent = no vote */
  votes: Record<string, 1 | -1>;
  /** replies per question (the server's once loaded; local-only otherwise) */
  chimes: Record<string, Chime[]>;
  /** the viewer's likes by reply id */
  likes: Record<string, true>;
  /** reply counts from the board, for questions whose replies are not loaded */
  replyN: Record<string, number>;
}
const KEY = 'void_polls_v2';
let st: State = readJSON<State>(KEY, { topics: SEED_TOPICS, floor: [], votes: {}, chimes: {}, likes: {}, replyN: {} });
if (!st.topics?.length) st.topics = SEED_TOPICS;
let seq = 0;
/** unique on this phone even within one ms (three suggestions in a burst collided) */
const uid = (prefix: string) => prefix + Date.now().toString(36) + (seq++).toString(36);
const subs = new Set<() => void>();
function commit(next: Partial<State>) {
  st = { ...st, ...next };
  writeJSON(KEY, st);
  subs.forEach((f) => f());
}
export function usePolls(): State {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => st,
    () => st,
  );
}
const me = () => {
  try {
    const u = loadUser();
    return { name: u.name || 'anon', handle: String(u.handle || '@anon').replace(/^@/, '') };
  } catch {
    return { name: 'anon', handle: 'anon' };
  }
};
/** A rejected write: roll back and say so (the toast module is UI, so it is reached lazily). */
let onFail: () => void = () => {};
export function setPollsFailHandler(f: () => void): void {
  onFail = f;
}

// ─── pull ────────────────────────────────────────────────────────────────
let pulling = false;
export async function pullPolls(): Promise<void> {
  if (pulling || !env.supabaseUrl) return;
  pulling = true;
  try {
    const [board, mine] = await Promise.all([VoidAPI.pollBoard(), VoidAPI.pollMine().catch(() => ({ votes: st.votes, likes: Object.keys(st.likes) }))]);
    const topics: Topic[] = [];
    const floor: FloorQ[] = [];
    const replyN: Record<string, number> = {};
    const my = VoidAPI._uid();
    for (const r of board) {
      replyN[r.id] = r.replies || 0;
      if (r.kind === 'void') topics.push({ id: r.id, no: r.no, q: r.body, t: Date.parse(r.created_at) });
      else floor.push({ id: r.id, q: r.body, by: r.by_handle || 'anon', up: r.up || 0, down: r.down || 0, t: Date.parse(r.created_at), mine: !!my && r.author_id === my });
    }
    topics.sort((a, b) => b.no - a.no);
    if (topics[0]) topics[0].live = true;
    // The server's counts include my vote; the UI folds mine in via tally(), so take it out.
    for (const f of floor) {
      const v = mine.votes[f.id];
      if (v === 1) f.up = Math.max(0, f.up - 1);
      if (v === -1) f.down = Math.max(0, f.down - 1);
    }
    const likes: Record<string, true> = {};
    mine.likes.forEach((id) => (likes[id] = true));
    commit({ topics: topics.length ? topics : st.topics, floor, votes: mine.votes, likes, replyN });
  } catch {
    /* offline: the cached board stands */
  } finally {
    pulling = false;
  }
}

// ─── topics ──────────────────────────────────────────────────────────────
export const topics = (): Topic[] => st.topics;
export const liveTopic = (): Topic => st.topics.find((t) => t.live) || st.topics[0];

// ─── votes ───────────────────────────────────────────────────────────────
export function voteOf(id: string): 1 | 0 | -1 {
  return st.votes[id] || 0;
}
/** Tapping the same side again clears it. */
export function vote(id: string, dir: 1 | -1): void {
  const before = st.votes;
  const votes = { ...st.votes };
  if (votes[id] === dir) delete votes[id];
  else votes[id] = dir;
  commit({ votes });
  VoidAPI.pollVote(id, votes[id] || 0).catch(() => {
    commit({ votes: before });
    onFail();
  });
}
/** Counts with the viewer's own vote folded in. */
export function tally(f: FloorQ): { up: number; down: number; pct: number } {
  const v = voteOf(f.id);
  const up = f.up + (v === 1 ? 1 : 0), down = f.down + (v === -1 ? 1 : 0);
  return { up, down, pct: up + down ? Math.round((up / (up + down)) * 100) : 0 };
}
export function rankFloor(sort: 'top' | 'new'): FloorQ[] {
  const list = st.floor.slice();
  return sort === 'new' ? list.sort((a, b) => b.t - a.t) : list.sort((a, b) => b.up - b.down - (a.up - a.down) || a.t - b.t);
}
/** The gate: the N least-voted floor questions the viewer has not voted on (and did not write), oldest first on ties. */
export function gateFor(n = GATE_SIZE): FloorQ[] {
  return st.floor
    .filter((f) => !st.votes[f.id] && !f.mine)
    .sort((a, b) => a.up + a.down - (b.up + b.down) || a.t - b.t)
    .slice(0, n);
}
export function publish(q: string): FloorQ {
  const f: FloorQ = { id: uid('m'), q: q.trim().slice(0, MAXLEN), by: me().handle, up: 0, down: 0, t: Date.now(), mine: true };
  commit({ floor: [f].concat(st.floor) });
  VoidAPI.pollSuggest(f.q)
    .then((r) => {
      if (r.id) commit({ floor: st.floor.map((x) => (x.id === f.id ? { ...x, id: r.id } : x)) });
    })
    .catch(() => {
      commit({ floor: st.floor.filter((x) => x.id !== f.id) });
      onFail();
    });
  return f;
}

// ─── chime in ────────────────────────────────────────────────────────────
const loading = new Set<string>();
export async function loadChimes(topicId: string): Promise<void> {
  if (loading.has(topicId) || !env.supabaseUrl) return;
  loading.add(topicId);
  try {
    const rows = await VoidAPI.pollReplies(topicId);
    const list: Chime[] = rows.map((r: any) => ({
      id: r.id,
      author: (r.profiles && (r.profiles.display_name || r.profiles.handle)) || 'anon',
      handle: (r.profiles && r.profiles.handle) || 'anon',
      authorId: r.author_id,
      text: r.body,
      t: Date.parse(r.created_at),
      // the server's like count includes mine; likesOf() adds mine back
      likes: Math.max(0, ((r.poll_reply_likes && r.poll_reply_likes[0] && r.poll_reply_likes[0].count) || 0) - (st.likes[r.id] ? 1 : 0)),
    }));
    commit({ chimes: { ...st.chimes, [topicId]: list }, replyN: { ...st.replyN, [topicId]: list.length } });
  } catch {
    /* keep what we have */
  } finally {
    loading.delete(topicId);
  }
}
export function chimesOf(topicId: string, sort: 'top' | 'new'): Chime[] {
  const list = (st.chimes[topicId] || []).slice();
  return sort === 'new' ? list.sort((a, b) => b.t - a.t) : list.sort((a, b) => likesOf(b) - likesOf(a) || a.t - b.t);
}
export function likesOf(c: Chime): number {
  return c.likes + (st.likes[c.id] ? 1 : 0);
}
export function liked(id: string): boolean {
  return !!st.likes[id];
}
export function toggleLike(id: string): void {
  const before = st.likes;
  const likes = { ...st.likes };
  const on = !likes[id];
  if (on) likes[id] = true;
  else delete likes[id];
  commit({ likes });
  VoidAPI.pollLike(id, on).catch(() => {
    commit({ likes: before });
    onFail();
  });
}
export function chime(topicId: string, text: string, authorId?: string | null): Chime | null {
  const t = text.trim();
  if (!t) return null;
  const u = me();
  const c: Chime = { id: uid('c'), author: u.name, handle: u.handle, authorId, text: t, t: Date.now(), likes: 0 };
  commit({ chimes: { ...st.chimes, [topicId]: (st.chimes[topicId] || []).concat(c) }, replyN: { ...st.replyN, [topicId]: (st.replyN[topicId] || 0) + 1 } });
  VoidAPI.pollReply(topicId, t)
    .then((r) => {
      if (r.id) commit({ chimes: { ...st.chimes, [topicId]: (st.chimes[topicId] || []).map((x) => (x.id === c.id ? { ...x, id: r.id } : x)) } });
    })
    .catch(() => {
      commit({ chimes: { ...st.chimes, [topicId]: (st.chimes[topicId] || []).filter((x) => x.id !== c.id) }, replyN: { ...st.replyN, [topicId]: Math.max(0, (st.replyN[topicId] || 1) - 1) } });
      onFail();
    });
  return c;
}
export function replyCount(topicId: string): number {
  const loaded = st.chimes[topicId];
  return loaded ? loaded.length : st.replyN[topicId] || 0;
}

// ─── open a topic from elsewhere (Mail) ─────────────────────────────────────
// Mail asks for a question by id; the Polls layer opens its topic page once the
// board has it (it may need the pull that opening Polls starts).
let topicReq: string | null = null;
const reqSubs = new Set<() => void>();
export function requestTopic(id: string): void {
  topicReq = id;
  reqSubs.forEach((f) => f());
}
export function takeTopicRequest(): string | null {
  return topicReq;
}
export function clearTopicRequest(): void {
  topicReq = null;
}
export function useTopicRequest(): string | null {
  return useSyncExternalStore(
    (cb) => {
      reqSubs.add(cb);
      return () => {
        reqSubs.delete(cb);
      };
    },
    () => topicReq,
    () => topicReq,
  );
}
