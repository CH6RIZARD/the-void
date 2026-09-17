// ─── NATION RANKING ──────────────────────────────────────────
// Top 3 for a nation, scored on interest affinity + geo + a live bonus + view
// velocity. Composition is forced: at least one live stream and at least one
// about-this-nation item when either exists, so the block never collapses into
// three of the same thing.
import type { Country, NationRankItem, Post } from '../types.ts';
import { C, resolveRegion } from '../data/regions.ts';
import { allPosts } from '../feed/store.ts';
import { nationMentionRe } from '../feed/nation.ts';
import { _nationLive } from '../streams/nation.ts';
import { BIO } from './bio.ts';

export function rankNation(iso: string, current?: Country | null): NationRankItem[] {
  const c: any = C.find(x => x.iso === iso || x.n === iso) || current || {};
  const name = c.n || iso;
  const aff = (t: string) => (BIO && BIO.tags && BIO.tags[t]) || 0;
  // Only streams that CONNECTED in this nation's live section. A LIVE badge on a
  // stream nobody has seen play would be a claim the app cannot back up.
  const streams = (_nationLive[name] || []).slice(0, 4)
    .map(s => ({ kind: 'stream' as const, live: true, title: s.label || name, country: name, iso: c.iso, src: s }));
  const want = (resolveRegion(name) || {} as any).code || c.iso;
  const re = c.n ? nationMentionRe(c) : null;
  const posts: any[] = [], about: any[] = [], seen = new Set<string>();
  for (const p of allPosts) {
    if (!p || seen.has(p.id)) continue;
    const own = (want && p._region === want) || p.country === name || (c.iso && p.iso === c.iso);
    const ab = !own && (p._nation === name || (re && re.test(p.body || '')));
    if (!own && !ab) continue;
    seen.add(p.id);
    (own ? posts : about).push({ kind: own ? 'post' : 'about', live: false, title: p.body || '', country: own ? name : (p.country || name), iso: c.iso, post: p });
  }
  const score = (it: { live: boolean; kind: string; post?: Post }) => {
    const p = it.post;
    const affinity = p ? (p.tags || []).reduce((s, t) => s + aff(t), 0) : 2;
    const geo = it.kind === 'about' ? 1.5 : 3;                    // same-nation beats about-nation
    const liveBonus = it.live ? 4 : 0;
    const media = p && (p._img || p._video) ? 2 : 0;               // a portrait tile with no picture reads as broken
    const velocity = p ? Math.min(4, (p.score || 0) / 2500 + (p.replies || 0) / 120) : 2.5;
    return affinity * 1.4 + geo + liveBonus + media + velocity;
  };
  const all: NationRankItem[] = [...streams, ...posts, ...about].map(it => ({ ...it, _s: score(it) })).sort((a, b) => b._s - a._s);
  const out: NationRankItem[] = [];
  const takeFirst = (k: string) => { const i = all.findIndex(x => x.kind === k && !out.includes(x)); if (i >= 0) out.push(all[i]); };
  takeFirst('stream');                                    // >=1 stream when available
  if (!all.some(x => x.kind === 'about' && out.includes(x))) takeFirst('about');  // >=1 about item
  for (const it of all) { if (out.length >= 3) break; if (!out.includes(it)) out.push(it); }
  return out.slice(0, 3);
}

/** Same scorer with the stream slot taken out (the hero owns it). */
export function nationRankedPosts(c: Country): NationRankItem[] {
  const saved = _nationLive[c.n]; _nationLive[c.n] = [];
  try { return rankNation(c.iso || c.n, c).filter(it => it.post); } finally { _nationLive[c.n] = saved; }
}
/** 7e quiet cards: TRENDING = best post FROM the nation (else best about), ABOUT = best about. */
export function nationCards(c: Country): { trending: Post | null; about: Post | null } {
  const items = nationRankedPosts(c);
  const trending = items.find(x => x.kind === 'post') || items.find(x => x.kind === 'about');
  const about = items.find(x => x.kind === 'about' && x !== trending);
  return { trending: (trending && trending.post) || null, about: (about && about.post) || null };
}
