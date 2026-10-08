// Shapes exactly as void2-final.html builds and reads them. Underscore fields are
// the app's own annotations on upstream items; they are NOT renamed, because every
// screen, the ranker and the dedupe keys read them by these names.

export type PostStyle = 'take' | 'image' | 'carousel' | 'video' | 'audio' | 'drop' | 'quiet' | 'link_live' | 'link_thread';

export type SourceName = 'bluesky' | 'reddit' | 'mastodon' | 'lemmy' | 'peertube' | 'radio' | 'archive' | 'commons'
  | 'news' | 'void' | 'twitter' | 'telegram' | 'forum' | string;

export interface Provenance {
  sourceHost: string;
  /** Proxy items only: proxyPostToApp refuses an item without it. */
  responseHash?: string;
  [k: string]: unknown;
}

export interface Post {
  id: string;
  style: PostStyle | string;
  body: string;
  tags: string[];
  score: number;
  replies: number;
  time: number;
  source: SourceName;
  country: string;
  iso: string;

  _author?: string;
  _handle?: string;
  _authorId?: string | null;
  author_id?: string;
  _img?: string;
  _imgs?: string[];
  _video?: string;
  _audio?: string;
  _audioDur?: number;
  _dur?: number;
  _desc?: string;
  _url?: string;
  sourceUrl?: string;
  _link?: string;
  _uri?: string;
  _social?: boolean;
  _graphic?: boolean;
  /** Curated lane (proxy /curated): the curator's caption, 0-1 fit and genre. */
  _caption?: string;
  _fit?: number;
  _genre?: string;
  _wire?: boolean;
  _repost?: boolean;
  _reposts?: number;
  _quotes?: number;
  reposts?: number;
  views?: number;
  _live?: boolean;
  provenance?: Provenance;
  imgHue?: number;

  // region stamping (stampRegion)
  _region?: string;
  _regionName?: string;
  _regionCustom?: boolean;
  _regionParent?: string;
  _lat?: number;
  _lon?: number;

  // nation pane
  _nation?: string;
  _offFeed?: boolean;
  /** Profile REPLIES tab: the post this one answers (handle is '@'-prefixed). */
  _replyTo?: { id: string; handle: string; body: string };
  _seenBefore?: boolean;
  _nrel?: number;
  _nfsrc?: string;

  // fediverse reply lookups
  _mastoId?: string;
  _mastoHost?: string;
  _lemmyId?: number;
  _lemmyHost?: string;

  // story / breaking annotations (noteStory, orderFeedBatch)
  _story?: string;
  _storyBase?: string;
  _storyTok?: string[];
  _boostSlot?: boolean;
  _noBoost?: boolean;

  // Void-native drops
  _user?: boolean;
  _sb?: boolean;
  _pending?: boolean;
  /** This device just posted it: its media dissolves in over the upload loader. */
  _landed?: boolean;
  _pendingKind?: 'text' | 'image' | 'video' | 'audio';
  _isoColor?: string;
  _filler?: boolean;

  // reels
  _vid?: string;
}

export type StreamType = 'youtube' | 'hls' | 'mjpeg' | 'iframe';

/** A stream descriptor: { type, url|id, label }. youtube id = 11-char video, UC.. channel, or PL/UU/OLAK playlist. */
export interface StreamSource {
  type: StreamType | string;
  id?: string;
  url?: string;
  vid?: string;
  label?: string;
  /** LIFE pool: 'walk' | 'life' | 'livecam' */
  kind?: string;
  thumbnail?: string;
  poster?: string;
  posterUrl?: string;
  category?: string;
  fallback?: string;
  _tier?: string;
  cascade?: StreamSource[];
  sources?: StreamSource[];
  [k: string]: unknown;
}

export interface WallSlot { name: string; src: StreamSource; kind: 'life' | 'news'; }

export interface Country { n: string; lat: number; lon: number; sr: string | null; iso: string; _nre?: RegExp; }

export type RegionAlias = string | { code: string; custom?: boolean; lat?: number; lon?: number; parent?: string };

export interface Region {
  code: string;
  name: string;
  lat: number;
  lon: number;
  custom: boolean;
  parent?: string | null;
}

export interface Comment {
  id: string;
  author: string;
  handle: string;
  text: string;
  time: number;
  bolts: number;
  parentId: string | null;
  remote?: boolean;
  img?: string;
  authorId?: string | null;
  mine?: boolean;
  remoteId?: string;
}

export interface LiveChannel { n: string; id: string; vid?: string; }

export interface NationRankItem {
  kind: 'stream' | 'post' | 'about';
  live: boolean;
  title: string;
  country: string;
  iso: string;
  src?: StreamSource;
  post?: Post;
  _s: number;
}

/** Supabase region_view(target_code) response. */
export interface RegionView {
  region?: any;
  places?: Array<{ name: string; kind: string; stream_url: string; [k: string]: unknown }>;
  topics?: any[];
  posts?: Array<{ id: string; author_id?: string; body: string; rank_score?: number; created_at?: string; region_code?: string; reply_to?: string | null }>;
}

export interface ApiResult { ok: boolean; local?: boolean; [k: string]: any; }
