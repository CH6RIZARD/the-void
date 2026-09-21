// Hidden BIO — internal per-user signal model, never exposed to users. Learns from
// dwell, reactions and scroll, and ranks candidates by fusing
// interest(tags) + region + format + freshness + popularity + readability +
// breaking + controversy.
import { env, onConfigure } from '../env.ts';
import type { Post } from '../types.ts';
import { TENSION_TAGS, breakingLift, controversyLift } from './story.ts';

// ─── READABILITY WEIGHT ─────────────────────────────────────────────────
// A fast vertical feed rewards posts you can take in at a glance, so long unbroken
// paragraphs are DEMOTED — never dropped. Thresholds are measured, not taste:
// Bluesky caps at 300 chars, median ~200, ~35% land in 240-400 as one block. The
// curve works across 0-300 and keeps penalising past it for uncapped sources.
//   length  — how much there is to read
//   density — the longest run with no line break (300 chars over four lines reads
//             fine; the same 300 as one block is a wall)
// Length is NOT a veto: a post that earned it (earned()) keeps its place.
export const READABILITY = {
  PUNCHY_MAX: 140, PUNCHY_MIN_BONUS: 6, PUNCHY_EXTRA: 14,
  LONG_SPAN: 260, LONG_PENALTY: 24, EARNED_WAIVER: 0.85,
  DENSE_MIN: 200, DENSE_SPAN: 300, DENSE_PENALTY: 12,
  MEDIA_SCALE: 0.35, WIRE_PENALTY: 9,
} as const;

export function textFit(p: Partial<Post>): number {
  const R = READABILITY;
  const t = String(p.body || ''); const len = t.length;
  if (!len) return 0;
  const dens = t.split(/\n+/).reduce((m, s) => Math.max(m, s.length), 0);
  const e = earned(p);
  let s: number;
  if (len <= R.PUNCHY_MAX) s = R.PUNCHY_MIN_BONUS + R.PUNCHY_EXTRA * (1 - len / R.PUNCHY_MAX);        // punchy: +6..+20
  else s = -R.LONG_PENALTY * Math.min(1, (len - R.PUNCHY_MAX) / R.LONG_SPAN) * (1 - R.EARNED_WAIVER * e); // long: up to -24, all but 15% waived when earned
  if (dens > R.DENSE_MIN) s -= R.DENSE_PENALTY * Math.min(1, (dens - R.DENSE_MIN) / R.DENSE_SPAN) * (1 - R.EARNED_WAIVER * e);
  if (p._img || p._video) s *= R.MEDIA_SCALE;                        // media carries the post; text matters less
  // Wire copy is penalised at EVERY length: 59% of short live posts were outlet
  // accounts, so the short-post bonus was promoting corporate headline-links.
  if (p._wire) s -= R.WIRE_PENALTY;
  return s;
}
// How much a post has earned the right to take up space (0..1): engagement it got
// plus how contested it is, discounted hard for wire copy. "Controversial" is barely
// measurable (no down-votes; reply:like p50=0.00) — `cont` is a weak proxy.
export function earned(p: Partial<Post>): number {
  const likes = p.score || 0, reposts = p._reposts || 0, quotes = p._quotes || 0, replies = p.replies || 0;
  const eng = Math.min(1, Math.log10(likes + reposts * 2 + 10) / 4);          // ~1.0 around 10k
  const cont = Math.min(1, (replies + quotes * 2) / Math.max(25, likes * 0.15)); // argument proxy (weak)
  const base = eng * 0.6 + cont * 0.4;
  return Math.max(0, Math.min(1, p._wire ? base * 0.45 : base));
}

// Ids from the most recent explicit refresh. Non-null for exactly one ordering pass.
let _refreshBoost: Set<string> | null = null;
export function setRefreshBoost(ids: Set<string> | null): void { _refreshBoost = ids; }

export const BIO_TAGS = ['theology', 'AI', 'resistance', 'surveillance', 'warfare', 'power', 'philosophy', 'geopolitics', 'deception', 'identity', 'graphic', 'animals', 'nature', 'crisis'];

export const BIO = {
  tags: Object.fromEntries(BIO_TAGS.map(t => [t, 0])) as Record<string, number>,
  totalDwell: 0, totalViewed: 0, score: 0,
  sessions: {} as Record<string, number>,
  regions: {} as Record<string, number>,
  formats: {} as Record<string, number>,
  dirty: false,
  /** Set when learning happened while the profile's interest map was off screen. */
  mapDirty: false,
  affect: null as unknown,
  /** Native AffectState hook (web: window.__VOID_AFFECT__). Stored only. */
  setAffect(state: unknown) { this.affect = state && typeof state === 'object' ? state : null; },
  recordDwell(id: string, ms: number, tags?: string[]) {
    this.sessions[id] = (this.sessions[id] || 0) + ms; this.totalDwell += ms; this.totalViewed++;
    const w = Math.min(ms / 2000, 1.5);
    (tags || []).forEach(t => { if (this.tags[t] !== undefined) this.tags[t] = Math.min(100, this.tags[t] + w * 8); });
    this.score = Math.min(100, this.score + w * 3); this.dirty = true; this.mapDirty = true;
  },
  react(id: string, type: string, tags?: string[]) {
    const w = ({ fire: 15, rank: 10, slash: 5 } as Record<string, number>)[type] || 5;
    (tags || []).forEach(t => { if (this.tags[t] !== undefined) this.tags[t] = Math.min(100, this.tags[t] + w); });
    this.score = Math.min(100, this.score + w / 2); this.dirty = true; this.mapDirty = true;
  },
  /** Web: every 5s. */
  /** Interests the reader chose outright (Jump In "Ignite"). Learned weight decays
   *  as always; a chosen one never decays below its floor, so an explicit pick
   *  isn't forgotten ~12 minutes into the first session. Empty = web behaviour. */
  floors: {} as Record<string, number>,
  decay() { Object.keys(this.tags).forEach(t => { this.tags[t] = Math.max(this.floors[t] || 0, this.tags[t] * .995); }); },
  bumpRegion(country: string | undefined, w: number) { if (!country) return; this.regions[country] = Math.min(100, (this.regions[country] || 0) + w); this.dirty = true; },
  bumpFormat(style: string | undefined, w: number) { if (!style) return; this.formats[style] = Math.min(100, (this.formats[style] || 0) + w); this.dirty = true; },
  /** Web: idle flush every 15s + pagehide/visibilitychange. */
  save() { if (!this.dirty) return; this.dirty = false; try { env.storage.setItem('void_bio', JSON.stringify({ tags: this.tags, regions: this.regions, formats: this.formats, score: this.score, floors: this.floors })); } catch { /* */ } },
  load() { try { const d = JSON.parse(env.storage.getItem('void_bio') || 'null'); if (d) { Object.assign(this.tags, d.tags || {}); this.regions = d.regions || {}; this.formats = d.formats || {}; this.score = d.score || 0; this.floors = d.floors || {}; } } catch { /* */ } },
  /** Interest-map classes for the profile screen (web _update()). */
  interestMap(): Array<{ tag: string; level: 'hot' | 'warm' | 'cold' }> {
    this.mapDirty = false;
    return Object.entries(this.tags).map(([t, v]) => ({ tag: t, level: v > 50 ? 'hot' : v > 20 ? 'warm' : 'cold' }));
  },
  rankScore(p: Partial<Post>): number {
    // 'crisis' starts at 0 for everyone, so a disaster report would score nothing
    // for exactly the users who most want tension. It inherits 60% of the reader's
    // strongest tension affinity until it has its own.
    const tenseAff = () => Math.max(0, ...[...TENSION_TAGS].filter(t => t !== 'crisis').map(t => this.tags[t] || 0));
    const tag = (p.tags || []).reduce((s, t) => s + (t === 'crisis' ? Math.max(this.tags.crisis || 0, 0.6 * tenseAff()) : (this.tags[t] || 0)), 0);
    const reg = this.regions[p.country as string] || 0;
    const fmt = this.formats[p.style as string] || 0;
    const now = env.now();
    const ageH = Math.max(0, (now - (p.time || now)) / 3600000);
    const fresh = Math.exp(-ageH / 18) * 40;             // recency, ~18h decay
    const pop = Math.log10((p.score || 0) + 10) * 6;     // popularity, log-damped
    // On an explicit refresh, everything that just arrived is lifted above
    // everything already held — a presentation rule for one pass only.
    const refreshLift = (_refreshBoost && _refreshBoost.has(p.id as string)) ? 1e4 : 0;
    return tag * 1.0 + reg * 0.6 + fmt * 0.4 + fresh + pop + (p._social ? 8 : 0) + textFit(p)
      + breakingLift(p) + controversyLift(p) + refreshLift;
  },
  /** Test/reset: zero every learned weight. */
  reset() { for (const t of BIO_TAGS) this.tags[t] = 0; this.regions = {}; this.formats = {}; this.floors = {}; this.score = 0; this.totalDwell = 0; this.totalViewed = 0; this.sessions = {}; this.dirty = false; },
};
BIO.load();
onConfigure(() => { BIO.reset(); BIO.load(); });

/** Dwell learning as setupDwellTracking did it: ignore < 500ms, weight by time. */
export function learnDwell(post: Post, ms: number): void {
  if (!post || ms <= 500) return;
  const w = Math.min(ms / 2000, 1.5);
  BIO.recordDwell(post.id, ms, post.tags); BIO.bumpRegion(post.country, w * 4); BIO.bumpFormat(post.style, w * 3);
}
/** Reaction learning as react() did it — only when the reaction turns ON. */
export function learnReact(post: Post | undefined, id: string, type: 'fire' | 'rank' | 'slash'): void {
  BIO.react(id, type, (post && post.tags) || []);
  if (post) { BIO.bumpRegion(post.country, 8); BIO.bumpFormat(post.style, 6); }
}
