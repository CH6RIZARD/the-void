// ─── SOCIAL PROXY (backend) — X/Reddit/Threads controversy ──────────────
// env.proxyBase (web: ?proxy= once, or storage 'void_proxy'). No direct fallback:
// every proxy item must carry provenance (sourceHost + responseHash) or it is refused.
import { env } from '../env.ts';
import type { Post } from '../types.ts';
import { stampRegion } from '../data/regions.ts';
import { inferTags } from '../rank/tags.ts';

export function proxyPostToApp(p: any): Post | null {
  if (!p?.provenance?.sourceHost || !p?.provenance?.responseHash) return null;
  const img = (p.media || []).find((m: any) => m.type === 'image'), vid = (p.media || []).find((m: any) => m.type === 'video');
  return stampRegion({
    id: 'px_' + p.id, style: vid ? 'video' : img ? 'image' : 'take', country: p.country || '', iso: '', tags: inferTags(p.text, ['geopolitics']),
    body: p.text || '', score: (p.metrics && p.metrics.score) || 0, replies: (p.metrics && p.metrics.replies) || 0,
    time: p.createdAt || env.now(), source: p.platform, _author: p.author || p.platform, _handle: p.handle || ('@' + p.platform),
    _img: (img && img.url) || (vid && vid.thumb) || '', _video: (vid && vid.url) || '', _url: p.url || '', _social: true,
    // Same-article dedupe + wire detection apply to proxy items too (p.link = the
    // external article, sent separately from the Reddit permalink).
    // WEB PARITY: in void2-final.html `_quotes:` sits inside the trailing comment on
    // this line, so proxy items carry NO _quotes. Kept identical.
    _link: p.link || p.url || '', _reposts: (p.metrics && p.metrics.reposts) || 0,
    _wire: !!p.handle && !/\.bsky\.social$/i.test(String(p.handle)) && /\./.test(String(p.handle)),
    provenance: p.provenance, imgHue: 270,
  } as Post);
}

let feedOffset = 0, feedPage = 0;
export function resetProxyOffset(): void { feedOffset = 0; }
/**
 * One proxy page. Rotates the rank mode instead of always asking for 'tension' —
 * the client can only diversify what it is sent.
 */
export async function pullProxyPage(): Promise<Post[]> {
  if (!env.proxyBase) return [];
  const modes = ['tension', 'hot', 'recent'];
  // The FIRST page is 30, not 100. One screenful is 6 cards and the list windows
  // at 90 rows, so a 100-item first page bought nothing but parse and rank time
  // right after boot (the measured 416+359ms stalls). Depth comes from the later
  // pages, which land while the reader is already reading.
  const limit = feedPage ? 100 : 30;
  const mode = modes[(feedPage++) % modes.length];
  const r = await env.fetch(`${env.proxyBase}/feed?mode=${mode}&limit=${limit}&offset=${feedOffset}`);
  if (!r.ok) return [];
  const d = await r.json();
  const posts = (d.items || []).map(proxyPostToApp).filter(Boolean) as Post[];
  feedOffset = posts.length ? d.nextOffset : 0;
  return posts;
}

export async function pullSocial(country: string): Promise<Array<Post | null> | null> {
  if (!env.proxyBase) return null;
  try {
    const r = await env.fetch(`${env.proxyBase}/social?country=${encodeURIComponent(country)}&mode=tension&limit=30`);
    if (!r.ok) return null; const d = await r.json(); return (d.items || []).map(proxyPostToApp);
  } catch { return null; }
}
