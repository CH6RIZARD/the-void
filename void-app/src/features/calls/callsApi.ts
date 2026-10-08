// Calls over Supabase: the `calls` row is the ring (migration 009), LiveKit is
// the media. This file does every network side effect for a call and drives
// callStore; CallScreen and IncomingCallSheet only read the store.
//
//   start   -> INSERT calls (status ringing)       -> callRingOut
//   ring    <- Realtime INSERT on callee_id = me   -> callRingIn
//   accept  -> PATCH status accepted, answered_at  -> live once the room has both of us
//   decline -> PATCH status declined
//   hang up -> PATCH status ended, ended_at
//   45s     -> the CALLER patches status missed (the callee just drops the sheet)
//
// Realtime is the ring. The one supabase-js client (src/lib/supabase) forwards the
// session JWT, and the calls select policy + the callee_id filter scope the channel
// to my rows. If the socket never subscribes (captive wifi, a project without
// Realtime enabled for `calls`), a 3s REST poll of my ringing rows stands in - a
// documented fallback, not the design. Multi-device ring and CallKit/PushKit wake
// are follow-ups: this rings a foregrounded app only.
import { AppState } from 'react-native';
import { VoidAPI } from '../../core';
import { LIVEKIT_URL } from '../../lib/config';
import { supabase } from '../../lib/supabase';
import { dmIsBlocked, dmMe, getDmSnapshot, loadConversations } from '../messages/dmStore';
import type { CallKind, CallRow } from './callText';
import {
  callEnded,
  callLive,
  callPatch,
  callReset,
  callRingIn,
  callRingOut,
  getCallSnapshot,
  setRingTimeoutHandler,
  type CallEndReason,
  type CallPeer,
} from './callStore';

const CALL_COLS = 'id,conversation_id,caller_id,callee_id,kind,status,created_at,answered_at,ended_at';
/** A ringing row older than this is a ring we missed while the app was closed, not a live one. */
const STALE_RING_MS = 45_000;

// ─── token ───────────────────────────────────────────────────────────────
export interface CallToken { token: string; url: string }
/**
 * livekit-token Edge Function: mints a room JWT for `dm_<conversation_id>` after
 * checking conversation_members server-side. Returns the server url too, so the
 * app needs no build-time LIVEKIT_URL; app.json extra.livekitUrl is the fallback.
 */
export async function fetchCallToken(conversationId: string): Promise<CallToken> {
  const data = await VoidAPI._sb('/functions/v1/livekit-token', 'POST', { conversation_id: conversationId });
  const token = data && (data.token as string);
  const url = ((data && data.url) || LIVEKIT_URL) as string;
  if (!token) throw new Error('NO CALL TOKEN');
  if (!url) throw new Error('CALL SERVER NOT CONFIGURED');
  return { token, url };
}

// ─── rows ────────────────────────────────────────────────────────────────
async function patchCall(id: string, patch: Partial<Pick<CallRow, 'status' | 'answered_at' | 'ended_at'>>): Promise<void> {
  await VoidAPI._sb('/rest/v1/calls?id=eq.' + encodeURIComponent(id), 'PATCH', patch, { Prefer: 'return=minimal' });
}

/** Every call in one thread, oldest first; [] when the table is not there yet. */
export async function loadConvCalls(conversationId: string): Promise<CallRow[]> {
  try {
    const rows = await VoidAPI._sb('/rest/v1/calls?conversation_id=eq.' + encodeURIComponent(conversationId) + '&select=' + CALL_COLS + '&order=created_at.asc&limit=200', 'GET');
    return (rows as CallRow[]) || [];
  } catch {
    return [];
  }
}

async function peerFor(conversationId: string, otherId: string): Promise<CallPeer> {
  let c = getDmSnapshot().convs.find((x) => x.id === conversationId);
  if (!c) {
    await loadConversations().catch(() => {});
    c = getDmSnapshot().convs.find((x) => x.id === conversationId);
  }
  return c ? c.other : { id: otherId, handle: 'void', name: 'void' };
}

// ─── outgoing ────────────────────────────────────────────────────────────
/** Dial. Returns '' and moves the store to ringing-out, else the toast text. */
export async function startCall(conversationId: string, kind: CallKind): Promise<string> {
  const me = dmMe();
  if (!me || !VoidAPI._sbReady()) return 'SIGN IN TO CALL';
  const phase = getCallSnapshot().phase;
  if (phase !== 'idle' && phase !== 'ended') return 'ALREADY ON A CALL';
  const conv = getDmSnapshot().convs.find((x) => x.id === conversationId);
  if (!conv) return 'CONVERSATION NOT FOUND';
  if (dmIsBlocked(conv.other.id, conv.other.handle)) return 'YOU BLOCKED THIS ACCOUNT';
  // Only the columns 009 grants INSERT on: id and status come back from the
  // defaults via return=representation. Sending them is a 42501.
  const draft = { conversation_id: conversationId, caller_id: me, callee_id: conv.other.id, kind };
  let row: CallRow;
  try {
    const rows = await VoidAPI._sb('/rest/v1/calls', 'POST', [draft], { Prefer: 'return=representation' });
    row = rows && rows[0];
    if (!row) throw new Error('NO ROW');
  } catch (e: any) {
    const m = String(e && e.message);
    return /dm_blocked|row-level|policy|42501/i.test(m) ? "CAN'T CALL THIS ACCOUNT" : /calls|PGRST205|42P01|schema cache|does not exist|404/i.test(m) ? 'CALLS NOT AVAILABLE YET' : 'COULD NOT START CALL';
  }
  callRingOut(row, conv.other);
  watchActiveCall();
  return '';
}

// ─── incoming ────────────────────────────────────────────────────────────
export async function acceptCall(): Promise<string> {
  const s = getCallSnapshot();
  if (s.phase !== 'ringing-in' || !s.call) return 'NO CALL';
  const answered_at = new Date().toISOString();
  const me = dmMe() || '';
  try {
    // Only a row still ringing can be answered: if the caller cancelled in the
    // same instant, the filter matches nothing and we get [] back instead of
    // going live into an empty room. Then the row's real state wins.
    const rows = await VoidAPI._sb('/rest/v1/calls?id=eq.' + encodeURIComponent(s.call.id) + '&status=eq.ringing', 'PATCH', { status: 'accepted', answered_at }, { Prefer: 'return=representation' });
    if (!rows || !rows[0]) {
      const cur = await VoidAPI._sb('/rest/v1/calls?id=eq.' + encodeURIComponent(s.call.id) + '&select=' + CALL_COLS, 'GET');
      if (cur && cur[0]) await applyRow(cur[0], me);
      else callReset();
      return 'CALL ENDED';
    }
  } catch {
    return 'COULD NOT ANSWER';
  }
  callPatch({ id: s.call.id, status: 'accepted', answered_at });
  // Live from the answer on both ends: the caller reads the same answered_at
  // off the UPDATE, so the two clocks agree to the second.
  callLive(Date.parse(answered_at));
  watchActiveCall();
  return '';
}

export async function declineCall(): Promise<void> {
  const s = getCallSnapshot();
  if (s.phase !== 'ringing-in' || !s.call) return;
  const id = s.call.id;
  callReset();
  patchCall(id, { status: 'declined', ended_at: new Date().toISOString() }).catch(() => {});
}

/**
 * Hang up from either side, at any phase. The screen reads `ended` and closes itself.
 * `reason` is what the screen shows; the row is `ended` whichever way we got here
 * (a failed join must still stop the other phone ringing).
 */
export async function hangUp(reason: CallEndReason = 'hangup'): Promise<void> {
  const s = getCallSnapshot();
  if (!s.call || s.phase === 'idle' || s.phase === 'ended') return;
  const id = s.call.id;
  callEnded(reason);
  patchCall(id, { status: 'ended', ended_at: new Date().toISOString() }).catch(() => {});
}

// ─── server rows -> store ────────────────────────────────────────────────
/** One place for "a calls row changed": Realtime and the poll both land here. */
async function applyRow(row: CallRow, me: string) {
  const s = getCallSnapshot();
  const active = s.call && s.call.id === row.id;
  if (!active) {
    // Someone is ringing me. Older than the ring window = a miss from a closed app.
    if (row.callee_id !== me || row.status !== 'ringing') return;
    if (Date.now() - Date.parse(row.created_at) > STALE_RING_MS) return;
    const peer = await peerFor(row.conversation_id, row.caller_id);
    if (dmIsBlocked(peer.id, peer.handle)) return;
    if (!callRingIn(row, peer)) {
      // Busy: say so now instead of leaving the caller to ring out for 45s.
      patchCall(row.id, { status: 'declined', ended_at: new Date().toISOString() }).catch(() => {});
      return;
    }
    watchActiveCall();
    return;
  }
  callPatch(row);
  switch (row.status) {
    case 'accepted':
      // The other side answered. The clock starts from their answer, not from
      // the moment this update reached us.
      callLive(row.answered_at ? Date.parse(row.answered_at) : Date.now());
      break;
    case 'declined':
      callEnded('declined');
      break;
    case 'missed':
      if (s.phase === 'ringing-in') callReset();
      else callEnded('missed');
      break;
    case 'ended':
      if (s.phase === 'ringing-in') callReset();
      else callEnded('remote');
      break;
  }
}

// The 45s ring timer fired (callStore). The caller owns the row's final state;
// the callee just drops the sheet. A caller whose app died mid-ring leaves a row
// at `ringing` forever - a server-side sweep is a follow-up.
setRingTimeoutHandler((call, phase) => {
  if (phase === 'ringing-out') patchCall(call.id, { status: 'missed', ended_at: new Date().toISOString() }).catch(() => {});
  else callReset();
});

// ─── active-call poll ────────────────────────────────────────────────────
// While a call is ringing or live, re-read its row every 3s. Realtime normally
// delivers the same change first; this catches the cases where it did not
// (socket dropped mid-call, Realtime not enabled for the table).
let activeTimer: ReturnType<typeof setInterval> | null = null;
function watchActiveCall() {
  if (activeTimer) return;
  activeTimer = setInterval(async () => {
    const s = getCallSnapshot();
    const me = dmMe();
    if (!s.call || s.phase === 'idle' || s.phase === 'ended' || !me) {
      if (activeTimer) clearInterval(activeTimer);
      activeTimer = null;
      return;
    }
    if (AppState.currentState !== 'active') return;
    try {
      const rows = await VoidAPI._sb('/rest/v1/calls?id=eq.' + encodeURIComponent(s.call.id) + '&select=' + CALL_COLS, 'GET');
      const row = rows && rows[0];
      if (row && row.status !== getCallSnapshot().call?.status) await applyRow(row, me);
    } catch {}
  }, 3000);
}

// ─── the ring ────────────────────────────────────────────────────────────
/**
 * Listen for calls to me. Returns the stop function. One subscription per signed-in
 * user: IncomingCallHost (app/_layout.tsx) owns it.
 */
export function subscribeIncomingCalls(me: string): () => void {
  let stopped = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let subscribed = false;

  const onRow = (row: CallRow) => {
    if (!stopped) applyRow(row, me).catch(() => {});
  };

  // Fallback: my newest ringing row, every 3s, only while the socket is not live.
  const poll = async () => {
    if (stopped || subscribed || AppState.currentState !== 'active') return;
    try {
      const since = new Date(Date.now() - STALE_RING_MS).toISOString();
      const rows = await VoidAPI._sb('/rest/v1/calls?callee_id=eq.' + me + '&status=eq.ringing&created_at=gt.' + encodeURIComponent(since) + '&select=' + CALL_COLS + '&order=created_at.desc&limit=1', 'GET');
      if (rows && rows[0]) onRow(rows[0]);
    } catch {}
  };
  const startPoll = () => {
    if (!pollTimer) pollTimer = setInterval(poll, 3000);
  };
  const stopPoll = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  const channel = supabase
    .channel('calls:' + me)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: 'callee_id=eq.' + me }, (p) => onRow(p.new as CallRow))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: 'callee_id=eq.' + me }, (p) => onRow(p.new as CallRow))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: 'caller_id=eq.' + me }, (p) => onRow(p.new as CallRow))
    .subscribe((status) => {
      subscribed = status === 'SUBSCRIBED';
      if (subscribed) stopPoll();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') startPoll();
    });

  return () => {
    stopped = true;
    stopPoll();
    supabase.removeChannel(channel).catch(() => {});
  };
}
