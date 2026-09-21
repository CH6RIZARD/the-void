// Ignite → the ranker. Picks land in the same BIO weights that bolts and dwell
// train, so the first feed is already leaning the way the reader asked.
//
// Topic → tag map. Every tag is in inferTags' vocabulary; tags outside BIO_TAGS
// (music, food, climate, culture) are created here, since BIO.react only raises tags
// that already exist. "Night" has no tag or signal to point at: it is kept with the
// picks and left out of the ranking rather than faked onto something else.
import { BIO, env } from '../../core';
import { flushWrites } from '../../lib/core';
import type { Topic } from './copy';
import type { LivePlace } from './places';

const TOPIC_TAGS: Record<Topic, string[]> = {
  'Live streams': [],
  Breaking: ['crisis'],
  Streets: ['culture'],
  Music: ['music'],
  Conflict: ['warfare', 'geopolitics'],
  Weather: ['climate', 'nature'],
  Food: ['food'],
  Faith: ['theology'],
  Protest: ['resistance', 'power'],
  Night: [],
};

// A pick weighs two bolts (react 'fire' = +15 per tag). Places weigh more: region
// weights never decay, but tag weights lose half every ~12 min of use (decay()),
// so a strong start is what survives into the first real session.
const TAG_SEED = 30;
const REGION_SEED = 40;
const VIDEO_SEED = 25;

export const PICKS_KEY = 'void_onboard_picks';

export function seedFeed(topics: Topic[], places: LivePlace[]): void {
  for (const topic of topics) {
    for (const tag of TOPIC_TAGS[topic] || []) BIO.tags[tag] = Math.min(100, (BIO.tags[tag] || 0) + TAG_SEED);
  }
  if (topics.includes('Live streams')) BIO.bumpFormat('video', VIDEO_SEED);
  for (const p of places) BIO.bumpRegion(p.country, REGION_SEED);
  BIO.dirty = true;
  BIO.mapDirty = true;
  BIO.save();
  try {
    env.storage.setItem(PICKS_KEY, JSON.stringify({ topics, places: places.map((p) => p.country), at: Date.now() }));
  } catch {}
  flushWrites().catch(() => {});
}
