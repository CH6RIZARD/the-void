// The call state machine and the thread row text, driven by hand - no network,
// no native module. Ring timeouts run on node:test's mock clock.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  RING_TIMEOUT_MS,
  callElapsed,
  callEnded,
  callLive,
  callPatch,
  callReset,
  callRingIn,
  callRingOut,
  getCallSnapshot,
  setRingTimeoutHandler,
} from '../callStore.ts';
import { callRowLabel, fmtDuration, mergeThread, sameCalls, type CallRow } from '../callText.ts';

const ME = 'me-uuid';
const THEM = 'them-uuid';
const PEER = { id: THEM, handle: 'ada', name: 'Ada' };
function row(over: Partial<CallRow> = {}): CallRow {
  return {
    id: 'call-1', conversation_id: 'conv-1', caller_id: ME, callee_id: THEM, kind: 'audio', status: 'ringing',
    created_at: '2026-10-08T10:00:00.000Z', answered_at: null, ended_at: null, ...over,
  };
}

test('ring-out -> live -> ended keeps the row and reports the clock', () => {
  callReset();
  callRingOut(row(), PEER);
  assert.equal(getCallSnapshot().phase, 'ringing-out');
  assert.equal(getCallSnapshot().peer?.name, 'Ada');
  callLive(1_000_000);
  assert.equal(getCallSnapshot().phase, 'live');
  assert.equal(callElapsed(1_252_000), 252);
  callLive(5); // a second "live" (realtime UPDATE after ParticipantConnected) must not reset the clock
  assert.equal(getCallSnapshot().liveAt, 1_000_000);
  callPatch({ id: 'call-1', status: 'accepted', answered_at: '2026-10-08T10:00:05.000Z' });
  assert.equal(getCallSnapshot().call?.status, 'accepted');
  callEnded('hangup');
  assert.equal(getCallSnapshot().phase, 'ended');
  assert.equal(getCallSnapshot().reason, 'hangup');
  assert.equal(getCallSnapshot().call?.id, 'call-1', 'the screen still needs the row to say what ended');
  callEnded('remote'); // already ended: no second reason
  assert.equal(getCallSnapshot().reason, 'hangup');
  callReset();
  assert.equal(getCallSnapshot().phase, 'idle');
});

test('ring-in times out to missed at 45s and tells the handler which side rang', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    callReset();
    const seen: string[] = [];
    setRingTimeoutHandler((c, phase) => seen.push(c.id + ':' + phase));
    assert.equal(callRingIn(row({ caller_id: THEM, callee_id: ME }), PEER), true);
    assert.equal(getCallSnapshot().phase, 'ringing-in');
    mock.timers.tick(RING_TIMEOUT_MS - 1);
    assert.equal(getCallSnapshot().phase, 'ringing-in');
    mock.timers.tick(1);
    assert.equal(getCallSnapshot().phase, 'ended');
    assert.equal(getCallSnapshot().reason, 'missed');
    assert.deepEqual(seen, ['call-1:ringing-in']);
  } finally {
    setRingTimeoutHandler(null);
    mock.timers.reset();
    callReset();
  }
});

test('an answer disarms the ring timer; a second ring while busy is refused', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    callReset();
    let fired = 0;
    setRingTimeoutHandler(() => { fired++; });
    callRingOut(row(), PEER);
    mock.timers.tick(10_000);
    callLive();
    mock.timers.tick(RING_TIMEOUT_MS);
    assert.equal(fired, 0);
    assert.equal(getCallSnapshot().phase, 'live');
    assert.equal(callRingIn(row({ id: 'call-2', caller_id: THEM, callee_id: ME }), PEER), false);
    assert.equal(getCallSnapshot().call?.id, 'call-1');
  } finally {
    setRingTimeoutHandler(null);
    mock.timers.reset();
    callReset();
  }
});

test('thread row text', () => {
  assert.equal(fmtDuration(252), '4:12');
  assert.equal(fmtDuration(7), '0:07');
  assert.equal(fmtDuration(3750), '1:02:30');
  const done = row({ status: 'ended', answered_at: '2026-10-08T10:00:10.000Z', ended_at: '2026-10-08T10:04:22.000Z' });
  assert.equal(callRowLabel(done, ME), 'Voice call · 4:12');
  assert.equal(callRowLabel(row({ kind: 'video', status: 'missed' }), THEM), 'Missed video call');
  assert.equal(callRowLabel(row({ kind: 'video', status: 'missed' }), ME), 'No answer · video call');
  assert.equal(callRowLabel(row({ status: 'declined' }), ME), 'Declined voice call');
  assert.equal(callRowLabel(row({ status: 'ended' }), ME), 'Voice call · cancelled');
});

test('mergeThread interleaves by time and keeps input order on ties', () => {
  const msgs = [
    { id: 'm1', created_at: '2026-10-08T09:00:00.000Z' },
    { id: 'm2', created_at: '2026-10-08T11:00:00.000Z' },
    { id: 'pending', created_at: '2026-10-08T11:00:00.000Z' },
  ];
  const calls = [row({ created_at: '2026-10-08T10:00:00.000Z' })];
  const ids = mergeThread(msgs, calls).map((x) => (x.t === 'msg' ? x.m.id : 'call:' + x.c.id));
  assert.deepEqual(ids, ['m1', 'call:call-1', 'm2', 'pending']);
  assert.equal(sameCalls(calls, [row()]), true);
  assert.equal(sameCalls(calls, [row({ status: 'ended' })]), false);
});
