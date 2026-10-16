# Indie architecture for a deep "infinite" short-video pool + For-You ranking without TikTok infra (as of 2026-10-11)

Scope: how small indie apps / OSS projects build a candidate pool and a personalized feed on an indie budget (~$100/mo), targeting a React Native + web app with a small Node proxy on a VPS or Cloudflare. Older material (pre-2025) is flagged.

---

## KQ1. How many fresh candidates per day do open-source Bluesky/Fediverse/Nostr video apps ingest, and from how many sources? (Fan-out / aggregator architectures)

### Takeaway
Every indie video client I found stores **metadata + remote media URLs only**, never the video bytes, and gets its candidate pool from one of three shapes: (a) a single protocol firehose filtered to video (Bluesky clients: Skylight, Bluescreen/Flashes, "Videos For You"), (b) a cron crawler over a public instance list (PeerTube: Sepia Search ~800-1,000 instances; PeerSeek ~940k videos from ~1,600 instances), or (c) a relay/archive import (Nostr: diVine ~500k Vine clips). Nobody publishes a "videos/day" number; the closest hard datum is Bluesky's 235M media posts in 2025 (~640k/day photos+video combined).

### Cited Findings

**Bluesky-ecosystem video clients (firehose-filtered, metadata only)**
- Skylight is a short-form video app on AT Protocol; its 2.0 release (Aug 2025) added "curator" feeds where humans post/repost videos to build feeds, and announced a Graze integration to let users build custom feeds in-app — [TechCrunch, Aug 2025](https://techcrunch.com/2025/08/26/skylights-tiktok-alternative-adds-community-curators-to-the-mix/). Skylight's code is **not** confirmed open source; "open" refers to the protocol — [search summary of TechCrunch/F-Droid results](https://techcrunch.com/2025/04/01/mark-cuban-backs-skylight-a-tiktok-alternative-built-on-blueskys-underlying-technology).
- Flashes (photo+video) and Bluescreen (video-only) by Sebastian Vogelsang are Bluesky clients that **filter the existing Bluesky timeline** down to media posts rather than running their own network; Flashes got 30,000 downloads in its first 24 hours (Feb 2025) — [PetaPixel](https://petapixel.com/2025/02/25/bluesky-photo-app-flashes-launches-on-the-app-store/); [MakeTechEasier](https://maketecheasier.com/bluesky-gets-an-instagram-makeover-with-flashes-app/).
- Reelo (renamed Spark) chose a standalone AT Protocol app (own lexicon, own PDS data) rather than filtering Bluesky, to allow 3-minute clips, effects, music; planned March 2025 launch, no confirmed public launch found — [TechCrunch, Jan 2025](https://techcrunch.com/2025/01/28/reelo-stands-out-among-the-apps-building-a-tiktok-for-bluesky); [TechCrunch, Feb 2025](https://techcrunch.com/2025/02/01/here-are-the-apps-battling-to-be-become-the-tiktok-for-bluesky).
- A Bluesky video feed is just a normal feed generator whose `app.bsky.feed.generator` record sets `contentMode` to `app.bsky.feed.defs#contentModeVideo`; the official client then renders it as a full-screen vertical swipe player. "The ability to swipe vertically between videos is specific to video custom feeds." — [adaptlypost explainer](https://adaptlypost.com/blog/bluesky-feed-generator); [EM360 on Bluesky video feeds](https://em360tech.com/tech-articles/bluesky-rolls-out-custom-video-feeds-rival-tiktok).
- A feed generator returns **only post AT-URIs** (`getFeedSkeleton`); Bluesky's AppView hydrates them into posts with media URLs. The generator stores no media — [adaptlypost](https://adaptlypost.com/blog/bluesky-feed-generator); [skyfeed-me (OSS feed generator with 60s cache + pagination)](https://github.com/skyfeed-dev/skyfeed-me).
- Graze (feed-building SaaS) works with Skylight, Spark and Flashes; monetizes at $1 per 1,000 impressions with a 30% cut — [TechCrunch, Jan 2025](https://techcrunch.com/2025/01/31/custom-feed-builder-graze-is-building-a-business-on-bluesky-and-investors-are-paying-attention/).
- **Concrete indie For-You system (spacecowboy's "For You Feed" + "Videos For You" on Bluesky, Apr 2026):** single Go binary consumes Jetstream, stores posts/likes/reposts/saves in SQLite (419 GB main DB + 200 GB response-log DB, 90-day retention, 24h cleanup goroutine); ~72k daily users, ~22 requests/user/day, 15–25 QPS, ~37% of a 16-core desktop, ~50 GB RAM (99% caches), 99.77% uptime; cost ~$30/mo ($20 electricity + $7 OVH VPS + $3 domains), vs. $245/mo for an equivalent rented server. It routes to separate ports per feed, e.g. `gaming:8093` for **Videos For You** — [AT Protocol blog guest post](https://atproto.com/blog/serving-the-for-you-feed); [Simon Willison summary](https://simonwillison.net/2026/Apr/24/serving-the-for-you-feed/).
- Other OSS feed-generator shapes: Rust "No Reposts" feed on Jetstream + SQLite with JWT verification — [tangled.org/vitorpy.com/noreposts-atproto-feed](https://tangled.org/vitorpy.com/noreposts-atproto-feed); Python starter (SQLite, swappable DB) — [MarshalX/bluesky-feed-generator](https://github.com/MarshalX/bluesky-feed-generator); .NET classifier of Jetstream events into feed categories — [PassiveModding/BlueskyFeedGenerator](https://github.com/PassiveModding/BlueskyFeedGenerator); Postgres-backed multi-feed collection "Rinds" — [tangled.org/whey.party/rinds](https://tangled.org/whey.party/rinds/blob/main/README.md?code=true).

**Bluesky video supply numbers**
- Bluesky's 2025 Transparency Report (as cited): 1.41B posts in 2025, of which 235M contained photos, videos or other media (≈640k media posts/day, not video-specific) — [SocialPilot citing the report](https://www.socialpilot.co/es/blog/bluesky-statistics).
- Video launch 11 Sep 2024: 60-second max, 25 videos or 10 GB per user per day, formats .mp4/.mpeg/.webm/.mov, every video scanned by Hive and Thorn — [Bluesky blog](https://bsky.social/about/blog/09-11-2024-video). Length later raised to 3 minutes (2025) and to 10 minutes on 26 Aug 2026 — [Ground News](https://ground.news/article/bluesky-now-lets-you-upload-10-minute-long-videos).
- Bluesky hit 43.5M registered users in April 2026 — [Marketful stats roundup](https://marketful.com/bluesky-statistics). ~1M daily likers is the stable active base per spacecowboy — [atproto.com blog](https://atproto.com/blog/serving-the-for-you-feed).

**Fediverse / PeerTube crawlers (cron over an instance list)**
- Sepia Search (Framasoft, launched end of 2020) is a meta-search over PeerTube; covered close to 800 instances as of 2021 — [Wikipedia: PeerTube](https://en.wikipedia.org/wiki/PeerTube); [Framablog launch post, 2020](https://framablog.org/2020/09/22/sepia-search-our-search-engine-to-promote-peertube/). Users estimate ~1,000 instances now and note it crawls the public list at instances.joinpeertube.org/instances — [Lemmy thread](https://piefed.jeena.net/post/138058) (user comments, older).
- PeerSeek "continuously crawls public PeerTube instances", indexes ~940,000 videos from ~1,600 instances into PostgreSQL, exposes a JSON API — [PeerSeek announcement](https://peachpie.theatl.social/post/368428).
- Loops (Pixelfed's TikTok-style app): vertical ≤60s videos, AGPL-3.0, ActivityPub federation "officially entered beta" (cross-instance likes/comments/shares work) — [Loops blog](https://blog.joinloops.org/loops-joins-the-fediverse/); [TechCrunch via Slashdot, Oct 2024](https://tech.slashdot.org/story/24/10/28/2116223). Low-trust uploaders are held for moderation; trusted users skip the queue — [RouteNote](https://routenote.com/blog/loops-decentralized-tiktok-competitor/).

**Nostr video**
- NIP-71 video events: original draft used kind 21 (normal) / kind 22 (short vertical); merged version uses addressable kinds 34235 (horizontal) / 34236 (vertical) with a required `d` tag so metadata can be updated without republishing — [NIP-71 mirror](https://nips.4rs.nl/nips/71); [njump kinds list](https://github.com/fiatjaf/njump).
- diVine (Vine reboot, Nostr, open source, funded by Jack Dorsey's "And Other Stuff") uses kind 34236; ~100k archived Vines at Nov 2025 beta, ~500k videos from ~100k creators at public launch 29 Apr 2026 — [Soapbox](https://soapbox.pub/blog/what-is-nostr-divine); [TechCrunch Nov 2025](https://techcrunch.com/2025/11/12/jack-dorsey-funds-divine-a-vine-reboot-that-includes-vines-video-archive); [TechCrunch Apr 2026](https://techcrunch.com/2026/04/29/jack-dorsey-backed-vine-reboot-divine-launches-to-public/).
- VideoRelay: YouTube-style OSS frontend with a Shorts vertical feed that fetches NIP-71 events directly from relays (no own media storage) — [GitHub satsdisco/videorelay](https://github.com/satsdisco/videorelay).

### Inferences
- The pattern that scales on $30–100/mo is: one ingest process, one SQLite/Postgres, rows of `{uri, did, created_at, thumb_url, playlist_url, caption, labels}`, media served from the origin CDN. spacecowboy's 419 GB SQLite is for *all* posts+likes over 90 days; a video-only subset of ~640k media posts/day (upper bound) with ~1 KB/row would be <1 GB/day before likes.
- Dedupe in all these systems is keyed on the protocol-native ID (`at://` URI for Bluesky, event id / `d` tag for Nostr, `uuid@instance` for PeerTube); none of the sources describe perceptual (visual) dedupe.
- For a fan-out crawler (PeerTube-style), 1,000–1,600 instances is the realistic ceiling of the public fediverse video supply; polling them on a cron from a VPS is cheap because you only pull JSON listings.

### Gaps
- No source publishes **videos/day** ingested by Skylight, Flashes/Bluescreen, Spark or diVine. Bluesky publishes media posts per year, not video per day.
- No source describes a dedupe strategy beyond protocol IDs.
- Skylight, Flashes and Spark source code: not found as open source; Skylight repo not located.
- Sepia Search's current instance/video counts: site returned a title-only page; numbers above are 2021 or user estimates.

---

## KQ2. Minimal Jetstream video-only consumer on one small VPS: code shape and data volume per day

### Takeaway
Jetstream makes a video-only Bluesky consumer trivially cheap: `collections=app.bsky.feed.post` + a check that `record.embed.$type == "app.bsky.embed.video"` (or a recordWithMedia wrapper) gives you every new video post as ~500 B of JSON. The public Jetstream instance itself runs on a $5/mo VPS in <16 MB RSS; all-posts live tail is ~850 MB/day (zstd), so a video-only subset is tens of MB/day of bandwidth and a few hundred MB/day of SQLite rows at most.

### Cited Findings
- Full firehose was ~24 GB/day pre-surge and >232 GB/day during the Aug–Sep 2024 Brazil surge (3.16 TB/mo). Jetstream (JSON, no MST/signatures): ~41 GB/day all events uncompressed, 18 GB/day with zstd; **posts only with zstd ≈ 25.5 GB/mo, i.e. "as little as about 850 MB/day"**, under 1% of the firehose — [Jaz, "Jetstream: Shrinking the AT Proto Firehose by >99%", Sep 2024](https://jazco.dev/2024/09/24/jetstream/).
- Average event 482 B uncompressed, 211 B with the shared zstd dictionary (trained on 100k real events); per-connection streaming zstd was rejected (+23% server CPU, playback dropped from ~200k to ~28k events/s) — [jazco.dev](https://jazco.dev/2024/09/24/jetstream/).
- Public Jetstream instance: Go + PebbleDB, 24h playback window under 8 GB on disk, runs on a **$5/mo OVH VPS serving 12 consumers, resident memory below 16 MB** (~25% of it the zstd dictionary) — [jazco.dev](https://jazco.dev/2024/09/24/jetstream/).
- Official docs (2026): endpoints `wss://jetstream.us-west.bsky.network` / `jetstream.us-east.bsky.network` (v2) at `/xrpc/network.bsky.jetstream.subscribeEvents`; params `collections` (NSIDs or wildcard `app.bsky.feed.*`, max 100), `dids` (max 10,000), `kinds` (commit|identity|account|sync), `cursor` (seq number, or unix-µs on live tail). Delivery is at-least-once, so **key your writes on the `at://` URI and make them idempotent**. Commit payload: `{did, seq, time, operation, collection, rkey, rev, cid, record}`; deletes have no record — [bsky.network Jetstream docs](https://bsky.network/docs/jetstream). (Note: Jaz's 2024 post uses the older `wantedCollections` param name; the 2026 docs use `collections`. Mark the v1 hosts `jetstream1.us-west` / `jetstream2.us-east` as legacy.)
- Shell one-liner from the docs: `websocat --protocol xrpc.v1.json "wss://jetstream.us-west.bsky.network/xrpc/network.bsky.jetstream.subscribeEvents?collections=app.bsky.feed.post&kinds=commit"` — [bsky.network Jetstream docs](https://bsky.network/docs/jetstream).
- Node client: `@skyware/jetstream` supports the same collection/DID filters — [npm](https://npmjs.com/package/@skyware/jetstream); TS example in docs uses `@bsky/jetstream` with `jetstream.live({ collections: [...] })` in a `for await` loop — [bsky.network docs](https://bsky.network/docs/jetstream). Self-hosting is a single Go binary with a data dir — [bsky.network self-host](https://bsky.network/docs/jetstream-self-host).
- Over 90% of the Relay's hundreds of consumers build feeds/bots/tools and never verify MST ops, which is why Jetstream drops them — [jazco.dev](https://jazco.dev/2024/09/24/jetstream/).
- Proof it runs small: spacecowboy's single Go binary consumes Jetstream and writes posts/likes/reposts/saves to SQLite with 5 read connections and one Go-mutex-guarded writer; "almost 100%" of recommendation reads come from in-process LRU caches (hashicorp/golang-lru), no Redis — [atproto.com blog](https://atproto.com/blog/serving-the-for-you-feed).

### Inferences
- Code shape (Node): open WS to `…subscribeEvents?collections=app.bsky.feed.post&kinds=commit&cursor=<last_seq>`; for each `operation==="create"` where `record.embed?.$type==="app.bsky.embed.video"` or `record.embed?.media?.$type==="app.bsky.embed.video"`, `INSERT OR IGNORE` into SQLite `{uri, did, cid, created_at, text, langs, video_cid, aspect, alt}`; on `delete` mark row deleted; persist `seq` every N events for resume. Hydrate `thumb`/`playlist` URLs lazily via `app.bsky.feed.getPosts` (AppView) or construct from the video CDN once the format is confirmed (see Gaps).
- Volume: if ~640k media posts/day is the upper bound for photo+video combined, video posts are a fraction of that; at ~500 B/event the raw inbound is well under 300 MB/day and the SQLite growth (metadata only) is in the low hundreds of MB/day even before pruning to a 30–90 day window. A 2 GB RAM / 20 GB disk VPS is ample.
- The expensive part is not ingestion but **likes**: if you want collaborative filtering (KQ4) you also need `app.bsky.feed.like` events, which dominate volume (spacecowboy's 419 GB over 90 days is mostly ratings). Mitigation: only store likes whose subject URI is already in your video table.

### Gaps
- Bluesky's video developer guide (`/docs/advanced-guides/videos`) returned 404 at both docs.bsky.app and bsky.network, so the exact `video.bsky.app` HLS playlist / thumbnail URL format and any third-party-use terms are **unverified** here.
- No published count of `app.bsky.embed.video` creates per day.

---

## KQ3. Cost per 1,000 clips to label thumbnail + caption with a cheap multimodal model (2026)

### Takeaway
At October 2026 list prices, labeling one thumbnail (~1 MP) plus caption with a short structured JSON output costs roughly **$0.05–$0.10 per 1,000 clips on Gemini 2.5 Flash-Lite (batch)**, **~$0.10–$0.25 per 1,000 on Claude Haiku 5.5 (batch, with the system prompt cached)**, and **~$1.5–$2 per 1,000 on Claude Haiku 4.5**. Even 50,000 clips/day on Haiku 5.5 batch is on the order of $5–$12/day; on Flash-Lite it is cents to a few dollars. The vendors' own pages supply the token math; no indie "curator service" published an end-to-end per-clip cost.

### Cited Findings
**Anthropic (page fetched 2026-10-11)**
- Claude Haiku 5.5: $0.10 / MTok input, $0.50 / MTok output (prompts ≤100k tokens); batch $0.05 / $0.25; cache hits $0.01 / MTok. Claude Haiku 4.5: $1 / $5, batch $0.50 / $2.50, cache hit $0.10 — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).
- Batch API = 50% off input and output; prompt-cache reads = 0.1× base input; multipliers stack — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).
- Image tokens = ⌈w/28⌉ × ⌈h/28⌉ (28-px patches); 1000×1000 = 1,296 tokens; 1920×1080 downsized to 1456×819 = 1,560 tokens on standard tier. Anthropic's own worked example: at Haiku 4.5's $1/MTok "the 1000×1000 image costs about $1.30 USD per thousand images". Up to 100 images per request (200k-context models), 600 otherwise — [Anthropic vision docs](https://platform.claude.com/docs/en/build-with-claude/vision).

**Google (page fetched 2026-10-11)**
- Gemini 2.5 Flash-Lite: $0.10 in / $0.40 out per MTok; batch $0.05 / $0.20. Gemini 2.5 Flash: $0.30 / $2.50, batch $0.15 / $1.25. Gemini 3.1 Flash-Lite $0.25 / $1.50; Gemini 3.5 Flash-Lite $0.30 / $2.50; Gemini 3.6/3.8 Flash $0.75 / $3.75 (rising to $1.50 / $7.50 on 1 Jan 2027). Image input is billed at the same per-token rate as text; batch is a 50% reduction; free tier exists but excludes batch — [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).
- Gemini image tokens: images ≤384 px on both sides cost **258 tokens**; larger images are tiled into 768×768 tiles at 258 tokens each (a 960×540 image → 6 tiles ≈ 1,548 tokens); Gemini 3 has a `media_resolution` knob capping tokens per image — [Gemini image understanding docs](https://ai.google.dev/gemini-api/docs/image-understanding).

**Signals worth labeling (for the prompt design)**
- TikTok's own disclosure lists video information signals it uses: captions, sounds, hashtags; and says it avoids two consecutive videos with the same sound or creator and filters duplicates / already-seen / spam — [TikTok Newsroom, 2020 (older)](https://newsroom.tiktok.com/en-us/how-tiktok-recommends-videos-for-you).

### Inferences (cost math; assumptions stated)
- Assume per clip: thumbnail resized to ≤384 px (Gemini: 258 tokens) or ~512×896 vertical (Claude: ⌈512/28⌉×⌈896/28⌉ = 19×32 = 608 tokens), ~150 tokens of caption/handle/hashtags, ~300-token system prompt (cached), ~60 tokens of JSON output (`{topic, quality 1-5, nsfw, lang, is_meme, hook}`).
- **Gemini 2.5 Flash-Lite, batch:** ~710 in × $0.05/M + 60 out × $0.20/M ≈ $0.0000475 → **≈ $0.05 per 1,000 clips**; standard (non-batch) ≈ $0.10 per 1,000.
- **Claude Haiku 5.5, batch + cached system prompt:** ~760 uncached in × $0.05/M + 300 cached × ~$0.005/M + 60 out × $0.25/M ≈ $0.000055 → **≈ $0.06 per 1,000**; at the 1000×1000 thumbnail Anthropic uses as an example (1,296 tokens) it is ≈ $0.09 per 1,000 batch, ≈ $0.17 per 1,000 standard.
- **Claude Haiku 4.5 standard:** Anthropic's own figure is $1.30 per 1,000 for the image alone; add text and output → **≈ $1.5–$2 per 1,000**; batch halves it.
- Daily budget examples: 20,000 clips/day × 30 days = 600k clips/mo → ~$30–$55/mo on Haiku 5.5 or Flash-Lite batch, ~$1,000/mo on Haiku 4.5 standard. So on a <$100/mo budget, use Haiku 5.5 or Gemini Flash-Lite in batch mode, and label only clips that pass cheap heuristics (duration, aspect ratio, language, creator allowlist/denylist) first.
- Throughput: batch APIs are asynchronous, so a nightly job over the day's new video rows fits a cron on the same VPS; no GPU needed.

### Gaps
- No indie project publishes an end-to-end "we label N clips/day for $X" number; the cost figures above are computed from vendor list prices, not observed bills.
- Open-weights alternatives (e.g., running a small VLM on one GPU) — no 2026 throughput/cost source found in this pass; not covered.
- Quality of cheap models on "is this a good short video" judgments — no benchmark found.

---

## KQ4. Candidate pool depth per user session for a TikTok-like feel, lightweight ranking signals, and OSS implementations

### Takeaway
Industry pipelines narrow a huge corpus to **a few hundred candidates per request** and then rank them (YouTube's two-stage design; TikTok secondary descriptions say "a few hundred"); the research literature on short video converges on **watch-time (length-debiased), early-skip negatives (most skips happen in the first ~5 s), completion, and replay** as the core signals. At indie scale, likes-based collaborative filtering over a 90-day window serves 72k daily users from one process, and Gorse offers a packaged version (popular/recent/user-CF/item-CF + CTR ranker) for small teams. I found **no paper giving a "minimum unseen pool size per session"** number; that remains an inference.

### Cited Findings
**Candidate counts / stages**
- YouTube's 2016 system is explicitly two-stage: "a deep candidate generation model" then "a separate deep ranking model", following the classic retrieval→ranking split — [Google Research pub 45530](https://research.google/pubs/pub45530). (The widely quoted "hundreds of candidates from a corpus of millions" detail is in the paper body, which I could not fetch as text; treat the exact wording as unverified here.)
- Secondary description of TikTok: candidate generation "narrows the entire catalog down to a few hundred plausible videos, then a ranking model scores those candidates by how likely you are to watch, replay, and share" — [buildwithaws Substack](https://buildwithaws.substack.com/p/most-engineers-miss-whats-really) (secondary, not TikTok).
- TikTok (2020, older): ranks on interactions (likes, shares, follows, comments, content created), video info (captions, sounds, hashtags), device/account settings (down-weighted); "finishing a longer video" is a stronger indicator than viewer and creator sharing a country; follower count and prior viral videos are not direct factors; avoids two consecutive videos with the same sound or creator; deliberately injects videos outside stated interests and low-like videos for discovery — [TikTok Newsroom](https://newsroom.tiktok.com/en-us/how-tiktok-recommends-videos-for-you).
- TikTok historically preloaded a fixed-size, fixed-order queue of upcoming videos, wasting bandwidth when users swiped away (motivating adaptive preload research) — [PKU NetVideo paper, 2022 (older)](https://www.icst.pku.edu.cn/NetVideo/docs/20220826143529921247.pdf).
- Monolith (ByteDance, RecSys 2022): collisionless embedding table (cuckoo hashing, expirable embeddings, frequency filtering) and fault-tolerant **online training**; deployed in BytePlus Recommend. The abstract does **not** discuss candidate counts or pool sizes — [arXiv 2209.07663](https://arxiv.org/abs/2209.07663); [Dhruvil summary](https://dhruvil.substack.com/p/paper-summary-monolith-real-time).

**Ranking signals from short-video papers**
- Kuaishou (2023): skipping is "the easiest-to-collect user feedback"; model jointly optimizes total watching time and skipping rate; deployed to billion-level users via online A/B — [arXiv 2308.13249](https://arxiv.org/abs/2308.13249).
- AAAI 2025: splits skips into three levels (early skip = negative, delayed skip = weakly positive, rest = highly positive); "most skips occur within the first five seconds of the video" — [AAAI 2025 / arXiv 2504.03107](https://arxiv.org/html/2504.03107v1).
- Watch-time distribution is zero-inflated, long-tailed and multimodal (quick skips, partial views, completions, replays); longer videos mechanically accrue more watch time and are over-favored by naive models — [arXiv 2608.23356 (2026)](https://arxiv.org/pdf/2608.23356); [arXiv 2508.12665](https://arxiv.org/pdf/2508.12665).
- Video-length bias in completion rate; a naive percentage threshold biases labels toward shorter videos; a duration-aware percentile label aligns better with retention (ShareChat) — [arXiv 2308.14276](https://arxiv.org/pdf/2308.14276); [CEUR Vol-3590 short2](https://ceur-ws.org/Vol-3590/short2.pdf).

**Open-source / indie implementations**
- spacecowboy's Bluesky For-You (Apr 2026): likes-based CF — "It finds people who liked the same posts as you, and shows you what else they've liked recently"; tables `items(uri→int id)`, `raters(did→int id)`, `ratings(item_id, rater_id, created_timestamp)`; 90-day retention; separate response log of what was shown plus later likes / "show more" / "show less"; falls back to >10× cheaper parameters under load with "minimal quality degradation" — [atproto.com blog](https://atproto.com/blog/serving-the-for-you-feed).
- Gorse (Go, Apache-2.0): candidates from popularity, recency, user-to-user, item-to-item and collaborative filtering, ranked by CTR prediction; auto model search; REST API + dashboard; MySQL/MongoDB/Postgres/ClickHouse storage with Redis cache; supports multimodal embeddings and LLM-based recommenders — [Gorse README](https://cdn.jsdelivr.net/gh/gorse-io/gorse@master/README.md).
- Skyfeed-me: feed generator with query engine, 60-second skeleton cache and pagination — [GitHub](https://github.com/skyfeed-dev/skyfeed-me).

### Inferences
- A workable indie pipeline mirroring the two-stage split: retrieve ~200–500 unseen candidates per request from (a) likes-CF neighbours, (b) same-topic label as recently completed clips, (c) fresh/popular fallback; score with a hand-weighted formula over `completion_ratio`, `early_skip (<3–5 s) penalty`, `rewatch`, `creator_affinity`, `label_match`, `freshness`; apply TikTok-style diversity rules (no two consecutive same creator/sound). Then page the client 8–10 items at a time and prefetch 2–3 ahead.
- "Feels infinite" is more about **unseen** candidates than total pool: with ~22 feed requests/user/day (spacecowboy) and ~10 items/request, a heavy user burns ~200–300 clips/day, so a pool refreshing by low thousands of labeled clips/day with a 30–90 day window (tens of thousands live) is sufficient to avoid repeats for a small user base.
- Store an `impressions` table per user (what was shown + watch outcome) — spacecowboy's response log is the same idea and is what enables negative feedback and "already seen" filtering.

### Gaps
- No paper or engineering blog found that quantifies the minimum unseen-candidate pool per session needed for a TikTok-like feel; the ~200–300 clips/day/heavy-user estimate is derived.
- The exact "hundreds of candidates" quote from Covington et al. 2016 could not be verified from fetched text (PDF came back as binary).
- Twitter's the-algorithm learnings were not researched in this pass (no tool budget left).
- Whether spacecowboy's feed code is open source: not stated.

---

## KQ5. Hotlinking/embedding vs. proxying/rehosting: legality (US/EU) and Cloudflare costs

### Takeaway
**US:** under the Ninth Circuit's server test (Perfect 10 v. Amazon, 2007; reaffirmed in Hunley v. Instagram, 2023), embedding/inline-linking media hosted on another server is not a "display" by you, so it is not direct infringement — but S.D.N.Y. courts (Goldman v. Breitbart 2018, Nicklen v. Mashable 2021) reject the test, so it is circuit-dependent. **EU:** BestWater (2014) says embedding freely available content is not a communication to a new public; VG Bild-Kunst (2021, Grand Chamber) carves out that framing which **circumvents technical anti-framing measures** is infringement. **Rehosting (downloading + re-serving bytes) is a reproduction and loses both defenses** unless you have a license or qualify for DMCA §512 safe harbor as a host of user uploads. Cloudflare makes the proxy path cheap: R2 has zero egress, Workers Paid is $5/mo with no bandwidth charge.

### Cited Findings
**United States**
- Perfect 10 v. Amazon (9th Cir. 2007, 508 F.3d 1146): Google infringes display/distribution rights by framing only if it "hosted and physically transmitted the content itself"; "including an inline link is not the same as hosting the material itself" — [Wikipedia](https://en.wikipedia.org/wiki/Perfect_10,_Inc._v._Amazon.com,_Inc.).
- Hunley v. Instagram (9th Cir., 17 Jul 2023, No. 22-15293): affirmed dismissal, reaffirmed the server test on stare decisis grounds against photographers' secondary-liability theory for third-party embeds — [Copyright Lately](https://copyrightlately.com/ninth-circuit-affirms-server-test-in-instagram-embedding-case); [DWT](https://dwt.com/insights/2023/08/server-test-instagram-case-ninth-circuit); [Loeb & Loeb](https://www.loeb.com/en/insights/publications/2023/07/hunley-v-instagram-llc).
- Contrary line: S.D.N.Y. has rejected the server test in three rulings, including Nicklen v. Mashable (2021), which said the test "contradicts the meaning of the term" display; Goldman v. Breitbart (S.D.N.Y. 2018) allowed suit over embedded social posts; a 5th Cir. decision (Emmerich Newspapers v. Particle Media) held an aggregator's use could violate the DMCA — [Wikipedia](https://en.wikipedia.org/wiki/Perfect_10,_Inc._v._Amazon.com,_Inc.). Commentators expect possible en banc or Supreme Court review — [DWT](https://dwt.com/insights/2023/08/server-test-instagram-case-ninth-circuit).

**European Union**
- BestWater International v. Mebes & Potsch (C-348/13, order of 21 Oct 2014): framing a YouTube video on a third-party site is not a "communication to the public" where the work is freely available and not communicated to a new public, even though the original upload was unauthorised; applied Svensson — [EDRi](https://edri.org/our-work/cjeu-embedding-copyright-infringement/); [Stanford WILMap](https://wilmap.stanford.edu/node/29784); [EU Law Radar](https://eulawradar.com/case-c-34813-bestwater-international-objecting-to-the-embedding-of-videos/).
- VG Bild-Kunst v. Stiftung Preußischer Kulturbesitz (C-392/19, Grand Chamber, 9 Mar 2021): embedding freely accessible works by framing is a communication to the public **where it circumvents protection measures against framing** adopted or imposed by the rightholder; resizing is irrelevant as long as the original elements are perceptible; absent such measures, framing/inline linking remains permitted. AG Szpunar had argued inline (automatic) links always need authorisation but the Court did not go that far — [SCL](https://www.scl.org/12210-cjeu-confirms-that-framing-embedded-content-on-a-website-may-require-authorisation-of-the-copyright-holder/); [Mondaq](https://www.mondaq.co.uk/uk/copyright/1069084/court-of-justice-of-european-union-finds-that-framing-a-copyright-work-in-a-third-party-web-page-constitutes-making-that-work-available-to-a-new-public-if-the-copyright-holder-has-put-restrictive-measures-in-place); [IPPT](https://www.ippt.eu/items/ippt20210309-cjeu-vg-bild-kunst-v-spk); [Swan Turton](https://swanturton.com/vg-bild-kunst-v-stiftung-preusischer-kulturbesitz-copyright-works-and-website-framing/).

**Cloudflare costs (pages dated Oct 2026)**
- R2: $0.015/GB-month standard, Class A $4.50/M, Class B $0.36/M; free tier 10 GB + 1M Class A + 10M Class B; "There are no charges for egress bandwidth for any storage class" — [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/).
- Workers: Free 100k req/day, 10 ms CPU; Paid $5/mo min with 10M requests + 30M CPU-ms included, then $0.30/M requests and $0.02/M CPU-ms; "There are no additional charges for data transfer (egress) or throughput (bandwidth)"; subrequests not billed. KV: 10M reads/mo included then $0.50/M. D1: 25B rows read/mo and 5 GB included on Paid, no egress charge — [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
- Cloudflare Stream bills per minute of video delivered with no separate egress; segment requests count as delivery — [Cloudflare Stream pricing](https://developers.cloudflare.com/stream/pricing). Forum claim (unofficial) that Cloudflare's CDN won't cache video segments on ordinary plans — [LowEndTalk](https://www.lowendtalk.com/discussion/151487/does-cloudflare-host-my-live-stream).

### Inferences
- For a Bluesky/Nostr/PeerTube aggregator, **hotlinking the origin HLS playlist and thumbnail (the client plays from `video.bsky.app` / the PeerTube instance / the Nostr media server)** is the posture that both the US server test and EU BestWater/VG Bild-Kunst protect, provided the origin has not deployed anti-framing/anti-hotlink measures (referer checks, signed URLs). Respect `robots`/hotlink blocks: in the EU, defeating them flips the result.
- **Proxying through your own Worker/CDN** (fetch from origin, stream to client without storing) is legally greyer: in the US it moves you toward "physically transmitting" the content; in the EU it looks like reproduction + communication. **Caching/rehosting in R2** is clearly a reproduction and needs either a license, user-upload + DMCA §512(c) safe-harbor posture (registered agent, takedown process), or permission from the origin platform's terms.
- Cost-wise, a thumbnail-only cache in R2 (e.g., 100k thumbs × 30 KB = 3 GB) is ~$0.05/mo and is the one place proxying is worth it (consistent sizing for the labeler and the client). Video bytes should stay on origin.
- Platform ToS (Bluesky's video CDN, PeerTube instance rules) matters as much as copyright; the Bluesky video developer guide was not reachable, so check it before shipping.

### Gaps
- Bluesky's stated policy on third-party apps hotlinking `video.bsky.app` HLS was not retrievable (404 on the docs URL).
- Cloudflare's Terms on proxying third-party video through Workers were not found in this pass; Stream pricing is for Stream-hosted video only.
- No source found on whether Cloudflare's standard CDN caches `.ts`/`.m4s` segments by default (only an unofficial forum claim).
- Post-2023 developments on the server test (any en banc / SCOTUS action after Hunley) were not searched beyond the 2023 decisions.
