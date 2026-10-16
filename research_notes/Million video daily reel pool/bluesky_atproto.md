# Sourcing short-form video from Bluesky / AT Protocol (as of 2026-10-11)

Scope: every no-login (or free app-password) way to pull playable video posts from Bluesky; what media comes back; rate limits; network volume; feed discovery; legal; a Jetstream consumer recipe; and what a tiny Node proxy can realistically ingest. Live measurements below were taken on Sunday 2026-10-11 ~19:25-19:35 UTC from a US residential IP with curl / Node 25 / Python 3.12; they are single snapshots, not averages.

## Key Question 1: Total Bluesky video posts per day in 2026

### Takeaway
No official video-only count exists. A live 90-second Jetstream sample on 2026-10-11 extrapolates to roughly 3.7M posts/day of which ~97k (~2.6%) carry a native `app.bsky.embed.video` embed; the only official 2025 figure is 1.41B posts for the year (~3.86M/day), with third-party summaries citing 235M "media" posts (images + video combined) for 2025.

### Cited Findings
- Live Jetstream sample (own measurement, 90 s, `collections=app.bsky.feed.post&kinds=commit`, jetstream.us-west): 4,002 messages, 3,841 post creates, 100 posts with `embed.$type == app.bsky.embed.video` plus 1 with video inside `app.bsky.embed.recordWithMedia`; 492 external-link embeds of which 69 pointed to YouTube/TikTok/Instagram-reel/Twitch. Extrapolated: ~3,687,000 posts/day, ~97,000 native video posts/day, ~3.7 GB/day raw JSON for all posts uncompressed — [Jetstream v2 endpoint used](https://bsky.network/docs/jetstream/) (measurement is mine; Sunday evening UTC, one window).
- Bluesky's 2025 transparency overview: users "created 1.41 billion posts" in 2025, "61% of all posts ever made on Bluesky"; users grew "from 25 million to 41 million" — [Bluesky blog, 29 Jan 2026](https://bsky.social/about/blog/01-29-2026-transparency-report-overview). The overview page itself contains no media/video breakdown.
- Third-party summaries of the full 2025 transparency report cite "235 million posts contained media" (62% of all media posts ever) — [SocialPilot](https://www.socialpilot.co/blog/bluesky-statistics/), [Marketful](https://marketful.com/bluesky-statistics); I could not confirm this sentence on Bluesky's overview page, so treat as secondary. 235M/365 ≈ 644k media posts/day (images + video), my arithmetic.
- Jaz's Sept 2024 Jetstream post: firehose went from ~24 GB/day to >232 GB/day after the Brazil surge; "Average event rate rose about 1,300%" — [jazco.dev](https://jazco.dev/2024/09/24/jetstream/) (2024 figures, pre-growth).
- Bluesky's official Jetstream announcement describes the firehose at "hundreds of events per second" and "over a thousand events per second" during surges (Oct 2024, dated) — [docs.bsky.app blog](https://docs.bsky.app/blog/jetstream).
- A worldmetrics page claims "1 million video uploads per day in 2024" for Bluesky; this is unsourced, implausible against the Jetstream sample, and should be disregarded — [worldmetrics](https://worldmetrics.org/bluesky-statistics/).

### Inferences
- ~100k native video posts/day is the right order of magnitude for Oct 2026 (sample taken at a quiet-ish hour; weekday US-evening peaks could be 1.5-2x). Not all are short-form or SFW: the top video feeds include several NSFW feeds, and GIF-presentation videos (`presentation: "gif"`) count as video embeds.
- A million-video daily pool cannot come from Bluesky alone; Bluesky can contribute low tens of thousands of fresh, filterable clips per day plus a back-catalog via feeds.

### Gaps
- No official video-only daily count; bsky.jazco.dev/stats rendered no numbers via fetch (JS app) and the Jetstream sample is one 90 s window. Run the consumer below for 24 h to get a real daily number.

## Key Question 2: Jetstream — endpoint, filtering, bandwidth, consumer code

### Takeaway
Jetstream v2 is a free, no-auth JSON WebSocket at `wss://jetstream.us-west.bsky.network/xrpc/network.bsky.jetstream.subscribeEvents` filtered by `collections=app.bsky.feed.post`; there is no server-side embed-type filter, so the client drops everything whose `record.embed.$type` isn't `app.bsky.embed.video`. Posts-only costs ~3.7 GB/day uncompressed (measured), ~850 MB/day with zstd (Jaz, 2024).

### Cited Findings
- v2 endpoints (recommended): `wss://jetstream.us-west.bsky.network` and `wss://jetstream.us-east.bsky.network`, path `/xrpc/network.bsky.jetstream.subscribeEvents`, subprotocol `xrpc.v1.json`; "No authentication is required for the live tail." — [Jetstream docs](https://bsky.network/docs/jetstream/)
- v1 (legacy) endpoints: `jetstream1.us-east`, `jetstream2.us-east`, `jetstream1.us-west`, `jetstream2.us-west.bsky.network`, path `/subscribe` — [Jetstream docs](https://bsky.network/docs/jetstream/); [jetstream-legacy README](https://github.com/bluesky-social/jetstream-legacy)
- v2 params: `collections` (NSIDs or wildcard like `app.bsky.feed.*`, repeatable), `dids` (repeatable), `kinds` (`commit|identity|account|sync`), `cursor` (seq or unix-µs). "A single subscription accepts up to 100 collections and 10,000 DIDs." Over-limit requests are rejected before upgrade. Delivery is at-least-once; replay via `?cursor=N` within a "bounded lookback window" (unquantified) — [Jetstream docs](https://bsky.network/docs/jetstream/)
- v1 params: `wantedCollections`, `wantedDids`, `cursor` (unix µs), `compress=true` (zstd, custom dictionary in `pkg/models/zstd_dictionary`, also via `Socket-Encoding: zstd` header), `maxMessageSizeBytes`, `requireHello`; zstd messages "~56% smaller on average than the raw JSON" — [jetstream-legacy README](https://github.com/bluesky-social/jetstream-legacy)
- v2 does not document `compress`/zstd; the official docs page lists no compression parameter — [Jetstream docs](https://bsky.network/docs/jetstream/). (Gap: whether v2 accepts `compress=true` is untested.)
- v2 message shape (observed live): `{"$type":"message","payload":{"$type":"network.bsky.jetstream.subscribeEvents#commit","cid":..,"collection":"app.bsky.feed.post","did":"did:plc:..","operation":"create","record":{...},"rev":..,"rkey":..,"seq":26876479215,"time":"2026-10-11T19:31:38.453485Z","witnessedAt":..}}` — own capture. v1 shape uses `time_us`, `kind`, `commit.{operation,collection,rkey,record,cid}` — [jetstream-legacy README](https://github.com/bluesky-social/jetstream-legacy)
- Video record inside a post (observed live): `embed: {"$type":"app.bsky.embed.video","aspectRatio":{"height":1080,"width":1920},"video":{"$type":"blob","mimeType":"video/mp4","ref":{"$link":"bafkrei..."},"size":5247376}}` — own capture. Note: the raw record has the blob CID, not a playlist URL; the HLS URL is derived (see KQ6).
- Bandwidth (Jaz, Sept 2024, dated): "Posts only, with zstd: about 25.5 GB/mo"; "Posts-only live tail: as little as about 850 MB/day"; all events zstd ~18 GB/day; average event 482 → 211 bytes with zstd; Jetstream "served about 200k events/sec to a local consumer"; the public instance ran "12 consumers on a $5/mo OVH VPS"; resident memory "under 16 MB" — [jazco.dev](https://jazco.dev/2024/09/24/jetstream/)
- Measured now: 3.82 MB of JSON in 90 s for all post commits ⇒ ~3.7 GB/day uncompressed (own measurement; network has grown since 2024).
- Official guidance: Jetstream is for "casual, low-stakes projects", "experimentation", "informal metrics", "developing new applications"; not for "mirroring, backups, archives", "who said what", "moderation", "research"; events lack "cryptographic signatures or Merkle tree nodes"; Jetstream is "not formally part of the protocol" with no long-term stability promise — [docs.bsky.app blog](https://docs.bsky.app/blog/jetstream)
- Client libs: `@skyware/jetstream` (per-collection `onCreate("app.bsky.feed.post", ...)`) — [npm](https://npmjs.com/package/@skyware/jetstream); `@atcute/jetstream` supports `wantedCollections` — [README](https://cdn.jsdelivr.net/npm/@atcute/jetstream@2.0.2/README.md)

### Minimal consumer (Node ≥22, no deps; this is the script I ran, trimmed)
```js
// video-tail.mjs — keep only native video posts, optional keyword filter
const KW = /\b(skate|cooking|anime)\b/i;           // topic filter; null = keep all
const url = 'wss://jetstream.us-west.bsky.network/xrpc/network.bsky.jetstream.subscribeEvents'
          + '?collections=app.bsky.feed.post&kinds=commit';
let ws, cursor;
function connect() {
  ws = new WebSocket(url + (cursor ? `&cursor=${cursor}` : ''), ['xrpc.v1.json']);
  ws.onmessage = ({ data }) => {
    const p = JSON.parse(data).payload; cursor = p.seq;
    if (p.operation !== 'create' || p.collection !== 'app.bsky.feed.post') return;
    const r = p.record, e = r.embed;
    const v = e?.$type === 'app.bsky.embed.video' ? e
            : e?.$type === 'app.bsky.embed.recordWithMedia' && e.media?.$type === 'app.bsky.embed.video' ? e.media : null;
    if (!v || v.presentation === 'gif' || r.reply) return;          // skip GIFs and replies
    if (KW && !KW.test(r.text || '')) return;
    const cid = v.video.ref.$link, base = `https://video.bsky.app/watch/${encodeURIComponent(p.did)}/${cid}`;
    emit({ uri: `at://${p.did}/app.bsky.feed.post/${p.rkey}`, did: p.did, text: r.text, langs: r.langs,
           aspect: v.aspectRatio, bytes: v.video.size, playlist: `${base}/playlist.m3u8`, thumb: `${base}/thumbnail.jpg`,
           createdAt: r.createdAt });
  };
  ws.onclose = () => setTimeout(connect, 1000);                   // resume from last seq (inclusive, dedupe on uri)
}
connect();
function emit(x) { console.log(JSON.stringify(x)); }               // ponytail: stdout; swap for SQLite/KV when needed
```
Notes: the derived `playlist.m3u8` is exactly what the AppView returns in `embed#view.playlist` (verified against searchPosts output, same `watch/{did}/{cid}/playlist.m3u8` pattern). Processing may lag record creation by seconds; a 404 on first fetch should be retried. Store the `seq` and reconnect with `cursor` to survive restarts.

### Inferences
- A $5 VPS can hold the posts-only tail with headroom (3.7 GB/day in, ~100 MB/day out if you only keep video metadata). Cloudflare Pages/Workers cannot hold a long-lived outbound WebSocket for days (Workers have request-duration limits), so the tail belongs on the Node VPS; Pages/Workers serve the resulting JSON.
- Keyword filtering on `record.text` alone misses most video posts (many have empty text); filter on `langs`, author lists, `facets` tags, or feed membership instead.

### Gaps
- Replay window length for v2 cursors is not published; v2 zstd support unconfirmed; v1 "~56%" vs Jaz's "0.44 ratio" are both 2024-era figures.

## Key Question 3: searchPosts — auth, hosts, sort/since, pagination, rate limits

### Takeaway
`app.bsky.feed.searchPosts` works unauthenticated on `api.bsky.app` for page one, but in my tests every cursor-paginated page 2+ returned HTTP 403 "Request forbidden by administrative rules", and `public.api.bsky.app` returns 403 for search outright; the published docs state the public AppView has unspecified "generous" limits with no numbers. For video sourcing it yields ~3 video posts per 100 results, so it is a poor primary source.

### Cited Findings
- Hosts: "The direct endpoints (api.bsky.app and public.api.bsky.app) don't support authentication"; "These API services have generous rate-limits. Please contact us if you encounter rate-limiting"; `public.api.bsky.app` "is cached and is meant for public web use cases" — [rate-limits.md (bsky-docs repo)](https://raw.githubusercontent.com/bluesky-social/bsky-docs/main/docs/advanced-guides/rate-limits.md)
- Own test, `GET https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=video&limit=1` → HTTP 403 (HTML error page, bunny.net CDN) with and without a User-Agent. Same query on `api.bsky.app` → 200.
- Own test, `api.bsky.app` `q=video&sort=latest&limit=100`: page 0 returned 100 posts + cursor, zero `ratelimit-*` headers; following the cursor to page 1 → 403 "Request forbidden by administrative rules"; repeated with 3 s gaps: page 0 ok, pages 1-3 all 403. `sort=top&since=2026-10-10T00:00:00Z` → 200. Of 100 `latest` results for "video", only 3 had `app.bsky.embed.video#view`.
- Corroboration: GitHub issue reports searchPosts "returns 403 even though the docs say it should work without authentication" on public.api.bsky.app — [bsky-docs issue #332](https://github.com/bluesky-social/bsky-docs/issues/332); scraper maintainers report the alias "returns 403 for search, while the api.bsky.app host serves it normally", measured from three continents so "not geo-gating", and several now require an app password for search — [Apify listings](https://apify.com/bitofacoder/bluesky-scraper), [Apify](https://apify.com/axery/bluesky-posts-scraper)
- Documented params (lexicon): `q`, `sort` (`top`|`latest`), `since`, `until`, `mentions`, `author`, `lang`, `domain`, `url`, `tag[]`, `limit` 1-100 (default 25), `cursor` — the docs.bsky.app endpoint pages now redirect to [endpoints.bsky.app](https://endpoints.bsky.app/) (JS-rendered; parameter list above is from the lexicon as reflected in the live API behaviour I observed: `limit=100` honoured, `sort=top`, `since` accepted).
- Authenticated path: PDS limits are "3,000 per 5 minutes, per IP" for all endpoints combined; `createSession` "30 per 5 minutes and 300 per day, per account"; 429 on overflow; headers follow an IETF draft — [rate-limits.md](https://raw.githubusercontent.com/bluesky-social/bsky-docs/main/docs/advanced-guides/rate-limits.md). Third-party blog repeats the 3,000/5 min per-IP figure — [adaptlypost](https://adaptlypost.com/blog/bluesky-api-rate-limit).

### Inferences
- Unauthenticated search is effectively first-page-only right now (whether by design or an edge rule). An app password (free) via `com.atproto.server.createSession` on bsky.social and calling `searchPosts` through the PDS proxy is the reliable path; reuse the session (300 logins/day cap) and refresh JWTs.
- Even authenticated, search is ~3% video; use it only for topic back-fill (`q=<topic> sort=top since=<yesterday>`), then keep the video-embed subset.

### Gaps
- No published numeric limit for the AppView; the 403 on page 2 is undocumented and might be IP-reputation or bot-rule based. Max pagination depth with auth not measured (no app password used in this research).

## Key Question 4: Feed generators — discovery endpoints, video feeds, throughput

### Takeaway
`app.bsky.unspecced.getPopularFeedGenerators?query=video&limit=100` works unauthenticated on api.bsky.app and returns ~100 feeds per keyword; `app.bsky.feed.getFeed` works unauthenticated for most community video feeds (SkyTok, OG Videos+, Blacksky Videos returned 97-100% video posts, 3 pages × 100 deep), while Bluesky's own "Video" feed and personalised feeds fail without auth.

### Cited Findings
- Discovery endpoint tested: `GET https://api.bsky.app/xrpc/app.bsky.unspecced.getPopularFeedGenerators?query=video&limit=100` → 98 feeds + cursor, unauth 200. `query=videos` → 100, `clips` → 99, `tiktok` → 74, `reels` → 14, `short video` → 3 (own test). `app.bsky.feed.getSuggestedFeeds` → 200 unauth; `app.bsky.feed.getFeedGenerator?feed=…` → 200 unauth (own test).
- Top video feeds by likeCount (own query, 2026-10-11):
  - 7,086 — "Video" `at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/thevids` (creator bsky.app, served by `did:web:discover.bsky.app`, "Trending videos in the Bluesky network") — unauth `getFeed` returned **HTTP 502 "Upstream server responded with a 500 error"** on every try.
  - 1,371 — "After Dark Video" `…bfuck3vwwacatltdmnilloym/…/mutuals-ad-vid` (NSFW, follows-based)
  - 1,248 — "Videos For You" `…3guzzweuqraryl3rdkimjamk/…/videos-for-you` (personalised; unauth returned 1 stale item)
  - 1,018 — "SkyTok" `at://did:plc:6nkng5626orolzuyvuzocl4e/app.bsky.feed.generator/skytoc` — unauth: 280 items / 277 video over 3 pages, spanning ~9 h (01:24Z back to 16:24Z previous day) ⇒ roughly 700+ video posts/day throughput.
  - 734 — "#BookSky Vids" `…geoqe3qls5mwezckxxsewys2/…/bookskyvids`
  - 665 — "Blacksky Videos" `at://did:plc:w4xbfzo7kqfes5zb7r6qv3rw/app.bsky.feed.generator/blacksky-videos` — unauth: 80 items / 72 video spanning ~22 h ⇒ ~80/day.
  - 607 — "Hot Stuff: Video" (NSFW); 569 — "Tube" `…vpkhqolt662uhesyj6nxm7ys/…/tube` (follows-based, needs auth to be meaningful)
  - 208 — "Skylight (TikTok 2.0)" `…gbxs4wgxc4xbb5wmurv3rskw/…/aaahqiu44quei` — unauth returned 3 items, 0 video (likely dead/placeholder)
  - 147 — "OG Videos+" `at://did:plc:6i6n57nrkq6xavqbdo6bvkqr/app.bsky.feed.generator/og-videos-kps` — unauth: 300 items / 299 video over 3 pages spanning ~22 h ⇒ ~330/day, cursor continued.
  - 27 — "TikTok-Tagged Vids-en" `…uojvncxfhac7iekpcxi7h4re/…/vids-en` — 81 items / 80 video but newest item dated 2026-04-03 (stale generator).
  - Niche: "Bikesky: Clips", "Latinsky Clips" ("video-exclusive feed"), "WrestleTok", "AEWTok", "WNBA Reels", "NBA Reels", "NFL Reels", "CFB Reels", "1 Minute Recipes".
- `getFeed` responses carried no `ratelimit-*` headers; limit=100 honoured; `embed.$type == "app.bsky.embed.video#view"` with `playlist`, `thumbnail`, `cid`, `aspectRatio` (own test).
- Bluesky shipped video-only custom feeds in Jan 2025 ("swipe up to enter a timeline of only video posts in video custom feeds") — [EM360](https://em360tech.com/tech-articles/bluesky-rolls-out-custom-video-feeds-rival-tiktok) (2025).
- Graze: no-code builder with analytics, monetisation plans, and newer filters on "text transcriptions from videos" — [TechCrunch Jan 2025](https://techcrunch.com/2025/01/31/custom-feed-builder-graze-is-building-a-business-on-bluesky-and-investors-are-paying-attention/), [Graze newsletter](https://graze-newsletter.beehiiv.com/p/context-is-king)
- SkyFeed Builder inputs are Entire Network / Tags / Single User / List / Feed / Single Post with regex, language and label filters; all SkyFeed feeds are served by `did:web:skyfeed.me` — [SkyFeed guide (JP)](https://scrapbox.io/Bluesky/SkyFeed%E3%81%AEFeed_Builder%E3%82%92%E4%BD%BF%E3%81%A3%E3%81%A6%E3%82%AB%E3%82%B9%E3%82%BF%E3%83%A0%E3%83%95%E3%82%A3%E3%83%BC%E3%83%89%E3%82%92%E3%81%A4%E3%81%8F%E3%82%8B), [skyfeed-me](https://github.com/skyfeed-dev/skyfeed-me)
- Directories: Goodfeeds.co (JS-rendered; search by keyword/top50) — [Goodfeeds](https://goodfeeds.co); blueskydirectory.com/feeds categorised directory; Skyswipe is an existing "swipe-first" third-party short-video client that "lets you add any Bluesky feed or list" — [blueskydirectory](https://blueskydirectory.com/clients/skyswipe)
- Bluesky Feed Creator (bskyfeedcreator.com) exists as a hosted builder (seen in feed description "BlueskyFeedCreator.com", own query).

### Programmatic discovery recipe
1. Loop `getPopularFeedGenerators?query=<kw>&limit=100` for kw in {video, videos, clips, tiktok, reels, vids, highlights, 動画, vídeo, vidéo}; union by `uri`; sort by `likeCount`.
2. For each candidate, `getFeed?feed=<uri>&limit=100` once; keep feeds where ≥80% of items have `embed.$type` starting `app.bsky.embed.video` and newest `indexedAt` < 48 h old; record items/hour from the page's indexedAt span.
3. Re-poll kept feeds every 10-15 min (cheap: 1 request each). Skip feeds whose generator `did` is `did:web:discover.bsky.app` (Bluesky-internal, 502 unauth) or whose description says "people you follow"/"based on your likes" (auth-personalised).

### Inferences
- Roughly 10-15 high-signal, SFW, public video feeds exist; combined they surface on the order of 1-3k unique video posts/day — far less than the ~97k/day on Jetstream, but pre-curated.
- Because feed generators are open services, you can also call the generator's own `app.bsky.feed.getFeedSkeleton` and hydrate via `app.bsky.feed.getPosts` (25 URIs per call) on api.bsky.app, bypassing AppView `getFeed` quirks.

### Gaps
- Exact count of video-only generators network-wide is not published anywhere; getPopularFeedGenerators returns only popularity-ranked matches. Graze/SkyFeed "embed type = video" filter availability not confirmed from official docs.

## Key Question 5: Legal — ToS, developer guidelines, displaying/hotlinking video

### Takeaway
Bluesky's terms explicitly contemplate third-party "Developer Applications" on the AT Protocol displaying user content; the Developer Guidelines impose obligations (no spam, report/block tooling, deletion handling, public contact) rather than restrictions on display, and no Bluesky document I found prohibits hotlinking `video.bsky.app`; the HLS CDN serves with `Access-Control-Allow-Origin: *` and 30-day public cache headers.

### Cited Findings
- ToS (last updated 14 Aug 2025): Bluesky may "store and display your posts to other Bluesky and AT Protocol Developer Application users" (§3.5.1); "If you're using another social networking application on the AT Protocol… the terms and conditions of that Developer Application will govern your experience"; Bluesky "does not control how others may use your Content" (§3.3); deleted content may persist because "we cannot control or force other services and Developer Applications on the AT Protocol" (§3.6). No clause on API use, scraping, or hotlinking — [Bluesky ToS](https://bsky.social/about/support/tos)
- Community Guidelines: "These Guidelines only apply to social networking that happens on Bluesky… We are not responsible for the content or practices of Developer Applications." — [Community Guidelines](https://bsky.social/about/support/community-guidelines)
- Developer Guidelines (undated): apps "must adhere to the Bluesky Developer Guidelines in order to communicate with Bluesky services"; Rule 1 "Don't spam"; Rule 2: apps with UGC/social features must provide reporting, content blocking and user blocking; Rule 3 "All services must have a method for deleting content a user has requested to be deleted"; Rule 4 report-handling system; Rule 5 public contact info; Rule 7: failing to respond to known violations "may result in suspension of access to services or features run on Bluesky's infrastructure" — [developer-guidelines.md](https://raw.githubusercontent.com/bluesky-social/bsky-docs/main/docs/support/developer-guidelines.md)
- Network services privacy notice: content from accounts created via third-party apps "is available to the general public"; a maintainer states atproto "only supports public content" — [Privacy notice](https://bsky.social/about/support/network-services-privacy-policy), [allthings.how summary](https://allthings.how/bluesky-accounts-cant-be-private-and-likely-never-will/)
- Logged-out visibility setting is only a request; "other apps may not honor this request" — [allthings.how](https://allthings.how/bluesky-accounts-cant-be-private-and-likely-never-will/). Respect it anyway: check `profile.labels` for `!no-unauthenticated`.
- Open-source: "Certain parts of Bluesky Social are licensed under open source terms, including the MIT and Apache licenses" (ToS §9) — [ToS](https://bsky.social/about/support/tos); Jetstream is MIT/Apache-2.0 — [GitHub](https://github.com/bluesky-social/jetstream)
- Official developer docs: "there is not one centralized API. More like the classic web, there can be multiple independent service providers" — [API hosts doc](https://docs.bsky.app/docs/advanced-guides/api-directory)
- Observed CDN headers on a playlist.m3u8 (own test): `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=2592000`, `Server: BunnyCDN`, `Content-Type: application/vnd.apple.mpegurl`.

### Inferences
- Displaying Bluesky videos in The Void is squarely within what Bluesky's documents anticipate; the obligations that bite are moderation plumbing (report/block/delete propagation) and honouring labels (`porn`, `sexual`, `graphic-media`, `!no-unauthenticated`) — several of the biggest video feeds are NSFW, so label filtering is mandatory, not optional.
- Hotlinking is tolerated in practice (CORS *, public cache) but is "services or features run on Bluesky's infrastructure" that can be cut off under Rule 7; don't rewrite URLs to `video.cdn.bsky.app` or strip `session_id` beyond what the official playlist gives you.

### Gaps
- No explicit written policy on third-party hotlinking of video.bsky.app; no published egress quota for the video CDN. Copyright policy not fetched.

## Key Question 6: What media comes back (HLS, thumbnails, CIDs) and is it directly playable

### Takeaway
Every hydrated video post carries `embed#view` with `playlist` = `https://video.bsky.app/watch/{did}/{blobCID}/playlist.m3u8`, `thumbnail` = same path `/thumbnail.jpg` (302 → `video.cdn.bsky.app/hls/...`), `cid`, and `aspectRatio`; the playlist is a public, CORS-open HLS master with 360p and 720p variants that any HLS player (hls.js, AVPlayer, ExoPlayer, expo-video) plays with no auth.

### Cited Findings
- Lexicon `app.bsky.embed.video`: record `video` blob `video/mp4` max 300,000,000 bytes ("May be up to 300mb, formerly limited to 100mb"), `captions` (≤20, `text/vtt` ≤20 KB), `alt`, `aspectRatio`, `presentation` (`default|gif`); view: `cid`, `playlist` (uri), `thumbnail` (uri), `alt`, `aspectRatio`, `presentation` — [lexicon JSON](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/embed/video.json)
- Observed view (own test): `{"$type":"app.bsky.embed.video#view","playlist":"https://video.bsky.app/watch/did%3Aplc%3Ahtxez44fcbkycz4l5egxyfyb/bafkreic33imt5kuz5m4nvsszhtcplx2d5hkh34phbb5tylla2gbyyuct4m/playlist.m3u8","thumbnail":"…/thumbnail.jpg","cid":"bafkreic33…","aspectRatio":{"height":1920,"width":1080}}`. `aspectRatio` can be `null`.
- Master playlist content (own fetch, HTTP 200): `#EXT-X-STREAM-INF:… BANDWIDTH=1062576 … RESOLUTION=640x360` → `360p/video.m3u8?session_id=…`; `BANDWIDTH=3693573 … RESOLUTION=1280x720` → `720p/video.m3u8?session_id=…`. Media playlist: `#EXT-X-PLAYLIST-TYPE:VOD`, 6-second `.ts` segments. Fetching `360p/video.m3u8` without `session_id` also returned 200.
- Thumbnail: `302 → https://video.cdn.bsky.app/hls/{did}/{cid}/thumbnail.jpg`, final 200 `image/jpeg` ~105 KB (own test).
- Community code rewrites `video.bsky.app/watch` → `video.cdn.bsky.app/hls` and picks the highest-bandwidth variant — [Closure-RI bluesky.js](https://huggingface.co/spaces/Closure-RI/test/blame/main/src/processing/services/bluesky.js) (unofficial pattern).
- Bluesky's HLS design notes (Jaz, July 2024): master playlist lists variants; players pick bitrate — [jazco.dev HLS post](https://jazco.dev/2024/07/05/hls/)
- Upload side (not needed for consumption): upload via `https://video.bsky.app/xrpc/app.bsky.video.uploadVideo` with a service token, poll `getJobStatus`; "There are limits on the number of video posts per day" (no number in official tutorial) — [video.mdx](https://raw.githubusercontent.com/bluesky-social/bsky-docs/main/docs/tutorials/video.mdx). Third parties cite 25 videos / 10 GB per account per day via `app.bsky.video.getUploadLimits` (`canUpload`, `remainingDailyVideos`, `remainingDailyBytes`) — [postfa.st](https://postfa.st/sizes/bluesky/video), [apievangelist](https://apis.apievangelist.com/store/bluesky-video-api/) (unverified against official docs). Aug 2026 coverage: videos up to 10 minutes and 300 MB — [Engadget](https://engadget.com/2244638/bluesky-now-supports-10-minute-videos-larger-file-sizes/).
- Blob fallback: the raw mp4 is also fetchable from the user's PDS via `com.atproto.sync.getBlob?did=&cid=` (protocol-standard; PDS per-IP limit 3,000/5 min) — [rate-limits.md](https://raw.githubusercontent.com/bluesky-social/bsky-docs/main/docs/advanced-guides/rate-limits.md).

### Inferences
- For a React Native + web reel UI: web → hls.js on the `playlist` URL (CORS is open); iOS → native HLS; Android → expo-video/ExoPlayer handles HLS. No proxying of media bytes is needed; the proxy only ships JSON. Max quality is 720p, so Bluesky clips look softer than TikTok-native 1080p.
- Videos are "VOD" HLS with 6 s segments; preload the first segment of the next 2 items for TikTok-style swipe.

### Gaps
- Whether `session_id` is ever enforced (it was optional in my test) and the CDN's egress/abuse thresholds are undocumented.

## Key Question 7: What an indie Node proxy can realistically ingest per day

### Takeaway
A single small VPS tailing Jetstream posts-only ingests ~3.7 GB/day of JSON (≈0.35 Mbit/s sustained), filters to ~100k video records/day (~50 MB/day of metadata), and can additionally poll ~15 video feeds every 10 minutes (~2k req/day) without touching any published limit; Cloudflare Pages should only serve the resulting JSON, not run the tail.

### Cited Findings
- Measured: 3.82 MB per 90 s for all `app.bsky.feed.post` commits ⇒ ~3.7 GB/day; ~3,841 creates per 90 s ⇒ ~43 posts/s; ~1.1 video posts/s (own measurement).
- Jaz's public Jetstream instance served "12 consumers on a $5/mo OVH VPS" with "under 16 MB" RSS (server side, 2024) — [jazco.dev](https://jazco.dev/2024/09/24/jetstream/)
- Jetstream v2 allows cursor replay for restarts; delivery at-least-once, dedupe on `at://` URI — [Jetstream docs](https://bsky.network/docs/jetstream/)
- AppView read limits are unpublished but "generous"; PDS reads 3,000 / 5 min / IP if you go authenticated — [rate-limits.md](https://raw.githubusercontent.com/bluesky-social/bsky-docs/main/docs/advanced-guides/rate-limits.md)
- `getPosts` hydration (for labels/author/like counts) takes up to 25 URIs per call (lexicon standard; not re-verified here).
- Unauth `searchPosts` pagination fails at page 2 (own test, KQ3) — do not plan ingestion on search.

### Inferences
- Budget for the VPS: ingest 3.7 GB/day in (≈110 GB/month — check the VPS bandwidth cap; many $5 plans allow 1-2 TB), CPU trivial. If you want label/engagement hydration for the ~100k/day video records, that is 4,000 `getPosts` calls/day (25 per call) — fine.
- A keyword/topic filter at the client typically keeps 1-10% ⇒ 1k-10k clips/day per topic bundle; combine with ~10-15 curated video feeds for an additional ~1-3k pre-curated clips/day.
- Cloudflare Pages (static) + a Worker can serve the daily pool as paginated JSON; run the Jetstream tail on the Node VPS and push batches to KV/R2 or Supabase.

### Gaps
- No 24-hour measurement yet; peak-hour multipliers and weekday/weekend variation unknown. Label distribution (share of `porn`/`sexual`) in the video stream not measured — the hydration step should count it before launch.
