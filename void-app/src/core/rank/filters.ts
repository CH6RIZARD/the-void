// Feed intent gates: no news orgs, no wire copy, muted subjects, adaptive animal
// suppression, and the reels-only blocks.
import { env, onConfigure } from '../env.ts';
import type { Post } from '../types.ts';
import { BIO } from './bio.ts';
import { admitPost } from './seen.ts';
import { STORY_EXEMPT_CAP, isBreaking, noteStory, storyOf } from './story.ts';

// ─── ANIMAL / FLUFF SUPPRESSION (adaptive) ──────────────────────────────
// Pet/wildlife content is suppressed in the FEED by default — not banned:
//  1. detection is multilingual (a Japanese birdwatching post got through on 'nature');
//  2. suppression lifts once BIO.tags.animals shows real interest;
//  3. a 1-in-8 TRICKLE always passes, or affinity could never build.
export const ANIMAL_WORDS = /\b(cat|cats|kitten|kitty|catto|dog|dogs|doggo|puppy|pupper|pet|pets|hedgehog|hoglet|squirrel|bunny|rabbit|hamster|parrot|budgie|kingfisher|bird|birds|birding|birdwatch\w*|wildlife|meow|purr|caturday|zoomies|toe.?beans?|aquarium|zoo)\b/i;
// 野鳥 wild bird · 鳥 bird · 猫 cat · 犬 dog · 動物 animal · ペット pet · カワセミ kingfisher
export const ANIMAL_CJK = /野鳥|カワセミ|動物|ペット|[猫犬鳥]/;
export const ANIMAL_EMOJI = /[\u{1F400}-\u{1F43F}\u{1F980}-\u{1F9AE}]/u;
export function isAnimalPost(p: Partial<Post>): boolean {
  const t = String(p.body || '');
  return ANIMAL_WORDS.test(t) || ANIMAL_CJK.test(t) || ANIMAL_EMOJI.test(t) ||
    (Array.isArray(p.tags) && p.tags.includes('animals'));
}
// BIO.tags rise ~8/dwell and ~15/react and decay 0.5%/5s, so ~35 means several
// deliberate engagements, not one stray scroll.
export const ANIMAL_UNLOCK = 35;
export function animalSuppressed(p: Partial<Post>): boolean {
  if (!isAnimalPost(p)) return false;
  if ((BIO.tags.animals || 0) >= ANIMAL_UNLOCK) return false;   // they are in fact a fiend
  return env.random() > 0.125;                                  // 1-in-8 trickle
}

// ─── NO NEWS ORGS, NO WIRE COPY ─────────────────────────────────────────
// This app is raw speech from PEOPLE. Outlets authenticate their Bluesky handle as
// their own domain; people sit on *.bsky.social. REPOSTS ARE EXEMPT: a person
// choosing to re-surface a story is speech. A news org is welcome by making an
// actual VOID account (void_native_accounts allowlist).
export const VOID_NATIVE = new Set<string>();
function loadNative() { VOID_NATIVE.clear(); try { (JSON.parse(env.storage.getItem('void_native_accounts') || '[]') as string[]).forEach(h => VOID_NATIVE.add(h)); } catch { /* */ } }
loadNative();
export function isNewsAccount(p: Partial<Post>): boolean {
  if (p._repost) return false;                       // a person chose to surface it
  const h = String(p._handle || '').replace(/^@/, '').toLowerCase();
  if (!h) return false;
  if (VOID_NATIVE.has(h)) return false;              // made an actual VOID account
  return !!p._wire;
}
// A headline plus a link is a distribution artifact, not speech; a real take ABOUT
// a link is fine — hence the threshold is on how much they wrote.
export function isArticleDrop(p: Partial<Post>): boolean {
  if (p._repost) return false;
  const body = String(p.body || '').trim();
  if (!p._link) return false;
  return body.length < 200;
}

// ─── MUTED SUBJECTS ─────────────────────────────────────────────────────
// Hard mute, persisted, editable at runtime. Default 'trump' — 43% of one live batch.
export const MUTED = new Set<string>();
const MUTE_RE = () => [...MUTED].map(m => new RegExp('\\b' + m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
let _muteRe: RegExp[] = [];
function loadMuted() {
  MUTED.clear();
  try { (JSON.parse(env.storage.getItem('void_muted') || '["trump"]') as string[]).forEach(m => MUTED.add(m)); } catch { MUTED.add('trump'); }
  _muteRe = MUTE_RE();
}
loadMuted();
onConfigure(() => { loadMuted(); loadNative(); });
export function isMuted(p: Partial<Post>): boolean {
  if (!MUTED.size) return false;
  const t = String(p.body || '');
  return _muteRe.some(re => re.test(t));
}
export function voidMute(term: string): void {
  MUTED.add(String(term).toLowerCase()); _muteRe = MUTE_RE();
  try { env.storage.setItem('void_muted', JSON.stringify([...MUTED])); } catch { /* */ }
}
export function voidUnmute(term: string): void {
  MUTED.delete(String(term).toLowerCase()); _muteRe = MUTE_RE();
  try { env.storage.setItem('void_muted', JSON.stringify([...MUTED])); } catch { /* */ }
}

// Feed-generator operators pin housekeeping posts to their own feed. Not content.
export function isFeedMeta(t: unknown): boolean { return /PINNED POST|graze\.social|remixing the .{0,20}feed|feed info/i.test(String(t || '')); }

/**
 * The feed's intent gate. Returns '' to admit, otherwise the refusal reason.
 * BREAKING EXEMPTION: the first, most-shared reports of a tragedy ARE outlet posts
 * (Nepal flood: 10/20 real reports were refused by the wire rules alone). A
 * crisis/graphic post at >= BREAKING_MIN_V passes — at most STORY_EXEMPT_CAP per
 * story — and is still demoted as wire by textFit/earned once admitted.
 */
export function feedGate(p: Post): '' | 'empty' | 'meta' | 'no-tags' | 'news-account' | 'article-drop' | 'muted' | 'animal' | 'dedupe' {
  if (!(p.body || p._img || p._video)) return 'empty';
  if (isFeedMeta(p.body)) return 'meta';             // feed-operator housekeeping
  if (!p.tags.length) return 'no-tags';              // no topical signal => not this app's content
  noteStory(p);                                      // corroboration counts even if refused below
  const st = storyOf(p);
  const exempt = isBreaking(p) && (!st || st.exempt < STORY_EXEMPT_CAP);
  if (isNewsAccount(p) && !exempt) return 'news-account';
  if (isArticleDrop(p) && !exempt) return 'article-drop';
  if (isMuted(p)) return 'muted';
  if (animalSuppressed(p)) return 'animal';
  if (!admitPost(p)) return 'dedupe';
  if (st && (isNewsAccount(p) || isArticleDrop(p))) st.exempt++;
  return '';
}

// ─── REELS GATES ────────────────────────────────────────────────────────
// Moderation labels that must never reach a reel (~2% of the wrestling feeds carry
// porn/sexual labels; the Twitch feed is an open submission hashtag).
export const REEL_BLOCK_LABELS = /porn|sexual|nudity|nsfw|gore|graphic-media|self-harm/i;
// Accounts that asked not to be shown logged-out. 38% of one feed carried this.
export const REEL_BLOCK_AUTHOR_LABELS = /!no-unauthenticated/i;
// Pet/wildlife is the biggest diluter of the high-energy reels surface. Reels rule
// only. Words, then EMOJI ("another Sammy 🐈‍⬛️ sighting" has no animal word).
export const REEL_BLOCK_TOPIC_WORDS = /\b(cat|cats|kitten|kitty|catto|dog|dogs|doggo|puppy|pupper|hedgehog|hoglet|squirrel|bunny|rabbit|hamster|guinea pig|parrot|budgie|meow|purr|caturday|petsky|toe.?beans?|zoomies|birdwatch\w*|aquarium|zoo)\b/i;
export const REEL_BLOCK_TOPIC_EMOJI = /[\u{1F400}-\u{1F43F}\u{1F980}-\u{1F9AE}]|\u{1F408}|\u{1F415}|\u{1F43E}|\u{1F98A}|\u{1F994}|\u{1F99C}/u;
export const REEL_BLOCK_TOPIC = { test: (t: string) => REEL_BLOCK_TOPIC_WORDS.test(t) || REEL_BLOCK_TOPIC_EMOJI.test(t) };
/** Label gate for a raw Bluesky feed item: post labels AND the author's. */
export function reelBlocked(item: any): boolean {
  const post = (item && item.post) || {};
  const pl = [...(post.labels || []), ...(((post.record || {}).labels || {}).values || [])]
    .map((l: any) => String((l && l.val) || ''));
  if (pl.some(v => REEL_BLOCK_LABELS.test(v))) return true;
  const al = ((post.author || {}).labels || []).map((l: any) => String((l && l.val) || ''));
  if (al.some((v: string) => REEL_BLOCK_LABELS.test(v) || REEL_BLOCK_AUTHOR_LABELS.test(v))) return true;
  return false;
}
