// THE VOID — platform-independent logic core, ported from void2-final.html.
// Call configureCore({ storage, session, fetch, ... }) once at boot, then initAuth().
export * from './env.ts';
export type * from './types.ts';
export * from './util.ts';

export * from './data/regions.ts';
export * from './data/sources.ts';
export { NATION_VOCAB } from './data/nationVocab.generated.ts';

export * from './streams/keys.ts';
export * from './streams/wall.ts';
export * from './streams/nation.ts';
export * from './streams/frame.ts';
export * from './streams/probe.ts';

export * from './rank/tags.ts';
export * from './rank/seen.ts';
export * from './rank/story.ts';
export * from './rank/bio.ts';
export * from './rank/filters.ts';
export * from './rank/order.ts';
export * from './rank/nation.ts';

export * from './feed/store.ts';
export * from './feed/bluesky.ts';
export * from './feed/reddit.ts';
export * from './feed/proxy.ts';
export * from './feed/gdelt.ts';
export * from './feed/fedi.ts';
export {
  nationVocab, nationTerms, nationMentionRe, nationNamed, nationIsLocal, nationRelevance,
  createNationFeed, nationFeedSupabase, nationFeedGdelt, nationFeedMastodon, nationFeedLemmy, nationFeedPeertube,
  nationFeedRadio, nationFeedArchive, nationFeedCommons, NF_RADIO_HOSTS, nfGroup, NF_GAP, NF_RETRY,
  NF_METAR_RE, NF_PER_AUTHOR, nfShape, nfSpam, nfKmFrom,
  nationFeedPoolAdd, nationFeedHoldMs, nationFeedDeal, nationFeedPull, nationFeedRetryNow, nationFeedOnScroll, closeNationFeed,
} from './feed/nation.ts';
export type { NationFeedState, NationFeedUI } from './feed/nation.ts';
export * from './feed/reels.ts';
export * from './feed/search.ts';
export * from './feed/voidFeed.ts';

export * from './api/voidApi.ts';
export * from './api/auth.ts';
export * from './api/replies.ts';
export * from './api/media.ts';
export * as moderation from './api/moderation.ts';
