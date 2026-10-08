// Pure text + merge helpers for calls. No React, no native imports: the thread and
// the call screen both use these, and the node test runner loads them directly.

export type CallKind = 'audio' | 'video';
export type CallStatus = 'ringing' | 'accepted' | 'declined' | 'ended' | 'missed';

/** One row of public.calls (migration 009). */
export interface CallRow {
  id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string;
  kind: CallKind;
  status: CallStatus;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
}

/** 4:12, 0:07, 1:02:30 - the call timer and the thread row share one format. */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
}

/** Seconds between answer and hang-up; 0 when the call never connected. */
export function callSeconds(c: Pick<CallRow, 'answered_at' | 'ended_at'>): number {
  if (!c.answered_at || !c.ended_at) return 0;
  return Math.max(0, (Date.parse(c.ended_at) - Date.parse(c.answered_at)) / 1000);
}

/**
 * The system row in the thread: "Voice call · 4:12", "Missed video call".
 * `me` decides whose miss it was: the callee sees MISSED, the caller sees NO ANSWER.
 */
export function callRowLabel(c: CallRow, me: string | null): string {
  const kind = c.kind === 'video' ? 'Video call' : 'Voice call';
  const lower = kind.toLowerCase();
  switch (c.status) {
    case 'ringing':
      return kind + ' · ringing';
    case 'accepted':
      return kind + ' · in progress';
    case 'ended':
      return c.answered_at ? kind + ' · ' + fmtDuration(callSeconds(c)) : kind + ' · cancelled';
    case 'declined':
      return 'Declined ' + lower;
    case 'missed':
      return (c.caller_id === me ? 'No answer · ' : 'Missed ') + lower;
  }
  return kind;
}

export interface ThreadMsg { id: string; created_at: string }
export type ThreadItem<M extends ThreadMsg> = { t: 'msg'; m: M } | { t: 'call'; c: CallRow };

/**
 * Messages and call rows in one list, oldest first. The calls table is read
 * alongside messages instead of being written into it: sent messages are
 * immutable (no UPDATE policy, 007), and a call row changes when it ends.
 */
export function mergeThread<M extends ThreadMsg>(msgs: M[], calls: CallRow[]): ThreadItem<M>[] {
  const out: ThreadItem<M>[] = msgs.map((m) => ({ t: 'msg', m } as ThreadItem<M>)).concat(calls.map((c) => ({ t: 'call', c } as ThreadItem<M>)));
  const ts = (x: ThreadItem<M>) => Date.parse(x.t === 'msg' ? x.m.created_at : x.c.created_at) || 0;
  // Stable: the input order breaks ties, so a pending message stays at the bottom.
  return out.map((x, i) => [x, i] as const).sort((a, b) => ts(a[0]) - ts(b[0]) || a[1] - b[1]).map((p) => p[0]);
}

/** Two fetches of the same thread's calls: re-render only when something changed. */
export function sameCalls(a: CallRow[], b: CallRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.id !== y.id || x.status !== y.status || x.answered_at !== y.answered_at || x.ended_at !== y.ended_at) return false;
  }
  return true;
}
