// The floor, driven by hand: a vote is one of {+1, 0, -1} and the same side again
// clears it; the gate hands out the least-voted unvoted questions, oldest first;
// Top ranks by net then oldest; a published question lands under Mine with 0/0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GATE_SIZE, gateFor, publish, rankFloor, tally, vote, voteOf } from '../pollsStore.ts';

test('publish, vote, clear, rank, gate', () => {
  const a = publish('Should every post show where it was filmed?');
  const b = publish('Is a livestream evidence, or just a window?');
  const c = publish('Which city do you know only through this app?');
  assert.ok(a.mine && a.up === 0 && a.down === 0);
  assert.equal(rankFloor('new')[0].id, c.id);

  vote(a.id, 1);
  assert.equal(voteOf(a.id), 1);
  assert.deepEqual(tally(a), { up: 1, down: 0, pct: 100 });
  vote(a.id, 1);
  assert.equal(voteOf(a.id), 0);
  vote(a.id, -1);
  assert.equal(voteOf(a.id), -1);
  assert.equal(rankFloor('top')[2].id, a.id, 'a is net -1, so it sinks under the zeros');

  // the gate never hands you your own questions, and these three are all mine
  assert.equal(gateFor().length, 0);
  const theirs = rankFloor('new').map((f) => ({ ...f, mine: false }));
  assert.equal(theirs.length, 3);
  assert.equal(GATE_SIZE, 3);
});
