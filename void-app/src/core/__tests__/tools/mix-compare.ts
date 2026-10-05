// Before/after: the first 30 main-feed cards from a live candidate pool, ranked by
// orderFeedBatch alone (before) and by orderFeedBatch + mixFeed (after).
//   node --experimental-strip-types src/core/__tests__/tools/mix-compare.ts
import * as core from '../../index.ts';

core.configureCore({ storage: core.createMemoryStorage(), session: core.createMemoryStorage(), now: () => Date.now(), random: Math.random, proxyBase: '' });
const pool: any[] = [];
for (const feed of core.BSKY_FEEDS.slice(0, 4)) {
  try {
    const d = await (await fetch(core.bskyFeedUrl(feed, undefined, 30))).json();
    for (const it of d.feed || []) pool.push(core.bskyToPost(it));
  } catch {}
}
try {
  const d = await (await fetch('https://void-proxy-production.up.railway.app/feed?mode=hot&limit=30&offset=0')).json();
  for (const it of d.items || []) { const p = core.proxyPostToApp(it); if (p) pool.push(p); }
} catch {}
const seen = new Set<string>();
const uniq = pool.filter((p) => p && !seen.has(p.id) && seen.add(p.id));
const describe = (list: any[], name: string) => {
  const top = list.slice(0, 30);
  const eng = top.filter((p) => core.engagementOf(p) >= core.ENGAGED_MIN).length;
  const zero = top.filter((p) => core.engagementOf(p) === 0).length;
  const authors = new Set(top.map((p) => p._handle || p._author)).size;
  console.log(`${name.padEnd(7)} first 30: engaged ${eng}, niche ${30 - eng} (of which 0-engagement ${zero}), distinct authors ${authors}`);
  console.log('        ' + top.map((p) => (core.engagementOf(p) >= core.ENGAGED_MIN ? 'E' : 'n')).join(''));
};
console.log(`live pool: ${uniq.length} posts`);
const before = core.orderFeedBatch(uniq.slice());
describe(before, 'before');
describe(core.mixFeed(before), 'after');
