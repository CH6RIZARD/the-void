// Mail grouping, driven by hand: bolts on one drop collapse into one row with the
// first three actors named and the rest counted; follows collapse per section; a reply
// keeps its text and its parent as the thumbnail; newest first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRows, sectionOf, type Row } from '../notifs.ts';

const NOW = Date.UTC(2026, 9, 8, 12);
const at = (minAgo: number) => new Date(NOW - minAgo * 60000).toISOString();
const who = (i: number) => ({ id: 'u' + i, handle: 'v' + i, display_name: null });
const drop = { id: 'p1', body: 'Lagos, 06:40. The grid came back for eleven minutes.', reply_to: null, post_media: [{ url: 'https://x/1.jpg', ordinal: 0 }] };

test('bolts on one drop become one row; three named, the rest counted', () => {
  const rows: Row[] = [1, 2, 3, 4, 5].map((i) => ({ id: 'n' + i, type: 'rank', read_at: i > 2 ? at(0) : null, created_at: at(i), actor: who(i), post: drop }));
  const out = groupRows(rows, NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'bolt');
  assert.deepEqual(out[0].by.map((a) => a.handle), ['v1', 'v2', 'v3']);
  assert.equal(out[0].others, 2);
  assert.equal(out[0].unread, true);
  assert.equal(out[0].post?.img, 'https://x/1.jpg');
  assert.equal(sectionOf(out[0], NOW), 'new');
});

test('follows collapse per section; a reply carries its text and parent; newest first', () => {
  const rows: Row[] = [
    { id: 'f1', type: 'follow', read_at: null, created_at: at(5), actor: who(7) },
    { id: 'f2', type: 'follow', read_at: null, created_at: at(9), actor: who(8) },
    { id: 'f3', type: 'follow', read_at: at(0), created_at: at(3 * 1440), actor: who(9) },
    { id: 'r1', type: 'reply', read_at: at(0), created_at: at(60), actor: who(2), post: { id: 'p2', body: 'Eleven minutes is a party.', reply_to: 'p1', parent: drop } },
    { id: 's1', type: 'slash', read_at: null, created_at: at(1), actor: who(3), post: drop },
  ];
  const out = groupRows(rows, NOW);
  assert.deepEqual(out.map((n) => n.kind), ['follow', 'reply', 'follow']);
  assert.deepEqual(out[0].by.map((a) => a.handle), ['v7', 'v8']);
  assert.equal(sectionOf(out[0], NOW), 'new');
  assert.equal(out[1].text, 'Eleven minutes is a party.');
  assert.equal(out[1].post?.id, 'p1');
  assert.equal(sectionOf(out[1], NOW), 'today');
  assert.equal(sectionOf(out[2], NOW), 'week');
});
