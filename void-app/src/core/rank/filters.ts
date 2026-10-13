// Feed intent gates: no news orgs, no wire copy, muted subjects, adaptive animal
// suppression, and the reels-only blocks.
import { env, onConfigure } from '../env.ts';
import type { Post } from '../types.ts';
import { BIO } from './bio.ts';
import { _h, _normText, admitPost } from './seen.ts';
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

// ─── NO VOICE ───────────────────────────────────────────────────────────
// Posts that carry a topic word but nobody saying anything: whats-hot's content farms
// and the bots in the topical feeds. Live 2026-10-11, ~15 of the 21 whats-hot posts the
// gate admitted were these, in on one incidental range word ("#photography" -> art,
// "Church" -> theology, "Museum" -> culture):
//  - credit lines: a famous poem over someone else's painting signed "🎨 <painter>",
//    Wikipedia bird facts with "📸: @someone" / "Photo by X on Wikimedia Commons";
//  - encyclopedia copy: a species' binomial in brackets, "(Netta rufina)";
//  - scheduled hashtag games: #WildflowerHour, #Haiku, #Poetry, #OnThisDay, #photomo25;
//  - hashtag stuffing: a caption buried under tags ("#fall #nature #trees #travel ...");
//  - bot templates: "Now Playing", "Read More", "Source: @Reuters on X", scanner logs.
export const NV_CREDIT = /(?:^|[\s(])(?:📸|📷|🎨)\s*(?:[:：]\s*)?(?:@\w|\p{Lu})|\b(?:photo|image|picture|painting|artwork)s?\s+(?:by|courtesy of)\s+\p{Lu}|\bphoto\s*:\s*(?:@\w|\p{Lu})|\b(?:photo|image)\s*credit\b|\bwikimedia\b/mu;
// "(Netta rufina)" alone is not enough - "(Jewish nationalism)" has the same shape - so
// the binomial counts only beside field-guide words.
export const NV_BINOMIAL = /\(\p{Lu}[a-z]+ [a-z]{4,}(?:\)| ')/u;
export const NV_FIELD_GUIDE = /\b(?:species|subspecies|genus|native to|endemic|habitat|scientific name|shrub|perennial|bird|duck|fish|plant|flower|moth|butterfly|beetle|spider|squid|octopus|whale|frog|snake|lizard|mammal)s?\b/i;
export const NV_GAME = /#(?:\w*hour|poetry|haiku|poem\w*|photomo\d*|dailyphoto\w*|photooftheday|\w*challenge|onthisday|thisdayinhistory|bloomscrolling|womensart|fridayflowers|caturday)\b/i;
export const NV_BOT = /\bnow playing\b|\btune in at\b|\bread (?:more|full)\b|\|\s*units:|⟶|^📰|\bsource:\s*@\S+ on x\b/im;
export function isNoVoice(p: Partial<Post>): boolean {
  const t = String(p.body || '');
  if (NV_CREDIT.test(t) || (NV_BINOMIAL.test(t) && NV_FIELD_GUIDE.test(t)) || NV_GAME.test(t) || NV_BOT.test(t)) return true;
  // Tags under a real paragraph are a person filing their post; tags over a caption are not.
  const tags = t.match(/#[\p{L}\p{N}_]+/gu) || [];
  if (tags.length >= 8) return true;
  return tags.length >= 3 && t.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().length < 140;
}

// ─── SLOP ───────────────────────────────────────────────────────────────
// No-voice catches bots and farms by shape; this catches the rest of the soulless
// stuff by what it says: AI filler ("in today's fast-paced world", "let's dive in"),
// engagement bait ("drop a 🔥 if", "follow for more"), sales spam and hustle/rage
// hooks. Two layers:
//  1. slopScore(): a fast phrase/shape score, 0..1. >= SLOP_HARD is refused outright.
//  2. SLOP_VERDICTS: what the local LLM said about the borderline ones. The curator
//     (scripts/curator.mjs, Ollama on the user's PC) scores them and pushes
//     {k: slopKey, s: 0..1} to the proxy's /slop; the app pulls that and refuses
//     s >= SLOP_LLM. Keyed by normalised text, so the same words posted anywhere
//     share one verdict.
export const SLOP_FILLER = /\bin today'?s (?:fast[- ]paced|digital|ever[- ]changing|modern) world\b|\blet'?s dive in\b|\bdelve\b|\btapestry\b|\bgame[- ]?changer\b|\bunlock (?:your|the) (?:full |true )?potential\b|\bembrace the (?:journey|process)\b|\ba testament to\b|\bnavigat\w* the (?:complexit|landscape)\w*|\bit'?s not just (?:a|an|about) [^,.]{1,40}, it'?s\b|\belevate your\b|\bin conclusion\b|\bkey takeaways?\b|\bstay tuned\b|\blevel up your\b/i;
export const SLOP_BAIT = /\bfollow (?:me )?for more\b|\blike (?:and|&) (?:share|retweet|repost|follow)\b|\b(?:repost|retweet|rt|share|like) (?:this )?if (?:you|u)\b|\bdrop an? \S+ (?:if|below|in the)\b|\bcomment below\b|\btag (?:someone|a friend)\b|\bwho else\b[^?\n]*\?|^(?:agree|thoughts|am i wrong|right)\s*\?\s*$|\blink in (?:my )?bio\b|\bgiveaway\b|👇/imu;
export const SLOP_SPAM = /\b(?:promo|discount|coupon) code\b|\buse (?:my )?code\b|\b\d{2}% off\b|\bbuy now\b|\blimited time offer\b|\bairdrop\b|\bonlyfans\b|\bcheck out my (?:shop|store|page|channel|link)\b|\bpassive income\b|\bdm (?:me )?(?:for|to) (?:collab|promo|price)/i;
export const SLOP_HYPE = /#(?:motivation\w*|mindset|hustle\w*|grindset|entrepreneur\w*|quoteoftheday|successmindset)\b|\brise and grind\b|\bnever give up\b|\byou won'?t believe\b|\bnobody is talking about\b|\bthey don'?t want you to know\b|\bwake up,? (?:people|sheeple)\b/i;
export const SLOP_HARD = 0.7, SLOP_LLM = 0.6;
export function slopScore(p: Partial<Post>): number {
  const t = String(p.body || '');
  if (!t) return 0;
  let s = 0;
  if (SLOP_FILLER.test(t)) s += 0.45;
  const bait = (t.match(new RegExp(SLOP_BAIT.source, 'gimu')) || []).length;   // each extra bait line adds up
  if (bait) s += 0.25 + 0.25 * bait;
  if (SLOP_SPAM.test(t)) s += 0.7;
  if (SLOP_HYPE.test(t)) s += 0.45;
  const letters = t.replace(/[^\p{L}]/gu, ''), caps = letters.replace(/[^\p{Lu}]/gu, '').length;
  if (letters.length >= 24 && caps / letters.length > 0.6) s += 0.3;   // shouting hook
  const emoji = (t.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (emoji >= 5 && emoji / t.length > 0.04) s += 0.3;                // emoji wall
  if ((t.match(/!/g) || []).length >= 4) s += 0.2;
  return Math.min(1, s);
}
export const SLOP_VERDICTS = new Map<string, number>();
export function slopKey(p: Partial<Post>): string { return _h(_normText(p.body).slice(0, 280)); }
export function setSlopVerdicts(items: unknown): void {
  SLOP_VERDICTS.clear();
  for (const it of Array.isArray(items) ? items : []) if (it && it.k) SLOP_VERDICTS.set(String(it.k), Math.max(0, Math.min(1, +it.s || 0)));
}
/** Settings → Hide slop. On unless turned off. */
export function hideSlop(): boolean { try { return env.storage.getItem('void_hide_slop') !== '0'; } catch { return true; } }
export function setHideSlop(on: boolean): void { try { env.storage.setItem('void_hide_slop', on ? '1' : '0'); } catch { /* */ } }
export function isSlop(p: Partial<Post>): boolean {
  if (!hideSlop() || !p.body) return false;
  if (slopScore(p) >= SLOP_HARD) return true;
  const v = SLOP_VERDICTS.get(slopKey(p));
  return v !== undefined && v >= SLOP_LLM;
}

/**
 * The feed's intent gate. Returns '' to admit, otherwise the refusal reason.
 * BREAKING EXEMPTION: the first, most-shared reports of a tragedy ARE outlet posts
 * (Nepal flood: 10/20 real reports were refused by the wire rules alone). A
 * crisis/graphic post at >= BREAKING_MIN_V passes — at most STORY_EXEMPT_CAP per
 * story — and is still demoted as wire by textFit/earned once admitted.
 */
export function feedGate(p: Post): '' | 'empty' | 'meta' | 'no-tags' | 'no-voice' | 'slop' | 'news-account' | 'article-drop' | 'muted' | 'animal' | 'dedupe' {
  if (!(p.body || p._img || p._video)) return 'empty';
  if (isFeedMeta(p.body)) return 'meta';             // feed-operator housekeeping
  if (!p.tags.length) return 'no-tags';              // no topical signal => not this app's content
  noteStory(p);                                      // corroboration counts even if refused below
  const st = storyOf(p);
  const exempt = isBreaking(p) && (!st || st.exempt < STORY_EXEMPT_CAP);
  if (isNoVoice(p)) return 'no-voice';               // content farm / bot, not a person talking
  if (isSlop(p)) return 'slop';                      // AI filler, bait, spam (phrases + the local LLM's verdicts)
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
// porn/sexual labels; the Twitch feed is an open submission hashtag). gore and
// graphic-media are NOT here: that is the news footage reels exist for, and
// bskyToPost marks it _graphic so the veil covers it instead of it vanishing.
export const REEL_BLOCK_LABELS = /porn|sexual|nudity|nsfw|self-harm/i;
// Accounts that asked not to be shown logged-out. 38% of one feed carried this.
export const REEL_BLOCK_AUTHOR_LABELS = /!no-unauthenticated/i;
// Pet/wildlife is the biggest diluter of the high-energy reels surface. Reels rule
// only. Words, then EMOJI ("another Sammy 🐈‍⬛️ sighting" has no animal word).
export const REEL_BLOCK_TOPIC_WORDS = /\b(cat|cats|kitten|kitty|catto|dog|dogs|doggo|puppy|pupper|hedgehog|hoglet|squirrel|bunny|rabbit|hamster|guinea pig|parrot|budgie|meow|purr|caturday|petsky|toe.?beans?|zoomies|birdwatch\w*|aquarium|zoo)\b/i;
export const REEL_BLOCK_TOPIC_EMOJI = /[\u{1F400}-\u{1F43F}\u{1F980}-\u{1F9AE}]|\u{1F408}|\u{1F415}|\u{1F43E}|\u{1F98A}|\u{1F994}|\u{1F99C}/u;
// Drawn and furry art is the other diluter: reels is real footage. Built from a live
// sample of the reel feeds (2026-10-04), where half of what the backbone feed admitted
// was speedpaints, animatics and furry art: it caught 60 of 60 hand-identified art
// clips with 1 false positive in 48, and 0 of 444 posts from the topical feeds.
//  - left half: words that only ever mean drawn / furry art, anywhere in the text;
//  - right half: ambiguous stems that count ONLY as a hashtag (#art, #painting, any
//    #...animation...), where the author is filing the post under art.
// Bare art / artwork / animation / drawn / sketch are deliberately absent: "The Art Of
// The Grift", "Occupation & Artwork", "Réanimation" and a comedy sketch are real footage.
export const REEL_BLOCK_ART = /\b(?:furr(?:y\w*|ies)|fursuit\w*|fursona\w*|anthro|kemono|protogen|hand[- ]?drawn|fan ?arts?|pixel ?art|digital ?art(?:ists?|works?)?|watercolou?rs?|speedpaint\w*|animatics?|anime|cartoons?)\b|#(?:\w*animation\w*|art|artsky|myart|ocart|artwork\w*|illustration\w*|drawing\w*|painting\w*)\b/i;
export const REEL_BLOCK_TOPIC = { test: (t: string) => REEL_BLOCK_TOPIC_WORDS.test(t) || REEL_BLOCK_TOPIC_EMOJI.test(t) || REEL_BLOCK_ART.test(t) };
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
