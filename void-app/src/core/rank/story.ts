// ─── BREAKING / SPIKE + CORROBORATION ───────────────────────────────────
// The ranker could not SEE a story breaking: popularity was log-damped, there was
// no engagement-over-time term, and a second outlet on the same story was deduped
// to nothing instead of counted. Three bounded signals, each decaying with a 6h
// half-life so a spike leads while breaking and then falls back to ordinary rank:
//   velocity      — weighted engagement / age^0.8; lifts only above ~100/h
//   corroboration — distinct accounts carrying the same STORY (region + crisis
//                   kind, e.g. NP|flood), counted even when dedupe drops the copy
//   story cap     — only STORY_BOOST_CAP posts per story ever carry the lift
import { env } from '../env.ts';
import type { Post } from '../types.ts';
import { _REGION_ALIAS_N, _regionByName, _regionNorm, resolveRegion } from '../data/regions.ts';

export const TENSION_TAGS = new Set(['crisis', 'graphic', 'warfare', 'resistance', 'power', 'deception', 'surveillance', 'geopolitics']);
export const SPIKE_HALF_LIFE_H = 6, BREAKING_MIN_V = 200, STORY_BOOST_CAP = 2, STORY_EXEMPT_CAP = 3, STORY_WINDOW_H = 36;

export function hasTension(p: Partial<Post>): boolean { return (p.tags || []).some(t => TENSION_TAGS.has(t)); }
export function postAgeH(p: Partial<Post>): number { const now = env.now(); return Math.max(0, (now - (p.time || now)) / 3600000); }

// Weighted engagement per hour, sub-linear in age so a 10-minute-old post with 20
// likes is not "faster" than an hour-old one with 5,000. Live 2026-09-13:
// p50 6/h, p75 42/h, p90 288/h, p97 941/h.
export function velocity(p: Partial<Post>): number {
  const eng = (p.score || 0) + 2 * (p._reposts || 0) + 3 * (p._quotes || 0) + 2 * (p.replies || 0);
  return eng / Math.pow(Math.max(0.25, postAgeH(p)), 0.8);
}
// A disaster/atrocity report that is moving fast. Deliberately narrower than
// hasTension: this is what may pass the no-wire gates, and ordinary political
// wire copy must stay out however viral it is.
export function isBreaking(p: Partial<Post>): boolean {
  const t = p.tags || [];
  return (t.includes('crisis') || t.includes('graphic')) && postAgeH(p) <= 24 && velocity(p) >= BREAKING_MIN_V;
}

export const STORY_KIND: Array<[string, RegExp]> = [
  ['flood', /flood|glacial|inundac|inunda[cç]|alluvion|inondation|hochwasser|sturzflut|[üu]berschwemm|overstrom|बाढ|हिमताल|洪水|наводнен|فيضان|বন্যা|سیلاب/i],
  ['quake', /earthquake|\bquake|terremoto|s[ée]isme|erdbeben|aardbeving|भूक|地震|землетрясен|زلزال/i],
  ['landslide', /landslide|mudslide|avalanche|deslizamiento|erdrutsch|पहिरो|滑坡|泥石流|土砂崩れ|оползн/i],
  ['crash', /crash|derail|capsiz|shipwreck|दुर्घटना/i], ['collapse', /collapse|انهيار/i],
  ['stampede', /stampede|crowd crush/i], ['fire', /wildfire|blaze|\bfire\b/i], ['blast', /explosion|\bblast|\bbomb/i],
  ['shooting', /shooting|gunm[ae]n/i], ['unrest', /protest|crackdown|curfew|riot|uprising|martial law|कर्फ्यु|आन्दोलन/i],
  ['strike', /airstrike|shelling|missile|drone strike/i]];
// Names the region normaliser cannot see (non-Latin script) or that are cities.
export const STORY_PLACE_HINTS: Record<string, string> = { 'नेपाल': 'NP', 'काठमाडौं': 'NP', 'भारत': 'IN', 'पाकिस्तान': 'PK', 'kathmandu': 'NP', 'pokhara': 'NP', 'dhaka': 'BD', 'karachi': 'PK', 'lahore': 'PK', 'islamabad': 'PK', 'delhi': 'IN', 'mumbai': 'IN', 'kabul': 'AF', 'kyiv': 'UA', 'kharkiv': 'UA', 'tehran': 'IR', 'khartoum': 'SD', 'manila': 'PH', 'jakarta': 'ID', 'port au prince': 'HT' };
let _placeRe: RegExp | null = null;
export function regionInText(text: unknown): string {
  const raw = String(text || '');
  for (const k in STORY_PLACE_HINTS) if (!/^[a-z ]+$/.test(k) && raw.includes(k)) return STORY_PLACE_HINTS[k];
  if (!_placeRe) {
    const names = [...Object.keys(_regionByName), ...Object.keys(_REGION_ALIAS_N), ...Object.keys(STORY_PLACE_HINTS).filter(k => /^[a-z ]+$/.test(k))]
      .filter(k => k.length >= 4).sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    _placeRe = new RegExp('\\b(' + names.join('|') + ')\\b');   // word-bounded: 'oman' must not match 'woman'
  }
  const m = _regionNorm(raw).match(_placeRe); if (!m) return '';
  if (STORY_PLACE_HINTS[m[1]]) return STORY_PLACE_HINTS[m[1]];
  const r = resolveRegion(m[1]); return r ? (r.parent || r.code) : '';
}

// What makes two posts the SAME story:
//  - disaster/atrocity posts (crisis|graphic) in one region  -> 'NP|crisis'
//  - conflict/unrest posts in one region, split by kind      -> 'UA|strike'
//  - a post naming no region JOINS a live region story through a proper noun only
//    that story has used. Stories never merge with each other: merging on any
//    shared capitalised word chained Syria/Iran/Lebanon/Nepal into one "story".
export const STORY_STOP = new Set(['breaking', 'update', 'updates', 'watch', 'video', 'photos', 'death', 'deaths', 'rescuers', 'government', 'police', 'president', 'minister', 'people', 'thousands', 'hundreds', 'officials', 'authorities', 'world', 'news', 'today', 'after', 'their', 'there', 'these', 'those', 'where', 'while', 'which', 'nobody', 'whole', 'heartbreaking', 'horrific', 'please', 'thank', 'story', 'report', 'reports', 'latest', 'live', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);
export function storyTokens(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\b[A-Z][a-z]{4,}\b/g)) {
    const idx = m.index || 0;
    const before = body.slice(Math.max(0, idx - 3), idx);
    if (idx === 0 || /[.!?:\n"“]\s*$/.test(before)) continue;   // sentence-initial: not a proper noun
    const w = m[0].toLowerCase();
    if (STORY_STOP.has(w) || _regionByName[w] || _REGION_ALIAS_N[w] || STORY_PLACE_HINTS[w]) continue;  // regions are keyed separately
    out.add(w);
  }
  for (const m of body.matchAll(/[ऀ-ॿ؀-ۿЀ-ӿ]{5,}/g)) out.add(m[0]);
  return [...out].slice(0, 12);
}
export function storyInfo(p: Post): void {
  if (p._storyTok) return;
  const t = p.tags || [], body = String(p.body || '');
  const dis = t.includes('crisis') || t.includes('graphic'), con = t.includes('warfare') || t.includes('resistance');
  p._storyBase = ''; p._storyTok = [];
  if (!dis && !con) return;
  const region = p._regionParent || p._region || regionInText(body);
  const kind = dis ? 'crisis' : ((STORY_KIND.find(([, re]) => re.test(body)) || [])[0] || '');
  p._storyBase = region && kind ? region + '|' + kind : '';
  p._storyTok = storyTokens(body);
}

export interface Story { srcs: Set<string>; boosts: number[]; exempt: number; last: number; }
export const _stories = new Map<string, Story>();          // key -> story
export const _storyTokIdx = new Map<string, Set<string>>(); // proper noun -> story keys it appeared in

export function storyOf(p: Partial<Post> | null | undefined): Story | null { return p && p._story ? _stories.get(p._story) || null : null; }
export function noteStory(p: Post | null | undefined): string {
  if (!p) return '';
  storyInfo(p);
  const now = env.now(), win = STORY_WINDOW_H * 3600000;
  let key = p._storyBase || '';
  if (key) {
    for (const w of p._storyTok || []) {
      let ks = _storyTokIdx.get(w); if (!ks) { ks = new Set(); _storyTokIdx.set(w, ks); }
      if (ks.size < 2) ks.add(key);              // 2 = generic; no need to remember more
    }
  } else {
    for (const w of p._storyTok || []) {
      const ks = _storyTokIdx.get(w); if (!ks || ks.size !== 1) continue;
      const k = ks.values().next().value as string, s = _stories.get(k);
      if (s && now - s.last <= win) { key = k; break; }
    }
    if (!key) return '';
  }
  let s = _stories.get(key);
  if (!s || now - s.last > win) { s = { srcs: new Set(), boosts: [], exempt: 0, last: now }; _stories.set(key, s); }
  s.last = now;
  s.srcs.add(String(p._handle || p._author || p.source || p.id).toLowerCase());
  p._story = key;
  if (_stories.size > 400) _stories.delete(_stories.keys().next().value as string);
  if (_storyTokIdx.size > 6000) _storyTokIdx.delete(_storyTokIdx.keys().next().value as string);
  return key;
}
export function storySources(p: Partial<Post>): number { const s = storyOf(p); return s ? s.srcs.size : 0; }
// Lift slots are per rolling 12h, so an ongoing war can spike again tomorrow.
export function storyBoostsLeft(s: Story): number { const now = env.now(); s.boosts = s.boosts.filter(t => now - t < 12 * 3600000); return STORY_BOOST_CAP - s.boosts.length; }

/** Additive rank lift. 0..~88 at the moment of breaking, halving every 6h. */
export function breakingLift(p: Partial<Post>): number {
  if (p._noBoost) return 0;
  const ageH = postAgeH(p); if (ageH > 48) return 0;
  const tense = hasTension(p);
  const v = velocity(p);
  const spike = Math.min(60, Math.max(0, Math.log10(v + 1) - 2) * 25) * (tense ? 1 : 0.4);   // 1k/h=+25, 10k/h=+50
  const n = storySources(p);
  const corr = tense && n >= 2 ? Math.min(28, 12 * Math.log2(n)) : 0;                       // 2 sources=+12, 4=+24
  return (spike + corr) * Math.pow(0.5, ageH / SPIKE_HALF_LIFE_H);
}
// Controversy as a rank term. Weak argument proxy (quotes + replies vs likes),
// gated on a minimum of real argument.
export function controversyLift(p: Partial<Post>): number {
  const replies = p.replies || 0, quotes = p._quotes || 0;
  if (replies + quotes < 10) return 0;
  const cont = Math.min(1, (replies + quotes * 2) / Math.max(25, (p.score || 0) * 0.15));
  return 22 * cont * (hasTension(p) ? 1 : 0.6);
}

/** Test/reset hook: forget every story. */
export function resetStories(): void { _stories.clear(); _storyTokIdx.clear(); }
