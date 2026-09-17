// GDELT — the LOCAL tier: indexes each nation's OWN outlets with the outlet's image.
import { env, sleep } from '../env.ts';
import type { Post } from '../types.ts';
import { urlKey } from '../util.ts';

export function gdeltTime(s: string | undefined): number { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : env.now(); }

export function gdeltToPost(a: any): Post | null {
  if (!a || !a.title || !a.url) return null;
  const img = a.socialimage || '', dom = (a.domain || 'news').toLowerCase();
  return {
    id: 'gd_' + urlKey(a.url), style: img ? 'image' : 'take', country: a.sourcecountry || '', iso: '',
    tags: [dom.split('.')[0]], body: a.title, score: 0, replies: 0, time: gdeltTime(a.seendate),
    source: 'news', _author: dom, _handle: '@' + dom, _img: img, _video: '', _url: a.url, sourceUrl: a.url,
    _social: true, provenance: { sourceHost: dom }, imgHue: 270,
  };
}

// GDELT publishes a hard limit of one request per 5s and answers 429 as plain text
// past it — so calls are serialised through a 6s gate with one throttled retry.
export const GDELT_GATE_MS = 6000, GDELT_RETRY_MS = 6500;
let _gdeltChain: Promise<Post[]> = Promise.resolve([]), _gdeltLast = 0;
export const _gdeltCache: Record<string, Post[]> = {};

export function gdeltQuery(q: string, span?: string): Promise<Post[]> {
  const once = async (): Promise<Post[] | null> => {
    const wait = GDELT_GATE_MS - (env.now() - _gdeltLast);
    if (wait > 0) await sleep(wait);
    _gdeltLast = env.now();
    const u = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&maxrecords=60&format=json&timespan=${span || '7d'}&sort=datedesc`;
    const r = await env.fetch(u, { headers: { Accept: 'application/json' } });
    const t = await r.text();
    if (!r.ok || !t.trim().startsWith('{')) return null;   // over the limit: plain-text notice
    return ((JSON.parse(t).articles || []) as any[]).map(gdeltToPost).filter(Boolean) as Post[];
  };
  const run = async (): Promise<Post[]> => {
    try {
      let out = await once();
      if (out === null) { await sleep(GDELT_RETRY_MS); out = await once(); }
      return out || [];
    } catch { return []; }
  };
  _gdeltChain = _gdeltChain.then(run, run);
  return _gdeltChain;
}

/** Local outlets OR coverage naming the country, one round trip, cached per session. */
export async function pullCountryNews(c: { n: string }): Promise<Post[]> {
  const slug = (c.n || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!slug) return [];
  if (_gdeltCache[slug]) return _gdeltCache[slug];
  const out = await gdeltQuery(`(sourcecountry:${slug} OR "${c.n}")`);
  if (out.length) _gdeltCache[slug] = out;
  return out;
}
