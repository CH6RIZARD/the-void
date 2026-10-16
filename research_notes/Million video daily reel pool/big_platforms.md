# Big video platforms: what an indie third-party short-form app can legally use (as of 2026-10-11)

Scope: React Native + web client, small Node proxy, indie budget. "Direct file" = a URL your own `<video>`/expo-av can play; "embed only" = must render the platform's own player (iframe/WebView). Items flagged **[2023-era]**, **[secondary]** or **[unverified]** are older or non-primary.

Overall takeaway: of the 13 platforms, only **Internet Archive**, **Odysee/LBRY**, and (de facto, with ToS risk) **Reddit v.redd.it** and **Telegram t.me/s** expose directly playable files. **YouTube, Twitch, Dailymotion, Vimeo, TikTok, Instagram** are embed-only for a third party. **X** is pay-per-use and expensive at feed scale. **Kick** and **Rumble** have no usable public clips/video API. **Reddit's public Data API shuts down in March 2027**, so it is a dead end for anything new.

---

## YouTube Shorts (Data API v3 + IFrame player)

### Takeaway
Search is effectively limited to **100 `search.list` calls/day** on the default quota (the docs now describe a separate 100-call bucket rather than the old 100-units-per-call model), there is **no Shorts filter** (closest: `videoDuration=short` = under 4 min, which is not Shorts), and playback must be the embedded IFrame player under strict rules; downloading/caching the media is expressly forbidden.

### Cited Findings
- Default quota: projects get **10,000 units/day combined for all other endpoints**; `search.list` and `videos.insert` each have their **own bucket with a default limit of 100 calls per day**; every call costs at least 1 unit, each page counts separately — [YouTube quota cost page](https://developers.google.com/youtube/v3/determine_quota_cost)
- `search.list` page restates "100 calls per day", 1 unit per call in the Search Queries bucket; `maxResults` 0–50 (default 5); `order` default `relevance`, others `date`, `rating`, `title`, `viewCount`; `publishedAfter` RFC 3339; non-relevance orders with date filters can yield incomplete result sets — [search.list](https://developers.google.com/youtube/v3/docs/search/list)
- `videoDuration`: `short` = "less than four minutes", `medium` = 4–20 min, `long` = over 20 min; `videoDimension` only 2d/3d; **no Shorts or vertical-video parameter exists** — [search.list](https://developers.google.com/youtube/v3/docs/search/list)
- More quota requires passing a **compliance audit** first, then submitting the "YouTube API Services - Audit and Quota Extension Form"; re-submit if audited in last 12 months; failed audits use the Appeals Form; no timeline given — [Quota and compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)
- Developer Policies III.E.1: must not "download, import, backup, cache, or store copies of YouTube audiovisual content without YouTube's prior written approval" nor "make content available for offline playback" — [Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- III.I.7–9: must not "separate, isolate, or modify the audio or video components", not promote them separately, not play from a background player; III.I.6: must not "modify, build upon, or block any portion or functionality of a YouTube player"; III.I.5: no interfering with ads; III.I.21: no nested iframes to circumvent policy; III.I.14: no technology other than the API to retrieve API Data — [Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- Data retention: non-authorized API data storable **max 30 calendar days**, then delete or refresh (III.E.4.c–d) — [Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- Required Minimum Functionality: embedded player viewport **at least 200x200 px** (recommend 480x270); no overlays/frames in front of any part of the player; autoplay allowed only once more than half the player is visible; **only one YouTube player may autoplay per page/screen**; autoplay-trigger thumbnails at least 120x70; no touch/mouseover hijacking; player must send an HTTP Referer identifying your app (no `noreferrer`) — [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- API ToS §3.1: access only "to develop and operate your API Client(s)"; §15: YouTube may set quotas at any time and you must not circumvent them; §16.3: no reproducing/distributing audiovisual content except through the API as permitted — [API Services ToS](https://developers.google.com/youtube/terms/api-services-terms-of-service)
- Developer Policies III.E.4.i: autoplay means "playback will occur without any user interaction"; no outright autoplay ban — [Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- `react-native-youtube-iframe`: WebView wrapper over the IFrame Player API, works without the native YouTube app on Android, supports Expo and multiple players, fetches metadata via oEmbed without an API key; MIT; ~704 stars, 67 open issues; page does not document autoplay/mute limits — [GitHub](https://github.com/LonelyCpp/react-native-youtube-iframe)
- Community workarounds for Shorts detection are approximations (duration+dimension) or scrapers hitting YouTube's internal endpoints — [Volcengine article](https://www.volcengine.com/article/125238); [VEED guide](https://www.veed.io/learn/youtube-shorts-api); [Apify Shorts scraper](https://apify.com/simpleapi/youtube-shorts-scraper) **[secondary]**

### Inferences
- Realistic fresh-video volume via the official search API: 100 searches × 50 results = **≤5,000 candidates/day** before dedupe, with no guarantee any are Shorts. `playlistItems.list` on known channels' uploads playlists (1 unit each from the 10k/day bucket) is the cheaper discovery path; filter by `contentDetails.duration` ≤ 60s via `videos.list` (50 ids per unit) to approximate Shorts.
- A vertical feed of autoplaying YouTube embeds is constrained by "one autoplaying player per screen" and the 200x200 minimum; a TikTok-style preload-next-card design must not autoplay the off-screen card. Mobile WebView autoplay additionally needs mute/user-gesture handling.
- Hotlinking/rehosting is out; embedding is the only lawful route. Using the undocumented `/shorts` channel feed or scrapers breaks III.I.14.

### Gaps
- `react-native-youtube-iframe` latest release date / maintenance status not visible on the fetched page.
- No official statement on whether a 100-search/day cap can be lifted by audit for a small indie app; the audit page gives no eligibility criteria or timeline.

---

## Reddit (video posts, v.redd.it, API pricing, free tier, ToS)

### Takeaway
Reddit announced on 2026-09-30 that it is **ending public Data API access in March 2027** (new access requests close 2026-10-31, RSS ends 2026-11-13); until then the free tier is 100 QPM OAuth / 10 QPM unauthenticated **[2023-era]** and commercial use needs a paid agreement. v.redd.it serves video and audio as separate DASH files (plus an HLS manifest) that a proxy can hotlink, but the Data API Terms license is "copy and display ... solely as necessary to run your App" with mandatory deletion of removed content and no modification beyond formatting.

### Cited Findings
- Announced 2026-09-30 (r/modnews, r/redditdev): RSS ends **2026-11-13**; no new public API access requests from **2026-10-31**; from **2027-01-12** access "starts to close" for unregistered apps; public Data API ends for everyone **March 2027**; >14,000 apps/bots registered; survivors must move to Devvit (Developer Platform) or sign commercial agreements; partners with written agreements (accessibility apps, mobile clients like Narwhal) exempt — [PPC Land](https://ppc.land/reddit-to-halt-public-data-api-access-in-march-2027-as-14-000-apps-register/); corroborated by [TechRepublic](https://www.techrepublic.com/article/news-reddit-rss-public-api-shutdown/) and [DigitalApplied](https://www.digitalapplied.com/blog/reddit-api-rss-shutdown-ai-tools-deadlines) (TechRepublic returned 403 on fetch; relied on search summary)
- $1,000,000 migration program pays $1,000 per eligible app that applies by 2026-11-30 and migrates; Devvit is TypeScript-only; Devvit Rule 8 bars storing deleted/removed content offline or redistributing it outside mod tools — [PPC Land](https://ppc.land/reddit-to-halt-public-data-api-access-in-march-2027-as-14-000-apps-register/)
- Data API Terms (revised 2026-07-20 per a secondary guide) require a separate agreement for commercial purposes, research beyond rate limits, or any use not expressly permitted, with fees "at Reddit's sole discretion"; AI training needs rightsholder permission — [KeyAPI migration guide](https://www.keyapi.ai/blog/reddit-data-api-overhaul-major-changes-and-migration-guide/) **[secondary]**
- Free tier **[2023-era, CEO post 2023-06-09]**: 100 queries/min per OAuth client id; 10 QPM unauthenticated; $0.24 per 1K calls quoted to high-volume apps; "ad-supported or commercial" use was flagged as needing a deal — [u/spez post (mirror)](https://reddit.rtrace.io/r/reddit/comments/145bram/addressing_the_community_about_changes_to_our_api/jnk63b5); [Octolens summary](https://octolens.com/blog/reddit-api-pricing) **[secondary]**
- Data API Terms (archived copy, via search snippet): "non-exclusive, non-transferable, non-sublicensable, and revocable license to copy and display the User Content using the Data API solely as necessary to develop, deploy, distribute, and run your App"; "You may not modify the User Content except to format it for such display"; must comply with owners' restrictions (e.g. CC licences); must delete/modify content that is deleted, protected, or removed on Reddit; no other rights implied — [Data API Terms (NLI archive)](https://web-archive.nli.org.il/National_Library/mp_/https://redditinc.com/policies/data-api-terms) (live redditinc.com, support.reddithelp.com, web.archive.org and the NLI mirror all returned 403/blocked on direct fetch; text comes from search snippets)
- Old API wiki **[2017, archived]**: 60 req/min OAuth, mandatory descriptive User-Agent `<platform>:<app ID>:<version> (by /u/<name>)`, "NEVER lie about your user-agent" — [reddit-archive wiki](https://github.com/reddit-archive/reddit/wiki/API)
- v.redd.it: post JSON `secure_media.reddit_video` carries `fallback_url` (mp4 video-only, strip `?source=fallback`), `dash_url`, `hls_url`; audio is a separate file, now `https://v.redd.it/{id}/DASH_AUDIO_{64|128}.mp4` (older posts `DASH_audio.mp4`) — [r/redditdev 2023 post (mirror)](https://red.127.pp.ua/r/redditdev/duplicates/15cdln3); [Hugging Face code sample](https://huggingface.co/spaces/Closure-RI/test/blob/main/src/processing/services/reddit.js) **[community, not official]**
- A blog claims that since late May 2026 `.json` links require login and new OAuth tokens need 2–4 week manual approval — [KeyAPI](https://www.keyapi.ai/blog/reddit-data-api-overhaul-major-changes-and-migration-guide/) **[unverified]**

### Inferences
- Any Reddit-sourced video pipeline built today has a **~5-month shelf life** unless you (a) secure a commercial agreement (pricing undisclosed, presumably ≥ the 2023 $0.24/1K) or (b) express the use case as a Devvit app, which runs inside Reddit and does not appear to permit off-platform display.
- Playing v.redd.it in RN/web: `hls_url` works natively on iOS/expo-av and via hls.js on web; DASH needs muxing video+audio in your proxy, which is arguably "modifying" beyond formatting. Hotlinking the HLS manifest is the lower-risk option.
- High-volume news/politics video subreddits (r/PublicFreakout, r/CombatFootage, r/UkraineWarVideoReport, r/worldnews, r/news, r/geopolitics) are plausible sources, but no per-subreddit volume figures were found.

### Gaps
- Could not read the live Data API Terms or the Data API Wiki; exact current rate-limit text and any video-specific clause are unconfirmed. No clause specifically about v.redd.it display was found in any source.
- No sourced per-subreddit video volume per day.
- Paid pricing beyond the 2023 $0.24/1K figure is not published.

---

## Dailymotion

### Takeaway
Dailymotion's current Platform API is OAuth-scoped (`video.read`), profile-centric (list a profile's videos sorted by `created_at`), has no duration filter, and does **not** return stream URLs in the listing; playback is via their player SDK/embed, and stream/download URLs where exposed are time-limited and must not be cached.

### Cited Findings
- `List videos for a profile`: requires `video.read`, Bearer JWT from `https://oauth2.dailymotion.com/v1/token`; filters `created_after`/`created_before`, `tags`, `visibility`; sort only by `created_at`; `page_size` max 100; fields include `created_at`, `country`, `source.duration`; **no stream URL field** (`available_formats` is metadata only), `video_url` is the page URL, `preview` gives short mp4 preview clips; `embedding.enable_embed` boolean only — [listprofilevideos reference](https://developers.dailymotion.com/reference/listprofilevideos.md)
- API index: streaming URLs "are time-limited and must not be cached"; download URLs also time-limited; player config endpoints plus Web/Android/iOS player SDKs; a sunset section points to a migration guide for a new embed endpoint — [Platform API index](https://developers.dailymotion.com/api/)
- The "rate limiting" page covers upload quotas only (standard: 15 videos & 10 h per 24 h; premium 96 videos); no read-request figures — [rate limiting](https://developers.dailymotion.com/reference/rate-limiting.md); [getting started](https://developers.dailymotion.com/api/platform-api/getting-started/)

### Inferences
- No global search / "latest public videos" endpoint surfaced in the current reference; discovery would be per known profile. With no stream URLs, Dailymotion is embed-only for a third party and poor as a fresh short-video pool.
- The legacy `stream_h264_url`/`stream_hls_url` fields cited in old tutorials are not in the current reference.

### Gaps
- Read rate limits per token not documented in fetched pages.
- Dailymotion ToS on third-party display not fetched.

---

## Vimeo

### Takeaway
Vimeo's API is built around the authenticated account's own videos; limits are per-minute (officially 10/min for AI endpoints; third parties cite 250–1000 per 15 min by plan) and there is no evidence of a usable public "fresh videos" firehose; playback is via the Vimeo player embed.

### Cited Findings
- Official help: rate limits are per minute; AI endpoints 10 req/min/endpoint; on 429 you are blocked up to a minute; repeated violations can get an app blocked — [Vimeo Help: Rate limits](https://help.vimeo.com/hc/en-us/articles/12427783954065-Rate-limits)
- Third-party summaries: 250 requests/15 min free/basic, 500 PRO, 1000 Business, custom Enterprise; omitting the `fields` filter drops the limit to 100/window — [Rollout guide](https://rollout.com/integration-guides/vimeo/api-essentials); [Stitchflow](https://www.stitchflow.com/user-management/vimeo/api) **[secondary, inconsistent with each other]**
- developer.vimeo.com guideline pages rendered as only "Vimeo" (JS-rendered), so exact official per-plan numbers could not be read.

### Inferences
- Not a viable fresh-content source for a short-form feed; Vimeo is creator hosting, not discovery. Embed-only in practice.

### Gaps
- Whether `GET /videos` (global search) still exists and its rate limit was not confirmed.
- Vimeo API ToS on third-party display not fetched.

---

## Odysee / LBRY

### Takeaway
LBRY's `claim_search` JSON-RPC (served through Odysee's public proxy) is the most permissive discovery API found: full-text, `duration` operators (e.g. `"<=60"`), `release_time`, tags, channel filters, trending sort, no auth. Direct playable streams exist (odysee.com's player and yt-dlp use them) but the stream-URL endpoint is **undocumented**, and Odysee's ToS could not be read.

### Cited Findings
- `claim_search` ("Search for stream and channel claims on the blockchain"): args `text`, `claim_type` (channel/stream/repost/collection), `stream_types` (e.g. video), `media_types` (e.g. video/mp4), `duration` (seconds, supports operators), `release_time` (supports operators and lists e.g. `[">1000000","<2000000"]`), `any_tags`, `not_tags`, `channel_ids`, `any_languages`, `has_source`, `order_by` (name, height, release_time, publish_time, amount, effective_amount, support_amount, activation_height, trending fields; `^` prefix = ascending), `page_size` — [lbry-sdk api.json](https://raw.githubusercontent.com/lbryio/lbry-sdk/master/docs/api.json)
- `publish` has `license` and `license_url` fields, so claims can carry an uploader-declared licence — [lbry-sdk api.json](https://raw.githubusercontent.com/lbryio/lbry-sdk/master/docs/api.json)
- Third-party scrapers describe calling "Odysee's public LBRY proxy API — no login or API key needed" — [Apify odysee-scraper](https://apify.com/crawlergang/odysee-scraper.md); a GitHub thread shows `POST https://api.lbry.tv/api/v1/proxy` with JSON-RPC `resolve`, and LBRY staff saying there is "an internal API that isn't currently documented" — [GitHub issue](https://github.com/elliotwaite/thumbnail-rating-bar-for-youtube/issues/35)
- `StreamFinder::Odysee` returns "actual raw streamable URLs" from an Odysee page URL but depends on yt-dlp — [metacpan](https://metacpan.org/pod/StreamFinder::Odysee)
- OdyseeTeam GitHub hosts "API server for Odysee" and "media server for Odysee" repos — [OdyseeTeam](https://github.com/OdyseeTeam)

### Inferences
- `claim_search` with `stream_types=["video"]`, `duration="<=60"`, `release_time=">${now-24h}"`, `order_by=["release_time"]` plus `any_tags` (news, politics, ukraine, ...) is the closest thing to a free, filterable "fresh shorts firehose" among all platforms surveyed; content quality/moderation is the trade-off.
- Direct stream URLs work in practice but are an undocumented CDN contract; resolve them lazily server-side rather than caching.

### Gaps
- Odysee ToS (`odysee.com/$/tos`) rendered empty; scraping/embedding/commercial-reuse clauses unverified.
- No sourced figure for Odysee's daily upload volume or share of news/politics video (search returned nothing relevant).
- The current proxy hostname (api.na-backend.odysee.com vs api.lbry.tv) and the `player.odycdn.com` stream URL format were not confirmed from an official source.

---

## Rumble

### Takeaway
No official public developer API exists as of October 2026; Rumble says more API capabilities for third-party integrations are being developed, and its ToS (updated 2026-05-05) prohibits systematic data collection without written permission.

### Cited Findings
- March 2026 RUM Group status update: more API capabilities are being developed to support third-party integrations — [Quartr summary](https://quartr.com/events/rum-group-inc-rum-status-update_FL5tqmMx)
- Rumble ToS (tracked, last updated 2026-05-05) restricts systematically collecting content into databases without Rumble's written permission; the player licence is non-exclusive and limited — [ConductAtlas provision tracker](https://conductatlas.com/platform/rumble/rumble-terms-of-service/provision/CA-P-070125/prohibition-on-systematic-data-retrieval-without-permission/) **[secondary tracker]**
- Only third-party scrapers (ScrapeCreators, Apify) offer Rumble "APIs" — [ScrapeCreators](https://scrapecreators.com/rumble-api); [Apify](https://beta-securitybyobscurity.apify.com/jupri/rumble-scraper/api)

### Inferences
- Embed via Rumble's player is the only arguably permitted path; discovery would require scraping, which the ToS forbids. Skip.

### Gaps
- Official Rumble embed terms not read directly.

---

## Twitch and Kick clips

### Takeaway
Twitch `GET /helix/clips` works with an app access token, returns `embed_url`, `thumbnail_url`, `duration`, `created_at`, and supports `game_id`/`broadcaster_id` + date range (one-week default window) sorted by views; playback is iframe-only (`clips.twitch.tv/embed?clip=&parent=`, min 400x300, mobile needs a tap). Kick's public API has **no clips or VOD endpoint**.

### Cited Findings
- Get Clips: any valid OAuth token (app or user); params `id` (≤100), `broadcaster_id`, `game_id`, `first` (default 20), `after/before`, `started_at/ended_at` (UTC; if `ended_at` omitted the range is one week); results in descending view order; fields `id, url, embed_url, broadcaster_*, creator_*, video_id, vod_offset, game_id, language, title, view_count, created_at, thumbnail_url, duration, is_featured` — [Twitch clips guide](https://dev.twitch.tv/docs/api/clips/)
- The API reference index lists a separate "Get Clips Download" endpoint ("Provides URLs to download the video file(s) for the specified clips") but its details were not in the fetched range — [Twitch API reference](https://dev.twitch.tv/docs/api/reference/#get-clips); an older forum thread said no documented download link API existed — [Twitch dev forum](https://discuss.dev.twitch.com/t/get-401-while-getting-api-mp4-link/25609) **[old]**
- Rate limiting: per-app bucket of points per minute, default 1 point per call, 429 when exhausted, `Ratelimit-Limit/Remaining/Reset` headers; the page shows `Ratelimit-Limit: 800` only as an example — [Twitch API guide](https://dev.twitch.tv/docs/api/guide/)
- Clip embed: `https://clips.twitch.tv/embed?clip=<slug>&parent=<domain>`; `parent` required per embedding domain; `autoplay` default false and "mobile devices ... require user interaction before video can play"; `muted`, `preload`; **minimum 400x300 px**; `allowfullscreen` needed; clip embeds don't support the interactive JS API — [Embedding video and clips](https://dev.twitch.tv/docs/embed/video-and-clips/)
- Kick docs index lists Categories, Users, Channels, Channel Rewards, Chat, Moderation, Livestreams, Public Key, KICKs, Ads, Events/Webhooks, OAuth 2.1, Scopes — **no clips or video endpoint**; no rate-limit or ToS page listed — [docs.kick.com llms.txt](https://docs.kick.com/llms.txt); changelog shows 2025 additions are livestream/chat/moderation only — [docs.kick.com](https://docs.kick.com/)
- Kick clip data is only available via third-party scrapers; one vendor claims Kick's API requires OAuth 2.1, a registered app and client approval — [ScrapeCreators](https://scrapecreators.com/kick-clip-api); [SocialCrawl](https://www.socialcrawl.dev/platforms/kick/clip.md) **[vendor claim]**

### Inferences
- Twitch clips are a plausible high-volume gaming/IRL short-form source via embed, but the `parent` requirement means your web origin must be whitelisted and RN WebView embedding needs a hosted page on your domain. Mobile autoplay is blocked by Twitch policy; a swipe feed needs tap-to-play.
- Direct mp4 for Twitch clips is not available to third parties through documented means; expect "Get Clips Download" to be creator-scoped.
- Kick: no lawful discovery path; skip.

### Gaps
- "Get Clips Download" params/restrictions not read (reference page is 500k+ chars; fetched ranges did not include it).
- Twitch's default points/min for app tokens not stated officially.
- Kick OAuth app-approval requirement and rate limits unconfirmed.

---

## Telegram public channels

### Takeaway
`t.me/s/<channel>` web previews expose post HTML with CDN media URLs (per scraper vendors), are per-IP rate limited, and the URLs expire; Bot API `getFile` is capped at **20 MB** and bots only see channels they are members of; no Telegram ToS clause on scraping was found.

### Cited Findings
- Bot API FAQ: `getFile` downloads work only for files **up to 20 MB**; bots can send files up to 50 MB; bots receive "All messages from channels where they are a member"; rate guidance ~1 msg/s per chat, 20/min per group, ~30/s bulk — [Bot FAQ](https://core.telegram.org/bots/faq)
- Local Bot API server lifts limits: uploads up to 2000 MB, downloads "without a size limit", `getFile` returns a local path; updates kept max 24 h; no channel-history method in Bot API — [Bot API](https://core.telegram.org/bots/api)
- Scraper vendors: `t.me/s/` is "the public channel feed that Telegram already serves to the open web"; some return "direct URLs for images, MP4 videos, audio files, documents"; "photo URLs from Telegram CDN may expire"; the endpoint "applies per-IP rate limits after sustained scraping, returning 429 errors or temporary bans" — [Apify boundary](https://apify.com/boundary/telegram-channel-scraper); [Apify scrapeai](https://apify.com/scrapeai/telegram-scraper) **[vendor marketing]**
- Axiom.ai guide: reading a public channel's posts is fine; gathering members/usernames/contact details is not — [Axiom](https://axiom.ai/scrape/telegram/) **[secondary]**

### Inferences
- For videos over 20 MB the Bot API is useless without self-hosting the Bot API server; MTProto (user account via Telethon/GramJS) can read any public channel's history and download any size, but uses a personal account, a ban risk and not a sanctioned third-party-app route.
- t.me/s is technically the cheapest path (plain HTML, no auth) but is scraping with expiring CDN links; you would proxy or re-fetch on demand. Legal position rests on the copyright of each post's video, not on any Telegram licence; treat as high risk.
- News/geopolitics Telegram channels are high-volume, but no quantified figure was found.

### Gaps
- Telegram ToS / API ToS text on automated access was not fetched; no primary statement on whether t.me/s scraping is permitted.
- Whether t.me/s HTML includes playable `<video src>` URLs for all sizes was not verified directly.

---

## Internet Archive

### Takeaway
Free, keyless `advancedsearch.php` (and the cursor-based scrape API for >10k results) over `mediatype:movies`, with `https://archive.org/metadata/{id}` giving the file list for direct downloads; IA asserts no new copyright over items, but each item's own licence governs reuse, and 2026 outages/rate-limiting are reported.

### Cited Findings
- Advanced Search: sorted paged results **limited to 10,000**; example `rows=100`; Scraping API uses `cursor` for deep paging, `count` min 100, `sorts` comma-delimited; results not guaranteed stable; `ia` CLI ≥1.0.0 uses the scrape API automatically; no rate limits stated — [About search](https://archive.org/help/aboutsearch.htm)
- Metadata API: `GET https://archive.org/metadata/{identifier}` returns JSON with `files[]` (`name, source, format, size, md5, sha1`), `metadata` (`mediatype, collection, title`...), slicing via `/files?start=&count=` — [Metadata read API](https://archive.org/developers/md-read.html)
- Developer portal: IA "does not assert any new copyright or other proprietary rights" over material in its database and aims to make it freely usable — [developers index](https://archive.org/developers/index.html)
- Keyless example `https://archive.org/advancedsearch.php?q=mediatype:movies&output=json`; sorts such as `publicdate desc` / `-publicdate`; a mirror notes IA's "intermittent 2026 outages and rate-limiting" — [Wayback MCP tool](https://glama.ai/mcp/servers/sisilet/wayback-mcp/tools/search_items); [Apify IA scraper](https://apify.com/crawlergang/internet-archive-search-scraper.md); [Archivarix note](https://echo.archivarix.net/archive/internet-archive-video) **[secondary]**

### Inferences
- Download URL pattern `https://archive.org/download/{identifier}/{filename}` is derivable from the metadata `files[]` list (pattern itself not stated on fetched pages). IA generally produces an h.264 `.mp4` derivative, directly playable in RN/web.
- Filter fresh content with `publicdate:[NOW-1DAY TO NOW] AND mediatype:movies`, sort `publicdate desc`; add `licenseurl:*creativecommons*` to constrain to CC items. Most IA video is long-form/archival; truly short, fresh, news-shaped video is a small slice, so daily usable volume is likely low hundreds, not thousands — **unmeasured**.
- Hotlinking is tolerated in practice (IA is a public download host) but heavy traffic from one app should expect throttling; cache thumbnails, stream video from IA.

### Gaps
- No official rate-limit figure, no official hotlinking policy page found.
- `licenseurl` field semantics and the download URL pattern not confirmed from official docs in this pass.
- No data on daily count of new short videos.

---

## TikTok official

### Takeaway
A third-party app can show TikTok videos **only via the public oEmbed/embed.js player** (no auth documented, no video URL returned); the Display API returns only the signed-in user's own videos, and the Research API is restricted to vetted academics/non-profits and bars commercial product use.

### Cited Findings
- Embed: `<blockquote class="tiktok-embed" cite= data-video-id=>` + `https://www.tiktok.com/embed.js`; oEmbed `GET https://www.tiktok.com/oembed?url=<video link>` returns `html`, title, author, `thumbnail_url` only; no direct video URL; rate limits and auth not stated; player links back to tiktok.com; removed videos break the embed — [TikTok embed docs](https://developers.tiktok.com/doc/embed-videos)
- Display API returns only the authorizing user's own profile and videos (as of Sept 2026); Research API eligibility limited to qualifying academic institutions (US, EEA, UK, Switzerland), EU non-profits, Brazilian youth-safety researchers; ~4-week approval; commercial product building not permitted — [Phyllo guide](https://www.getphyllo.com/post/tiktok-api-integration-guide-2026-setup-endpoints-common-pitfalls); [Xpoz](https://www.xpoz.ai/blog/guides/tiktok-research-api-limits-access-and-alternatives/) **[secondary]**

### Inferences
- No lawful discovery API for arbitrary public TikToks; you would need video URLs from elsewhere (user submission, known creators) and render them via the embed, which is a web widget (WebView in RN) with no controllable autoplay.

### Gaps
- oEmbed rate limit and whether it requires a client key were not stated on the official page.
- TikTok developer ToS on embedding within a competing feed not read.

---

## Instagram official

### Takeaway
Only `GET graph.facebook.com/instagram_oembed` is available: returns embed `html` (no media URL), **1,000 requests/hour**, and Meta forbids any use beyond rendering a front-end view (no persisting metadata, no analytics).

### Cited Findings
- `GET /instagram_oembed` on `graph.facebook.com`; "You can make up to 1,000 requests every hour"; response `html`, `version`, `provider_name`, `type`, `width`; "Using metadata and page, post, or video content (or their derivations) from the endpoint for any purpose other than providing a front-end view ... is strictly prohibited" (incl. consuming, extracting, persisting, deriving analytics); unsupported: private/inactive/age-restricted accounts, accounts that disabled embeds, Stories, Shadow DOM — [Instagram oEmbed](https://developers.facebook.com/docs/instagram-platform/oembed)

### Inferences
- No discovery endpoint for public Reels exists for third parties; at most you embed Reels whose URLs you obtain elsewhere. Storing oEmbed metadata to build a feed index arguably breaches the "front-end view only" clause.

### Gaps
- Whether an access token / App Review ("oEmbed Read") is required was not shown on the fetched page.

---

## X / Twitter

### Takeaway
X moved to **pay-per-use with no free tier** (Feb 2026): $0.005 per post read, $0.010 per user lookup; Enterprise above 3M post reads/month; a feed-scale ingest is ~$5 per 1,000 posts read, and the pricing page says nothing about video URL access.

### Cited Findings
- Official pricing: Post read **$0.005/resource**; User read $0.010; Post create $0.015/request ($0.200 if the post contains a URL); Counts $0.005–0.010; no contracts/subscriptions/minimum spend; same resource requested twice within 24 h charged once; $20 credit on first card, auto-recharge match up to $50; Enterprise for >3M post reads/month — [X API pricing](https://docs.x.com/x-api/getting-started/pricing); [About X API](https://docs.x.com/x-api/getting-started/about-x-api)
- Pay-per-use became default ~2026-02-06; free tier effectively discontinued (only "for-good" utility apps); legacy Basic migrated after 2026-06-01, Pro after 2026-09-01 per some reports — [Gigazine](https://www.gigazine.net/gsc_news/en/20260209-x-api-pay-per-use/); [roboin](https://roboin.io/article/en/2026/02/08/x-transitions-api-to-pay-per-use-model-ending-free-plan/); [postproxy](https://www.postproxy.dev/blog/x-api-pricing-2026/) **[secondary]**
- developer.x.com product page returned HTTP 402 to the fetcher — [developer.x.com](https://developer.x.com/en/products/x-api)

### Inferences
- Even a modest 20k posts/day search ingest is ~$100/day (~$3k/month), not indie-viable. Historically `media.fields=variants` returned mp4 variant URLs for native video, but X's Developer Agreement restricts off-platform redistribution; with this cost profile it is moot.

### Gaps
- Whether `variants` mp4 URLs are still returned and the current Developer Agreement's display rules were not read.

---

## Cross-platform summary table

| Platform | Discovery API | Direct file? | Auth | Limit / cost | Lawful display | Fresh short video/day (indie, realistic) |
|---|---|---|---|---|---|---|
| YouTube | search.list, playlistItems | **No** (download/cache forbidden) | API key | 100 searches/day + 10k units; audit for more | IFrame player only, ≥200x200, 1 autoplay/screen, 30-day data TTL | ≤5k candidates via search; more via channel playlists; Shorts not filterable |
| Reddit | Data API (ending Mar 2027) | DASH/HLS hotlink (v.redd.it) | OAuth | 100 QPM free [2023]; commercial = contract | Display-only licence, delete removed, no mods | High until shutdown; zero after |
| Dailymotion | per-profile list | No (time-limited, no-cache) | OAuth `video.read` | undocumented | Player SDK/embed | Low; no global search |
| Vimeo | own-account | No | OAuth | ~250/15 min [secondary] | Embed | ~0 for discovery |
| Odysee/LBRY | claim_search (rich filters) | Yes (undocumented CDN) | none | none documented | Unknown (ToS unreadable) | Potentially thousands; unmeasured |
| Rumble | none | No | — | — | Embed only; scraping banned | 0 |
| Twitch | Get Clips | No | app token | points bucket/min | iframe, parent domain, ≥400x300, no mobile autoplay | Thousands of clips/day via game_id |
| Kick | no clips API | No | OAuth 2.1 | — | — | 0 |
| Telegram | t.me/s scrape / Bot ≤20 MB / MTProto | Yes (expiring CDN) | none / bot / user acct | per-IP 429 | Unclear; copyright per post | High; high risk |
| Internet Archive | advancedsearch + scrape | **Yes** (archive.org/download) | none | 10k sorted cap; informal throttling | Per-item licence; IA claims none | Low hundreds of short clips |
| TikTok | none (oEmbed only) | No | none for oEmbed | unstated | embed.js only | 0 discovery |
| Instagram | none (oEmbed only) | No | app token | 1,000/hr | front-end view only | 0 discovery |
| X | search (paid) | mp4 variants [historical] | paid | $0.005/post read | Developer Agreement | $-bounded, ~$5/1k posts |
