// Ordering of a batch: rank -> per-story lift cap -> diversify -> subject spread ->
// story spread. Plus the reels scorer (vwScore).
import { env, onConfigure } from '../env.ts';
import type { Post } from '../types.ts';
import { BIO } from './bio.ts';
import { STORY_BOOST_CAP, breakingLift, noteStory, storyBoostsLeft, storyOf } from './story.ts';

// ─── SUBJECT SPREAD ──────────────────────────────────────────────────────
// Ranking alone produces a monoculture (one pull ran Iran 48% / Trump 43% /
// Israel 20%). This never filters or rescores; it only stops one subject taking
// consecutive slots.
export const SUBJECTS: Array<[string, RegExp]> = [
  ['trump', /\btrump\b/i], ['musk', /\b(musk|tesla|spacex)\b/i], ['epstein', /\bepstein\b/i],
  ['israel-gaza', /\b(israel|israeli|gaza|idf|netanyahu|palestin\w*)\b/i],
  ['iran', /\b(iran|iranian|tehran)\b/i], ['ukraine-russia', /\b(ukrain\w*|russia\w*|putin|kyiv|moscow)\b/i],
  ['china', /\b(china|chinese|beijing|taiwan)\b/i], ['ice-immigration', /\b(ice|deportation|immigration|migrant)\b/i],
];
export function subjectOf(p: Partial<Post>): string {
  const t = String(p.body || '');
  for (const [k, re] of SUBJECTS) if (re.test(t)) return k;
  return '';   // no dominant subject — never spread, it is already variety
}
// Greedy interleave: take the best post whose subject wasn't the last one placed.
// One in a row is fine, two is a rut. Mutates and returns `list`.
export function spreadSubjects<T extends Partial<Post>>(list: T[]): T[] {
  if (list.length < 3) return list;
  const out: T[] = [], pool = list.slice(); let last = '', run = 0;
  while (pool.length) {
    let idx = 0;
    if (last) {
      const alt = pool.findIndex(p => subjectOf(p) !== last);
      if (alt > -1 && (run >= 1)) idx = alt;
    }
    const [p] = pool.splice(idx, 1);
    const s = subjectOf(p);
    run = (s && s === last) ? run + 1 : 0; last = s;
    out.push(p);
  }
  list.length = 0; list.push(...out);
  return list;
}

/**
 * Interleave step: a topic (tags[0]) cannot own more than a share of a page, the
 * same topic never runs twice in a row, the same author never back to back. Each
 * turn draws from the bucket whose best remaining post RANKS highest (drawing from
 * the LARGEST bucket threw the ranking away: #1 went to a 3-like post). Excess
 * beyond the share cap is TRIMMED (comes back next batch), not tail-dumped.
 */
export function diversify<T extends Partial<Post>>(list: T[], opts?: { maxShare?: number }): T[] {
  const o = opts || {};
  if (!list || list.length < 4) return list || [];
  const key = (p: T) => String((p.tags && p.tags[0]) || 'misc').toLowerCase();
  const who = (p: T) => String(p._handle || p._author || '').toLowerCase();
  const buckets = new Map<string, T[]>();
  list.forEach(p => { const k = key(p); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k)!.push(p); });
  const pos = new Map(list.map((p, i) => [p, i] as [T, number]));
  const out: T[] = []; let lastK = '', lastW = '', lastS = '';
  // Variety may lift a post a few ranks, never from the bottom of the batch (web
  // parity: strict alternation brought a lone 6-day-old void post up 5th).
  const REACH = 8;
  while (out.length < list.length) {
    let bk: string | null = null, bn = Infinity, best = Infinity;
    for (const e of buckets) {
      const k = e[0], arr = e[1];
      if (!arr.length) continue;
      const head = pos.get(arr[0])!;
      if (head < best) best = head;
      if (k === lastK) continue;
      if (head < bn) { bn = head; bk = k; }
    }
    if (bk !== null && lastK && bn - best > REACH && (buckets.get(lastK) || []).length) bk = lastK;
    if (bk === null) {                       // only the just-used topic is left
      for (const e of buckets) { if (e[1].length) { bk = e[0]; break; } }
      if (bk === null) break;
    }
    const arr = buckets.get(bk)!;
    // Prefer an item that repeats neither the previous account nor the previous
    // SUBJECT. "No subject" is never a repeat.
    const freshSubj = (p: T) => { const s = subjectOf(p); return !s || s !== lastS; };
    let i = arr.findIndex(p => who(p) !== lastW && freshSubj(p));
    if (i < 0) i = arr.findIndex(freshSubj);
    if (i < 0) i = arr.findIndex(p => who(p) !== lastW);
    if (i < 0) i = 0;
    const p = arr.splice(i, 1)[0];
    out.push(p); lastK = bk; lastW = who(p); lastS = subjectOf(p);
  }
  const cap = o.maxShare || 0.5;
  const limit = Math.max(3, Math.ceil(out.length * cap));
  const seen: Record<string, number> = {}; const kept: T[] = [];
  for (const p of out) {
    const k = key(p);
    seen[k] = (seen[k] || 0) + 1;
    if (seen[k] > limit) continue;
    kept.push(p);
  }
  return kept.length >= Math.min(4, list.length) ? kept : out;
}

/**
 * Rank -> per-story cap -> diversify -> subject spread -> story spread. Only the
 * first STORY_BOOST_CAP posts of a story carry breakingLift; the rest appear as
 * ordinary posts, so a disaster leads the feed without becoming the feed.
 * Sorts `list` in place.
 */
export function orderFeedBatch(list: Post[]): Post[] {
  // A post that named no region may have arrived before the story it belongs to.
  for (const p of list) if (!p._story && p._storyTok && p._storyTok.length) noteStory(p);
  let sc = new Map(list.map(p => [p, BIO.rankScore(p)] as [Post, number]));
  list.sort((a, b) => sc.get(b)! - sc.get(a)!);
  let capped = false;
  for (const p of list) {
    if (p._boostSlot || p._noBoost || breakingLift(p) < 10) continue;   // trivial lifts do not spend a slot
    const s = storyOf(p); if (!s) { p._boostSlot = true; continue; }   // storyless: lifted, uncapped, still spread
    if (storyBoostsLeft(s) > 0) { s.boosts.push(env.now()); p._boostSlot = true; }
    else { p._noBoost = true; capped = true; }
  }
  if (capped) { sc = new Map(list.map(p => [p, BIO.rankScore(p)] as [Post, number])); list.sort((a, b) => sc.get(b)! - sc.get(a)!); }
  const out = diversify(list);
  spreadSubjects(out);
  return spreadStories(out);
}

// Topic buckets cannot see that a 'crisis' post and a 'graphic' post are the same
// flood. Within the first STORY_TOP_N slots a story may hold STORY_BOOST_CAP, never
// back to back; the rest wait just below that window.
export const STORY_TOP_N = 10;
export function spreadStories(list: Post[]): Post[] {
  const head: Post[] = [], defer: Post[] = [], cnt = new Map<string, number>();
  for (const p of list) {
    const k = p._story || '';
    if (k && head.length < STORY_TOP_N && (cnt.get(k) || 0) >= STORY_BOOST_CAP) { defer.push(p); continue; }
    if (k) cnt.set(k, (cnt.get(k) || 0) + 1);
    head.push(p);
  }
  const top = head.slice(0, STORY_TOP_N);
  const clash = (a: Post, b: Post) => (a._story && a._story === b._story) || (a._boostSlot && b._boostSlot);
  for (let i = 1; i < top.length; i++) {
    if (!clash(top[i - 1], top[i])) continue;
    const j = top.findIndex((q, x) => x > i && !clash(top[i - 1], q));
    if (j > i) top.splice(i, 0, top.splice(j, 1)[0]);
  }
  return top.concat(defer, head.slice(STORY_TOP_N));
}

// ─── REELS SCORER ────────────────────────────────────────────────────────
export const VW_STYLES = ['video', 'image', 'carousel', 'audio'];
export let vwAff: Record<string, number> = {};
function loadAff() { try { vwAff = JSON.parse(env.storage.getItem('void_aff') || '{}') || {}; } catch { vwAff = {}; } }
loadAff();
onConfigure(loadAff);
/** Learned reel taste, clamped to [-8, 8] per tag. */
export function vwBump(tags: string[] | undefined, d: number): void {
  (tags || []).forEach(t => { vwAff[t] = Math.max(-8, Math.min(8, (vwAff[t] || 0) + d)); });
  try { env.storage.setItem('void_aff', JSON.stringify(vwAff)); } catch { /* */ }
}
// FOLLOWED CREATORS RANK UP. Follows live in the reels feature (device storage),
// so the feature registers the lookup here; core never imports a feature.
export const vwHooks = { following: (_p: Partial<Post>): boolean => false };
export function vwScore(p: Partial<Post>): number {
  const rec = 1 / (1 + (env.now() - (p.time as number)) / 36e5);                 // recency
  // Learned reel taste, PLUS the reader's profile (feed dwell, hearts, the interests
  // chosen at Ignite): reels used to start from an empty map on every install, so
  // day one was not catered to anyone. A hot profile tag (100) lifts 1.5, the same
  // as three LESS taps the other way can take off.
  const aff = (p.tags || []).reduce((s, t) => s + (vwAff[t] || 0) + (BIO.tags[t] || 0) * 0.03, 0) / 3;
  const fol = vwHooks.following(p) ? 1.5 : 0;                                   // a creator the reader follows
  const ctr = Math.min(1, (p.replies || 0) / Math.max(1, (p.score || 1) / 10));  // controversy
  // Volume, log-scaled, velocity()'s weights: 50 -> 5,000 likes lifts as much as 5,000
  // -> 500,000, so a viral clip rises without one mega-post owning the rail. PeerTube's
  // score is VIEWS, far cheaper than a like: 1/100 (a tuning knob), or an old archive
  // clip with a big view count outranks a fresh viral one.
  const vol = (p.source === 'peertube' ? (p.score || 0) / 100 : (p.score || 0)) + 2 * (p._reposts || 0) + 3 * (p._quotes || 0) + 2 * (p.replies || 0);
  // Curated fit (0-1, the curator's own judgement) lifts up to 1.5: a little under
  // the whole recency term, so a judged clip leads but a stale one cannot pin the rail.
  return rec * 2 + aff * 1.5 + fol + ctr + Math.log10(1 + vol) * .5 + (p._fit || 0) * 1.5 + env.random() * .6;   // + exploration noise
}
