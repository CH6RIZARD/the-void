// Step-2 audit: raw source engagement vs what the app's own normaliser produces vs
// what PostCard renders, for live posts. Run:
//   node --experimental-strip-types src/core/__tests__/tools/metrics-audit.ts
import * as core from '../../index.ts';

const B = 'https://void-proxy-production.up.railway.app';
const rows: string[] = [];
const card = (p: any) => `${(p.replies || 0)}/${p.score || 0}/${p.reposts || 0}`; // PostCard: reply / heart / repost

const feed = core.BSKY_FEEDS[0];
const bs = await (await fetch(core.bskyFeedUrl(feed, undefined, 20))).json();
for (const it of (bs.feed || []).slice(0, 14)) {
  const raw = it.post || {};
  const p: any = core.bskyToPost(it);
  rows.push(`bsky  raw L${raw.likeCount ?? '-'} R${raw.replyCount ?? '-'} RP${raw.repostCount ?? '-'}  | norm score=${p.score} replies=${p.replies} reposts=${p.reposts} _reposts=${p._reposts} | card ${card(p)}`);
}
const px = await (await fetch(`${B}/feed?mode=hot&limit=30&offset=0`)).json();
for (const it of (px.items || []).slice(0, 6)) {
  const p: any = core.proxyPostToApp(it);
  rows.push(`proxy raw ${JSON.stringify(it.metrics)} | norm score=${p.score} replies=${p.replies} reposts=${p.reposts} _reposts=${p._reposts} | card ${card(p)}`);
}
console.log(rows.join('\n'));
const zero = rows.filter((r) => / card 0\/0\/0$/.test(r)).length;
console.log(`\n${rows.length} posts, ${zero} render 0/0/0 on the card`);
