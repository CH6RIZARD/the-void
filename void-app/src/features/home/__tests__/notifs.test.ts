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

test('every kind lands in Mail with a destination: thread, person or topic, never nothing', () => {
  const q = { id: 'q1', body: 'Which live cam do you keep going back to?' };
  const chimeR = { id: 'c1', body: 'Shibuya at 3am, waiting for the crossing to empty.' };
  const rows: Row[] = [
    { id: 'b1', type: 'rank', read_at: null, created_at: at(1), actor: who(1), post: drop },
    { id: 'r1', type: 'reply', read_at: null, created_at: at(2), actor: who(2), post: { id: 'p2', body: 'Eleven minutes.', reply_to: 'p1', parent: drop } },
    { id: 'r2', type: 'reply', read_at: null, created_at: at(3), actor: who(3), post: { id: 'p3', body: 'orphan', reply_to: 'gone' } },
    { id: 'f1', type: 'follow', read_at: null, created_at: at(4), actor: who(4) },
    { id: 'm1', type: 'mention', read_at: null, created_at: at(5), actor: who(5), post: { id: 'p5', body: '@v0 look at this', reply_to: null } },
    { id: 'm2', type: 'mention', read_at: null, created_at: at(6), actor: who(6), question: q, poll_reply: chimeR },
    { id: 'c1', type: 'chime', read_at: null, created_at: at(7), actor: who(7), question: q, poll_reply: chimeR },
    { id: 'cb1', type: 'chime_bolt', read_at: null, created_at: at(8), actor: who(8), question: q, poll_reply: chimeR },
    { id: 'cb2', type: 'chime_bolt', read_at: null, created_at: at(9), actor: who(9), question: q, poll_reply: chimeR },
    { id: 'v1', type: 'void', read_at: null, created_at: at(10), actor: null, question: q },
  ];
  const out = groupRows(rows, NOW);
  const by = (k: string) => out.filter((n) => n.kind === k);
  assert.deepEqual(by('bolt')[0].go, { thread: 'p1' });
  assert.deepEqual(by('reply')[0].go, { thread: 'p1', focus: 'p2' });
  assert.deepEqual(by('reply')[1].go, { thread: 'gone', focus: 'p3' });
  assert.deepEqual(by('follow')[0].go, { user: 'v4' });
  assert.deepEqual(by('mention').map((n) => n.go), [{ thread: 'p5' }, { topic: 'q1' }]);
  assert.equal(by('chime')[0].text, chimeR.body);
  assert.deepEqual(by('chime')[0].go, { topic: 'q1' });
  assert.equal(by('chimeBolt').length, 1, 'bolts on one chime collapse');
  assert.equal(by('chimeBolt')[0].by.length, 2);
  assert.deepEqual(by('void')[0].go, { topic: 'q1' });
  assert.ok(out.every((n) => n.go), 'no row without a destination');
});
