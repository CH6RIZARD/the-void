// The one call the app can be in, as a tiny external store (same shape as
// reelStore / dmStore): idle | ringing-out | ringing-in | live | ended.
//
// Pure on purpose: no network, no native module. callsApi.ts drives it from
// Supabase rows and LiveKit events, and the node test drives it by hand. The
// only side effect here is the ring timer - 45s with no answer is a miss, on
// both ends, so the sheet never sits on a callee's screen forever when the
// caller's phone died mid-ring.
import { useSyncExternalStore } from 'react';
import type { CallKind, CallRow } from './callText';

export type CallPhase = 'idle' | 'ringing-out' | 'ringing-in' | 'live' | 'ended';
/** Why a call reached `ended`. 'missed' on the callee is 'no answer' on the caller. */
export type CallEndReason = 'hangup' | 'remote' | 'declined' | 'missed' | 'failed';

export interface CallPeer { id: string; handle: string; name: string }

export interface CallSnapshot {
  phase: CallPhase;
  call: CallRow | null;
  peer: CallPeer | null;
  kind: CallKind;
  /** ms epoch when the call went live; the timer counts from here. */
  liveAt: number | null;
  reason: CallEndReason | null;
  rev: number;
}

export const RING_TIMEOUT_MS = 45_000;

const IDLE: CallSnapshot = { phase: 'idle', call: null, peer: null, kind: 'audio', liveAt: null, reason: null, rev: 0 };
let snap: CallSnapshot = IDLE;
const subs = new Set<() => void>();
function emit(patch: Partial<CallSnapshot>) {
  snap = { ...snap, ...patch, rev: snap.rev + 1 };
  subs.forEach((s) => s());
}
function subscribe(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}
export function useCallStore(): CallSnapshot {
  return useSyncExternalStore(subscribe, () => snap, () => snap);
}
export function getCallSnapshot(): CallSnapshot {
  return snap;
}

// ─── ring timer ──────────────────────────────────────────────────────────
let ringTimer: ReturnType<typeof setTimeout> | null = null;
let onRingTimeout: ((call: CallRow, phase: 'ringing-out' | 'ringing-in') => void) | null = null;
/** callsApi registers the server write (status=missed) that a timed-out ring needs. */
export function setRingTimeoutHandler(fn: typeof onRingTimeout) {
  onRingTimeout = fn;
}
function armRing(call: CallRow, phase: 'ringing-out' | 'ringing-in') {
  disarmRing();
  ringTimer = setTimeout(() => {
    ringTimer = null;
    // The row may have moved on (answered, declined) while the timer was queued.
    if (snap.phase !== phase || snap.call?.id !== call.id) return;
    emit({ phase: 'ended', reason: 'missed' });
    try { onRingTimeout?.(call, phase); } catch {}
  }, RING_TIMEOUT_MS);
}
function disarmRing() {
  if (ringTimer) clearTimeout(ringTimer);
  ringTimer = null;
}

// ─── transitions ─────────────────────────────────────────────────────────
/** I dialled: the row is inserted, the other side is being rung. */
export function callRingOut(call: CallRow, peer: CallPeer) {
  emit({ phase: 'ringing-out', call, peer, kind: call.kind, liveAt: null, reason: null });
  armRing(call, 'ringing-out');
}
/** A ringing row arrived for me. Ignored when a call is already on screen (busy). */
export function callRingIn(call: CallRow, peer: CallPeer): boolean {
  if (snap.phase !== 'idle' && snap.phase !== 'ended') return false;
  emit({ phase: 'ringing-in', call, peer, kind: call.kind, liveAt: null, reason: null });
  armRing(call, 'ringing-in');
  return true;
}
/** Both sides are in the room: start the clock. Idempotent. */
export function callLive(at: number = Date.now()) {
  if (snap.phase === 'live' || snap.phase === 'idle' || snap.phase === 'ended') return;
  disarmRing();
  emit({ phase: 'live', liveAt: at });
}
/** Any way out. Keeps `call`/`peer` so the screen can show "ended · 4:12" before closing. */
export function callEnded(reason: CallEndReason) {
  if (snap.phase === 'idle' || snap.phase === 'ended') return;
  disarmRing();
  emit({ phase: 'ended', reason });
}
/** The server row changed under us: a patch for the active call only. */
export function callPatch(row: Partial<CallRow> & { id: string }) {
  if (!snap.call || snap.call.id !== row.id) return;
  emit({ call: { ...snap.call, ...row } });
}
/** Back to nothing. The call screen calls this as it leaves. */
export function callReset() {
  disarmRing();
  snap = { ...IDLE, rev: snap.rev + 1 };
  subs.forEach((s) => s());
}

/** Seconds on the clock right now (0 before live). */
export function callElapsed(now: number = Date.now()): number {
  return snap.liveAt ? Math.max(0, (now - snap.liveAt) / 1000) : 0;
}
