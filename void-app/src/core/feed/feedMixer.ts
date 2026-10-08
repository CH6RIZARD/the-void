// feedMixer - the main feed's engaged / niche mix.
//
// The feed read as almost all zero-engagement posts. Diagnosis (tools/
// metrics-audit.ts): likes and replies normalise correctly, reposts were dropped
// by the card (fixed separately), and the rest of the zeros are real - the feed
// server's X posts carry 0-14 likes. So the zeros are a ranking question: this
// module deals a deliberate mix, like X's but with a larger share of niche posts.
//
//   engaged bucket: eng >= ENGAGED_MIN, ranked by engagement per hour of age,
//                   relative to its source's typical post (the pool has no
//                   follower counts, so the source's median stands in for the
//                   author's size: 50 likes on Reddit is not 50 on Bluesky).
//   niche bucket:   eng < ENGAGED_MIN that pass the quality gate, ranked by
//                   substance (text length, media, a real argument) then recency.
//   per page of PAGE: NICHE_SHARE of the slots are niche, the rest engaged;
//                   at most PER_AUTHOR posts per author and PER_TOPIC per topic.
//                   A bucket that runs dry hands its slots to the other.
//   Posts that fail the niche gate, or every cap, go last - never dropped, so
//   the feed cannot run dry because of the mixer.
//
// TUNING: NICHE_SHARE (0 = engaged only, 1 = niche only). The rest are the gates.
import type { Post } from '../types.ts';
import { env } from '../env.ts';
import { subjectOf } from '../rank/order.ts';
import { NF_METAR_RE, nfShape } from './nation.ts';

export const NICHE_SHARE = 0.45;
export const PAGE = 10;
/** Weighted engagement at or above this is 'engaged'. */
export const ENGAGED_MIN = 5;
export const PER_AUTHOR = 2;
export const PER_TOPIC = 2;
/** A niche post needs this much text once links, handles and tags are stripped... */
export const NICHE_MIN_CHARS = 40;
/** ...unless it carries its own media. */

export function engagementOf(p: Partial<Post>): number {
  const reposts = (p as any).reposts || (p as any)._reposts || 0;
  return (p.score || 0) + 2 * (p.replies || 0) + 2 * reposts;
}

const authorOf = (p: Partial<Post>) => String(p._handle || p._author || p.source || '').toLowerCase();
const textOf = (p: Partial<Post>) =>
  String(p.body || '').replace(/https?:\/\/\S+/g, ' ').replace(/[#@][\p{L}\p{N}_.]+/gu, ' ').replace(/\s+/g, ' ').trim();
const hasMedia = (p: Partial<Post>) => !!(p as any)._img || !!(p as any)._video || p.style === 'image' || p.style === 'video' || p.style === 'carousel';

/**
 * Someone telling you what is happening to them: the proxy's X_FIRSTHAND phrases
 * ("right now", "outside my", "we can hear", "on the ground") plus plain
 * first-person present tense. Deliberately narrow - "I think" op-eds do not count.
 */
export const FIRST_PERSON_RE = /\b(right now|happening now|just now|outside my|we can hear|on the ground|my (street|window|building|block|city|county|town|house|neighbou?rhood)|i(?:'m| am| was| just| can hear| can see| saw| heard)|we(?:'re| are| were| just)|here in)\b/i;
export const isFirstPerson = (p: Partial<Post>) => FIRST_PERSON_RE.test(String(p.body || ''));

/** The niche quality gate: substance, not a bare link or re-share, not a known spam shape. */
export function nicheQualifies(p: Partial<Post>, shapes: Set<string>): boolean {
  if (p._repost) return false; // a pure re-surface of someone else's post
  const body = String(p.body || '');
  if (NF_METAR_RE.test(body)) return false; // weather-bot reports
  const text = textOf(p);
  if (text.length < NICHE_MIN_CHARS && !hasMedia(p)) return false; // link-only / one-liner
  const sh = nfShape(body); // the same text posted again and again
  if (sh.length >= 12) {
    if (shapes.has(sh)) return false;
    shapes.add(sh);
  }
  return true;
}

function median(xs: number[]): number {
  if (!xs.length) return 1;
  const s = xs.slice().sort((a, b) => a - b);
  return s[s.length >> 1] || 1;
}

/** Re-deal an already-ordered candidate list as an engaged / niche mix. */
export function mixFeed(list: Post[], share = NICHE_SHARE): Post[] {
  const now = env.now();
  const ageH = (p: Post) => Math.max(0, (now - (p.time || now)) / 3600000);
  const engaged: Post[] = [], niche: Post[] = [], rest: Post[] = [];
  const shapes = new Set<string>();
  for (const p of list) {
    if (engagementOf(p) >= ENGAGED_MIN) engaged.push(p);
    else if (nicheQualifies(p, shapes)) niche.push(p);
    else rest.push(p);
  }
  // Engaged: engagement per hour, relative to the source's typical engaged post.
  const bySource: Record<string, number[]> = {};
  for (const p of engaged) (bySource[p.source || ''] ||= []).push(engagementOf(p));
  const base: Record<string, number> = {};
  for (const k in bySource) base[k] = median(bySource[k]);
  const eScore = (p: Post) => engagementOf(p) / (base[p.source || ''] || 1) / Math.pow(ageH(p) + 2, 1.2);
  engaged.sort((a, b) => eScore(b) - eScore(a));
  // Niche: a person's own account first, then substance, then recency.
  //
  // Length used to stand in for substance, so the lane filled with 300-char
  // op-eds and the 96-char "I'm under a state of emergency right now" lost to
  // them every time - measured 2026-10-08: 4 of 12 first-deal cards first-person
  // with 27 eyewitness X posts in the pool. The lived-experience post IS the
  // substance this app exists for; the bonus outweighs the whole length term.
  const nScore = (p: Post) => {
    const t = textOf(p).length;
    return (isFirstPerson(p) ? 1.2 : 0) + Math.min(t, 400) / 400 + (hasMedia(p) ? 0.35 : 0) + ((p.replies || 0) > 0 ? 0.2 : 0) - Math.min(ageH(p), 48) / 96;
  };
  niche.sort((a, b) => nScore(b) - nScore(a));

  const out: Post[] = [];
  const total = engaged.length + niche.length;
  let pageAuthors: Record<string, number> = {}, pageTopics: Record<string, number> = {};
  let nicheDealt = 0;
  const take = (bucket: Post[]): Post | null => {
    for (let i = 0; i < bucket.length; i++) {
      const p = bucket[i], a = authorOf(p), t = subjectOf(p) || '';
      if ((pageAuthors[a] || 0) >= PER_AUTHOR) continue;
      if (t && (pageTopics[t] || 0) >= PER_TOPIC) continue;
      bucket.splice(i, 1);
      pageAuthors[a] = (pageAuthors[a] || 0) + 1;
      if (t) pageTopics[t] = (pageTopics[t] || 0) + 1;
      return p;
    }
    return null;
  };
  while (out.length < total) {
    if (out.length % PAGE === 0) { pageAuthors = {}; pageTopics = {}; }
    // Spread the niche slots evenly: after n posts, about n * share should be niche.
    const wantNiche = nicheDealt < Math.round((out.length + 1) * share);
    const pick = () => (wantNiche ? take(niche) || take(engaged) : take(engaged) || take(niche));
    let p = pick();
    if (!p) {
      // Everything left is capped on this page (one author or topic dominates what
      // remains): reset the caps as if a new page began. Still nothing = done.
      pageAuthors = {}; pageTopics = {};
      p = pick();
      if (!p) break;
    }
    if (engagementOf(p) < ENGAGED_MIN) nicheDealt++;
    out.push(p);
  }
  // Whatever the caps never placed, then the posts that failed the niche gate.
  return out.concat(engaged, niche, rest);
}
