# Fediverse short-video sourcing: PeerTube, Mastodon, Pixelfed, Loops (as of 2026-10-11)

Method note: most numbers below are live API probes run on 2026-10-11 (curl from a Windows box, no auth). Where a figure comes from a probe, the "source" is the endpoint hit. Older/secondary data is marked.

## Q1. Sepia Search (search.joinpeertube.org) as a cross-instance index

### Takeaway
Sepia Search is a free, unauthenticated, CORS-open (`Access-Control-Allow-Origin: *`) Meilisearch index of ~846k videos from 1,731 PeerTube hosts, but it lags the federation by ~2 weeks (newest `publishedAt` was 2026-09-27 on 2026-10-11) and caps pagination at `start < 9000`. It is good for a backfill catalogue and for discovering which hosts publish short/news content, not for "fresh today" video. Index growth is ~450 videos/day, of which ~29% are <=90 s.

### Cited Findings
- Endpoint: `GET https://search.joinpeertube.org/api/v1/search/videos` returns `{"total":845837,"data":[...]}` with `Access-Control-Allow-Origin: *`, Express/nginx, no rate-limit headers exposed — [probe: search.joinpeertube.org/api/v1/search/videos?count=1&sort=-publishedAt](https://search.joinpeertube.org/api/v1/search/videos?count=1&sort=-publishedAt)
- `GET /api/v1/config` → `indexedHostsCount: 1731`, `indexedInstancesUrl: https://instances.joinpeertube.org` (i.e. the index is fed from the public instance list) — [search.joinpeertube.org/api/v1/config](https://search.joinpeertube.org/api/v1/config)
- Channels indexed: 44,969 — [search.joinpeertube.org/api/v1/search/video-channels?count=1](https://search.joinpeertube.org/api/v1/search/video-channels?count=1)
- Accepted params verified by probe: `start` (must be `>= 0 and < 9000`, else 400), `count` (100 works; 101 also returned 200, so cap unclear), `sort=-publishedAt` (invalid sort → `"Should have correct sortable column"`), `startDate` (ISO 8601), `durationMin`, `durationMax` (seconds), `nsfw=true|false`, `isLive`, `categoryOneOf` (PeerTube category ids). `hostOneOf` did not filter (returned full total) and `host` returned 0 — host filtering appears not to work on the public instance — [probe set](https://search.joinpeertube.org/api/v1/search/videos?start=10000&count=1)
- Record fields returned per video: `uuid, shortUUID, publishedAt, category{id,label}, licence{id,label}, language, privacy, name, description, duration, tags, thumbnailUrl, previewUrl, thumbnails[], embedUrl, url, isLocal, views, likes, dislikes, comments, isLive, nsfw, nsfwFlags, nsfwSummary, aspectRatio, account{host,...}, channel{host,...}, hotScore`. No `files[]`/`streamingPlaylists[]` — you must call the origin instance's `/api/v1/videos/{uuid}` for playback URLs — [probe](https://search.joinpeertube.org/api/v1/search/videos?count=1&durationMax=90)
- Freshness: ten newest results all had `publishedAt` 2026-09-27T00:15–01:36Z on 2026-10-11; `startDate` = 14 days ago → `total: 0` — [probe](https://search.joinpeertube.org/api/v1/search/videos?count=10&sort=-publishedAt)
- Volume by window (as of 2026-10-11): since 21 d → 4,802; since 30 d → 9,851; since 60 d → 27,388 videos. 60 d with `durationMax=90` → 7,910 (28.9%); `durationMax=60` → 5,869 (21.4%); `nsfw=true` → 188 (0.7%); `nsfw=false` → 27,200 — [probe](https://search.joinpeertube.org/api/v1/search/videos?count=1&startDate=2026-08-12T00:00:00.000Z)
- All-time: `durationMax=90` → 196,331 of 845,837 (23.2%); with `durationMin=1&isLive=false` → 195,280 — [probe](https://search.joinpeertube.org/api/v1/search/videos?count=1&durationMax=90)
- Sample of the 900 newest indexed videos: median duration 246 s; 26.2% are 1–90 s; 1.6% have duration 0 (lives/placeholders). Top hosts in that sample: vid.freedif.org 106, clip.place 55, makertube.net 41, tube.blueben.net 35, tube-sciences-technologies.apps.education.fr 29, tube-arts-lettres-sciences-humaines.apps.education.fr 27, peertube.wtf 26, 810video.com 25 — [probe, 9 pages of 100](https://search.joinpeertube.org/api/v1/search/videos?count=100&sort=-publishedAt&startDate=2026-08-12T00:00:00.000Z)
- Indexing lag reported by instance admins: "about 10 days" for a newly listed instance's videos to appear (thread opened 2025-08-09; PeerTube lead dev Chocobozzz replied about an IPv6/AAAA DNS misconfiguration, no cadence stated) — [framacolibri.org thread](https://framacolibri.org/t/sepia-search-index-update-time/27048); an earlier thread reports indexing of new videos stopping for ~3 weeks — [framacolibri.org](https://framacolibri.org/t/sepia-search-not-indexing-new-videos/20506)
- Framasoft's 2020 launch post: Sepia Search is "our gateway to videos across the PeerTube federation" and the gateway operator "has the power to decide what will be accepted (or rejected) in the search directory" (older, 2020) — [framablog.org](https://framablog.org/2020/09/22/sepia-search-our-search-engine-to-promote-peertube/)
- Software: `framasoft/peertube/search-index`, AGPLv3, created 2020-02-13, 623 commits; indexes "automatically created by PeerTube at startup" in Meilisearch; README does not document crawl interval or rate limits — [framagit.org](https://framagit.org/framasoft/peertube/search-index)
- Legal notice for the hosted service points to Framasoft's generic legals — [framasoft.org/en/legals](https://framasoft.org/en/legals/)

### Inferences
- ~450–470 new videos/day enter the index (27,388 / 60 d), so PeerTube-wide short (<=90 s) supply via Sepia is only ~130/day. Even the whole federation (instance-list total 947k videos, see Q3) implies well under 1,000 new videos/day across all PeerTube.
- Because `start` is capped at 9,000, deep pagination needs slicing by `startDate`/`categoryOneOf`/`durationMax`; each slice gives at most 9,000 rows.
- Sepia's 2-week lag means a "fresh" feed must come from polling origin instances directly (Q2); use Sepia only to pick which hosts to poll and for backfill.

### Gaps
- No published rate limit for search.joinpeertube.org; none observed in headers. No official statement of index refresh interval (only the ~10-day anecdotes above).
- Whether `count` > 100 is honoured or silently capped was not verified (101 returned 200 but row count not checked).

## Q2. Per-instance PeerTube API: `/api/v1/videos`, `/api/v1/search/videos`, detail call, playback URLs, CORS, rate limits

### Takeaway
Every PeerTube instance exposes the same unauthenticated JSON API with CORS `*`; `GET /api/v1/videos?sort=-publishedAt&isLocal=true&count=100` gives the newest local uploads, and `GET /api/v1/videos/{uuid}` returns both an HLS master `.m3u8` (`streamingPlaylists[]`) and progressive MP4s (`files[]`), all directly hotlinkable with CORS `*` and byte-range support on the three instances tested (kolektiva S3/OVH, framatube, tilvids). Default rate limit is 50 requests / 10 s per IP.

### Cited Findings
- Documented rate limits (prefix `/api/v1`): `/*` 50 calls per 10 s; `POST /users/token` 15 per 5 min; `POST /users/register` 2 per 5 min; exceeding returns 429; headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (UNIX ts), `Retry-After`; "Administrators can change these values" — [docs.joinpeertube.org REST reference](https://docs.joinpeertube.org/api-rest-reference.html)
- Observed on kolektiva.media: `X-RateLimit-Limit: 50`, `Access-Control-Allow-Origin: *`, `Access-Control-Expose-Headers: Retry-After` — [probe: kolektiva.media/api/v1/videos?count=1](https://kolektiva.media/api/v1/videos?count=1)
- CORS documented as enabled for `/api/*`, `/download/*`, `/lazy-static/*`, `/.well-known/webfinger`, and all ActivityPub routes — [docs.joinpeertube.org](https://docs.joinpeertube.org/api-rest-reference.html)
- `count` max is 100 (`count=101` → 400 "Should have a number count (max: 100)"); invalid `sort` → 400 pointing to `#operation/getVideos`. Sorts that returned 200: `-hot`, `-trending`, `-best`, `-views`, `-likes`, `-publishedAt` — [probe](https://kolektiva.media/api/v1/videos?count=101)
- `/api/v1/videos` ignores `durationMax` (returns full total); `/api/v1/search/videos?durationMax=90&isLocal=true` filters correctly (kolektiva: 1,446 local videos <=90 s of 8,204 local) — [probe](https://kolektiva.media/api/v1/search/videos?durationMax=90&count=1&isLocal=true)
- Detail response keys: `url, name, category, licence, language, privacy, nsfw, nsfwFlags, nsfwSummary, description, isLocal, duration, aspectRatio, views, viewers, downloads, likes, dislikes, thumbnailPath, previewPath, thumbnails, embedPath, publishedAt, originallyPublishedAt, isLive, account, channel, comments, streamingPlaylists, files, tags, commentsPolicy, downloadEnabled, state, trackerUrls, embedPrivacyPolicy` — [probe: kolektiva.media/api/v1/videos/{uuid}](https://kolektiva.media/api/v1/videos/6303dc21-e841-458b-927a-934dcde001ba)
- kolektiva example (91 s video, licence `{"id":null,"label":"Unknown"}`): `files[]` = 1080/720/480 MP4s at `https://kolektiva-media-s3.s3.bhs.io.cloud.ovh.net/web_videos/....mp4` plus `fileDownloadUrl` on `kolektiva.media/download/web-videos/...`; `streamingPlaylists[0].playlistUrl` = `.../streaming_playlists/hls/<uuid>/<id>-master.m3u8`, per-resolution `-fragmented.mp4` files, `segmentsSha256Url` — [same probe](https://kolektiva.media/api/v1/videos/6303dc21-e841-458b-927a-934dcde001ba)
- CORS/hotlinking on kolektiva's OVH S3: master.m3u8 → 200 `application/x-mpegURL`, `Access-Control-Allow-Origin: *`, `Allow-Methods: GET,HEAD`, `Expose-Headers: Accept-Ranges,Content-Length,Content-Range,Content-Type,ETag`, `Max-Age: 86400`; MP4 range request with foreign `Origin`/`Referer` → 206 `video/mp4`, `Accept-Ranges: bytes` — [probe on kolektiva-media-s3.s3.bhs.io.cloud.ovh.net](https://kolektiva-media-s3.s3.bhs.io.cloud.ovh.net/)
- framatube.org newest video: 1 web MP4 + 6 HLS renditions; HLS master served from `framatube.org/static/streaming-playlists/hls/...` with `Access-Control-Allow-Origin: *`, `Allow-Methods: GET, OPTIONS`, `Allow-Headers: Range,...` — [probe](https://framatube.org/api/v1/videos?sort=-publishedAt&isLocal=true&count=1)
- tilvids.com newest video: 1 web MP4 (`/static/web-videos/...-0.mp4`, 1.2 MB, 206 on range, CORS `*`) + 3 HLS renditions, master `.m3u8` CORS `*` — [probe](https://tilvids.com/api/v1/videos?sort=-publishedAt&isLocal=true&count=1)
- Category ids (for `categoryOneOf`): 1 Music, 2 Films, 3 Vehicles, 4 Art, 5 Sports, 6 Travels, 7 Gaming, 8 People, 9 Comedy, 10 Entertainment, 11 News & Politics, 12 How To, 13 Education, 14 Activism, 15 Science & Technology, 16 Animals, 17 Kids, 18 Food — [kolektiva.media/api/v1/videos/categories](https://kolektiva.media/api/v1/videos/categories)
- Feeds alternative: `/feeds/videos.{format}` supports `isLocal`, `nsfw`, `hasHLSFiles`, `hasWebVideoFiles`, `sort`, `videoChannelName` — [docs.joinpeertube.org](https://docs.joinpeertube.org/api-rest-reference.html)

### Inferences
- A Node proxy polling N instances at `count=100&sort=-publishedAt&isLocal=true` every few minutes stays far under 50 req/10 s per instance; the detail call per new video is the main cost (1 call/video). Caching detail JSON is safe: file URLs are stable UUID paths.
- React Native: feed HLS `playlistUrl` to the native player (iOS/ExoPlayer both handle HLS); web: hls.js or the 360p/480p `files[].fileUrl` MP4 via `<video>`. No referer/token gating was observed; `embedPrivacyPolicy`, `downloadEnabled` and `videoFileToken` (download endpoint) exist for instances that restrict.
- Instances using S3 object storage return media from a different origin than the API (OVH S3 here) — allow any host in the app's media allowlist.

### Gaps
- Only three instances were tested for media CORS; instances with `trust_proxy`/custom nginx or Cloudflare "hotlink protection" may differ. Not tested: instances whose `files[]` is empty (HLS-only, the default for new PeerTube >= 6 installs with web-video transcoding off).
- The full `getVideos` parameter list (e.g. `include`, `privacyOneOf`, `languageOneOf`, `tagsOneOf`) was not read from the OpenAPI page section (page truncated).

## Q3. Federation size and the instance list (instances.joinpeertube.org)

### Takeaway
instances.joinpeertube.org counts 1,785 instances, 947,322 videos and 548,638 users but only ~1,574 daily / ~31k monthly active users, i.e. PeerTube is a long-tail archive, not a high-velocity firehose. `totalVideos` per instance includes federated copies; use `totalLocalVideos` to rank real content hosts.

### Cited Findings
- `GET /api/v1/instances/stats`: `totalInstances 1785, totalUsers 548638, totalDailyActiveUsers 1574, totalWeeklyActiveUsers 10139, totalMonthlyActiveUsers 30972, totalVideos 947322, totalVideoComments 59457, totalVideoViews 1059192481, totalVideoFilesSize 705615431298807 (~706 TB), totalInstancesWithAllowedSignup 268`; version histogram (8.2.4 on 192 instances, 8.0.2 on 26, etc.) — [instances.joinpeertube.org/api/v1/instances/stats](https://instances.joinpeertube.org/api/v1/instances/stats)
- `GET /api/v1/instances?start=0&count=50&sort=-totalLocalVideos` (also `-totalVideos`, `search=`) returns per-instance `host, name, shortDescription, version, signupAllowed, signupRequiresApproval, userVideoQuota, liveEnabled, categories, languages, defaultNSFWPolicy, isNSFW, totalUsers, totalVideos, totalLocalVideos, totalInstanceFollowers, totalInstanceFollowing, country, health, createdAt` — [instances.joinpeertube.org/api/v1/instances](https://instances.joinpeertube.org/api/v1/instances?start=0&count=50&sort=-totalLocalVideos)
- `-totalVideos` is misleading: tube.gayfr.online 709,513 total / 632 local; video.sadmin.io 696,114 / 825; peertube.wtf 654,415 / 11,180 — [same endpoint, sort=-totalVideos](https://instances.joinpeertube.org/api/v1/instances?start=0&count=40&sort=-totalVideos)
- Top instances by `totalLocalVideos` (2026-10-11): meyon.com.ye 32,708 (9,490 users); makertube.net 32,284 (3,572 users); tube-sciences-technologies.apps.education.fr 28,369; tube-arts-lettres-sciences-humaines.apps.education.fr 24,528; play.cotv.org.br 23,201; tube-numerique-educatif.apps.education.fr 21,179; video.hardlimit.com 14,572; www.pony.tube 14,383; peertube.dngr.us 13,581; tube-action-educative.apps.education.fr 12,866; video.igem.org 12,164; indymotion.fr 11,599; peertube.wtf 11,180; tube.blueben.net 10,667; blurt.media 10,428; spectra.video 10,327; tube.tchncs.de 9,821; videos.pair2jeux.tube 9,341; peertube.uno 8,118 (12,597 users); video.megaphone.news 7,157; video.europalestine.com 5,583; fediverse.tv 5,876; bitcointv.com 5,594 — [same endpoint](https://instances.joinpeertube.org/api/v1/instances?start=0&count=50&sort=-totalLocalVideos)
- FediDB (third-party crawler) counts PeerTube at 1,593 instances, 590,125 users, 2,711,171 "statuses" (its video count differs from the official list's 947k) — [api.fedidb.org/v1/software/peertube](https://api.fedidb.org/v1/software/peertube)
- kolektiva.media server stats: 310 users, 10 DAU, 35 MAU, 8,370 local videos, 32,754 total (federated), 437 local channels, 4 daily / 25 monthly active channels, 85 followers — [kolektiva.media/api/v1/server/stats](https://kolektiva.media/api/v1/server/stats)

### Inferences
- The French Ministry of Education "apps.education.fr" cluster (~7 instances, ~110k videos) is the largest single publisher but is closed-signup educational content, probably not reel material.
- Cross-checking: 947k videos total vs 846k in Sepia means ~90% coverage by Sepia.

### Gaps
- No per-day upload figure is published by instances.joinpeertube.org; daily rates above are derived from Sepia `startDate` counts and per-instance 7-day probes.

## Q4. News / politics / activism / documentary PeerTube instances: counts and recency

### Takeaway
News & Politics is ~40 new videos/day federation-wide (2,407 in 60 days) and Activism ~5/day (288 in 60 days), concentrated on a few hosts (vid.freedif.org, video.echelon.pl, tube.fedivienne.org, video.ut0pia.org, tube.taz.de, indymotion.fr, kolektiva.media, video.europalestine.com, video.megaphone.news). About 20–25% of these are <=90 s. Several well-known instances (diode.zone, framatube, peertube.1312.media, share.tube) are dormant or hibernating.

### Cited Findings
- Sepia, `categoryOneOf=11` (News & Politics), last 60 d: total 2,407; of 900 newest sampled, 178 (19.8%) are <=90 s; hosts: vid.freedif.org 374, video.echelon.pl 122, tube.fedivienne.org 62, video.ut0pia.org 50, pallenberg.video 37, tube.taz.de 30 (German daily taz), videos.domainepublic.net 20, video.ibiala.ch 19, tube.moment.at 17, tube.linkse.media 14, peertube.stream 14, video.davduf.net 11, tube.funfacts.de 10, peertube.world 9, video.europalestine.com 9, francetube.infojournal.fr 7, peertube.netzbegruenung.de 6, video.omniatv.com 4, bideoak.argia.eus 3. Licences in sample: Unknown 572, Public Domain 133, CC BY 66, CC BY-SA 40, CC BY-NC 30 — [probe](https://search.joinpeertube.org/api/v1/search/videos?categoryOneOf=11&startDate=2026-08-12T00:00:00.000Z&sort=-publishedAt&count=100&nsfw=false)
- Sepia, `categoryOneOf=14` (Activism), last 60 d: total 288; 73 (25.3%) <=90 s; hosts: angeltales.angellive.ru 32, tvculturaviva.org.br 26, spectra.video 18, makertube.net 14, urbanists.video 14, tube.xrtv.nl 12 (Extinction Rebellion NL), peertube.wtf 11, videos.yeswiki.net 11, clip.place 10, peertube.uno 10, tubocatodico.bida.im 10, fair.tube 8, indymotion.fr 3. Licences: CC BY-SA 111, All Rights Reserved 44, PD 33, Unknown 22 — [probe](https://search.joinpeertube.org/api/v1/search/videos?categoryOneOf=14&startDate=2026-08-12T00:00:00.000Z&sort=-publishedAt&count=100&nsfw=false)
- Per-instance probes (`/api/v1/videos?isLocal=true&sort=-publishedAt`; "7d" = `/api/v1/search/videos?isLocal=true&startDate=<7 days ago>`), 2026-10-11:
  - kolektiva.media (anarchist collectives; "Registrations are open, but you need to write us"; default NSFW policy `display`; v8.3.1): 8,204 local; 25 in last 7 d, 14 of them <=90 s; newest 2026-10-11T14:40Z — [probe](https://kolektiva.media/api/v1/videos?sort=-publishedAt&isLocal=true&count=3)
  - indymotion.fr (Indymedia): 11,599 local; newest 2026-10-11T18:45Z — [probe](https://indymotion.fr/api/v1/videos?sort=-publishedAt&isLocal=true&count=1)
  - video.megaphone.news ("MegaTube is a PeerTube instance managed by Megaphone News"): 7,158 local; newest 2026-10-11T18:12Z — [probe](https://video.megaphone.news/api/v1/videos?sort=-publishedAt&isLocal=true&count=1)
  - video.europalestine.com: 5,583 local; newest 2026-10-11T09:07Z — [probe](https://video.europalestine.com/api/v1/videos?sort=-publishedAt&isLocal=true&count=1)
  - video.lemediatv.fr (Le Média, French left news): 4,688 local; 13 in 7 d, 0 <=90 s; newest 2026-10-11T16:52Z — [probe](https://video.lemediatv.fr/api/v1/videos?sort=-publishedAt&isLocal=true&count=3)
  - video.ploud.fr: 13,222 local; newest 2026-10-11T17:01Z — [probe](https://video.ploud.fr/api/v1/videos?sort=-publishedAt&isLocal=true&count=1)
  - videos.domainepublic.net: 6,316 local; newest 2026-10-09 — [probe](https://videos.domainepublic.net/api/v1/videos?sort=-publishedAt&isLocal=true&count=1)
  - tilvids.com (edutainment): 3,068 local; 12 in 7 d, 2 <=90 s; newest 2026-10-11T13:00Z — [probe](https://tilvids.com/api/v1/videos?sort=-publishedAt&isLocal=true&count=3)
  - makertube.net: 32,239 local; 89 in 7 d, 30 <=90 s; newest 2026-10-11T19:05Z — [probe](https://makertube.net/api/v1/videos?sort=-publishedAt&isLocal=true&count=3)
  - video.hardlimit.com: 14,500 local; 66 in 7 d, 11 <=90 s — [probe](https://video.hardlimit.com/api/v1/videos?sort=-publishedAt&isLocal=true&count=3)
  - spectra.video: 9,204 local; 34 in 7 d, 5 <=90 s — [probe](https://spectra.video/api/v1/videos?sort=-publishedAt&isLocal=true&count=3)
  - tube.tchncs.de: 9,736 local; 10 in 7 d — [probe](https://tube.tchncs.de/api/v1/videos?sort=-publishedAt&isLocal=true&count=3)
  - peertube.wtf: 11,142 local; newest 2026-10-11T17:06Z (7-d search returned 0, likely a search-endpoint quirk) — [probe](https://peertube.wtf/api/v1/videos?sort=-publishedAt&isLocal=true&count=3)
  - peertube.tv: 739 local; 5 in 7 d — [probe](https://peertube.tv/api/v1/videos?sort=-publishedAt&isLocal=true&count=3)
  - video.infosec.exchange: 1,596 local; 0 in 7 d; newest 2026-09-15 — [probe](https://video.infosec.exchange/api/v1/videos?sort=-publishedAt&isLocal=true&count=3)
  - framatube.org (Framasoft's own): 933 local; newest 2026-06-27 — [probe](https://framatube.org/api/v1/videos?sort=-publishedAt&isLocal=true&count=3)
  - video.blender.org: 1,232 local; 2 in 7 d — [probe](https://video.blender.org/api/v1/videos?sort=-publishedAt&isLocal=true&count=3)
  - tube.kockatoo.org: 1,762 local; 4 in 7 d, 2 <=90 s — [probe](https://tube.kockatoo.org/api/v1/videos?sort=-publishedAt&isLocal=true&count=3)
  - peertube.1312.media: 224 local; newest 2026-07-23 — [probe](https://peertube.1312.media/api/v1/videos?sort=-publishedAt&isLocal=true&count=3)
  - share.tube: 711 local; newest 2025-07-07; tube.arthack.nz 385 local, newest 2025-09-25; videos.elenarossini.com 5 local — probes as above
  - diode.zone: API returns an HTML page "Diode Zone is hibernating." — [diode.zone](https://diode.zone/api/v1/videos?sort=-publishedAt&isLocal=true&count=1)
  - peertube.linuxrocks.online, peertube.co.uk, media.privacyinternational.org: no API response (timeout/none) on 2026-10-11 — probes
- Instance-list `search=news` returns only video.megaphone.news (7,157 local) and tube.cara.news (369 local, newest 2026-10-06) — [instances.joinpeertube.org](https://instances.joinpeertube.org/api/v1/instances?start=0&count=20&sort=-totalLocalVideos&search=news)

### Inferences
- A realistic daily "news/activism, <=90 s, SFW" PeerTube yield is roughly 10–20 videos/day federation-wide; kolektiva alone contributes ~2/day of <=90 s clips. This is useful as a differentiated niche layer, not as volume.
- Hosts to poll directly for fresh political/activist content: kolektiva.media, indymotion.fr, video.megaphone.news, video.europalestine.com, video.lemediatv.fr, tube.taz.de, tube.fedivienne.org, video.ut0pia.org, vid.freedif.org, video.echelon.pl, tube.xrtv.nl, tvculturaviva.org.br.

### Gaps
- vid.freedif.org (biggest News & Politics host, 374/900) and video.echelon.pl were not individually inspected for content type or re-upload/copyright status; freedif's volume suggests mirrored TV/news clips. Needs a manual look before inclusion.
- "Documentary" has no PeerTube category; not separately measurable.

## Q5. Mastodon public / tag timelines, video share, rate limits, CORS

### Takeaway
`GET /api/v1/timelines/public?only_media=true&limit=40` works without a token on many large instances (fosstodon.org, mas.to, mastodon.world, hachyderm.io, mstdn.jp, pawoo.net, techhub.social, universeodon.com, mastodonapp.uk) but **mastodon.social, mastodon.online, mstdn.social, infosec.exchange, mastodon.art and chaos.social now return 422 "This method requires an authenticated user"** for the public timeline; mastodon.social still serves tag timelines unauthenticated. Video attachments are ~10–35% of media statuses on the federated timeline, served as direct MP4s with CORS `*` and immutable caching. Default limit is 300 req / 5 min per IP.

### Cited Findings
- Docs: `/api/v1/timelines/public` — params `only_media`, `local`, `remote`, `limit` (default 20, max 40), `max_id/since_id/min_id`; "Public. If the instance has disabled public preview, an app token with read:statuses is required"; version history 3.0.0 "auth is required if public preview is disabled", 4.5.0 "Added access control settings". Same for `/api/v1/timelines/tag/:hashtag` (plus `any[]`, `all[]`, `none[]`, 4 tags max by default) — [docs.joinmastodon.org/methods/timelines](https://docs.joinmastodon.org/methods/timelines/)
- Rate limits: 300 calls / 5 min per account and 300 / 5 min per IP for all endpoints; 30 media uploads / 30 min; headers `X-RateLimit-Limit/Remaining/Reset`; "By default, the following limits are hardcoded" — [docs.joinmastodon.org/api/rate-limits](https://docs.joinmastodon.org/api/rate-limits/)
- Observed 2026-10-11: mastodon.social, mastodon.online, mstdn.social, infosec.exchange → HTTP 422 `{"error":"This method requires an authenticated user"}` with `x-ratelimit-limit: 300`; mastodon.art and chaos.social → same 422 — [probe: mastodon.social/api/v1/timelines/public?only_media=true](https://mastodon.social/api/v1/timelines/public?only_media=true&limit=40)
- Observed unauth OK (`local=true` i.e. `remote=false`, 40 media statuses each): hachyderm.io 13 videos/40, span 1m38s; mastodon.world 14/40, span 1m15s; techhub.social 14/40; universeodon.com 16/40; mastodonapp.uk 10/40; mastodon.gamedev.place 3/40; mstdn.jp 2/40; pawoo.net 0/40 — [probe](https://hachyderm.io/api/v1/timelines/public?only_media=true&limit=40&remote=false)
- Federated (`local` unset) 40-status media pages: fosstodon.org image 34 / video 7 / gifv 4 (span ~1m40s); mas.to video 5 / image 41 / gifv 3; mastodon.world image 39 / video 7 / gifv 3 — [probe](https://fosstodon.org/api/v1/timelines/public?only_media=true&limit=40)
- Example attachment: `https://cdn.fosstodon.org/cache/media_attachments/files/117/423/943/107/772/499/original/a88ee18a7ed89cd0.mp4`, `meta.original.duration 12.05`, 1920x1080; mas.to `media.mas.to/cache/...mp4` 10.0 s; mastodon.world on Wasabi S3 `s3.eu-central-2.wasabisys.com/mastodonworld/cache/...mp4` 36.2 s 576x694 — [probe](https://mas.to/api/v1/timelines/public?only_media=true&limit=40)
- Media CORS: range GET on cdn.fosstodon.org MP4 → 206, `content-type: video/mp4`, `cache-control: public, max-age=315576000, immutable`, `Access-Control-Allow-Origin: *`, `Accept-Ranges: bytes` — [probe](https://cdn.fosstodon.org/)
- mastodon.social tag timeline unauth: `/api/v1/timelines/tag/video?only_media=true&limit=40` → 200, `x-ratelimit-limit: 300`; 40 statuses spanning 2026-10-11T11:58Z→19:00Z (~7 h), 25 video attachments, durations 14–51 s, all on `files.mastodon.social` — [probe](https://mastodon.social/api/v1/timelines/tag/video?only_media=true&limit=40)
- mastodon.social streaming API without token → 401 `{"error":"Missing access token"}` — [probe](https://streaming.mastodon.social/api/v1/streaming/public?only_media=true)
- mastodon.social media limits: `video_size_limit 103,809,024` bytes (99 MB), `video_frame_rate_limit 120`, `video_matrix_limit 8,294,400` px (4K), accepted `video/webm, video/mp4, video/quicktime, video/ogg, video/x-ms-asf`; 267,960 monthly active users — [mastodon.social/api/v2/instance](https://mastodon.social/api/v2/instance)
- FediDB: Mastodon 8,691 instances, 8,818,261 users, 981,430 MAU, 1,017,645,775 statuses; mastodon.social 3,428,047 users, 265,494 MAU, 191,344,698 statuses — [api.fedidb.org/v1/software](https://api.fedidb.org/v1/software?limit=3); [api.fedidb.org/v1/servers](https://api.fedidb.org/v1/servers?limit=5)
- CVE-2025-62176: streaming server served public timelines to tokens lacking `read:statuses`; fixed in 4.4.6/4.3.14/4.2.27 — [nvd.nist.gov](https://nvd.nist.gov/vuln/detail/CVE-2025-62176)

### Inferences
- Mastodon's cross-network video rate (from the fedi.buzz firehose sample in Q7, ~9 video attachments/min) is on the order of 10–15k video posts/day network-wide; roughly half the durations seen were 10–40 s, so Mastodon is the Fediverse's largest source of <90 s clips, far ahead of PeerTube or Loops.
- Mastodon media is cached per instance (`/cache/media_attachments/...`), so one instance's federated timeline already yields hotlinkable copies of remote videos; media hosts vary (own CDN, Wasabi, S3) but all tested send CORS `*`.
- Since the flagship instances closed anonymous public-timeline access, an indie app should either register an app token (`POST /api/v1/apps` then client-credentials token, `read:statuses`) per large instance, or poll mid-size instances and tag timelines that remain open. Rate budget 300/5 min per IP per instance means ~1 poll/second per instance is possible but 1 poll/min is plenty (40 statuses ≈ 1–2 min of a big instance's media timeline).
- Video share: 12–40% of media statuses depending on instance; gifv (looping silent MP4) is an extra ~7–10%.

### Gaps
- Could not find the Mastodon 4.5 changelog entry naming the "access control settings" toggle that mastodon.social uses; the docs only mention it in version history.
- Mastodon-wide "video posts per day" has no official figure; the estimate is extrapolated from a 60 s firehose sample (Q7).

## Q6. Pixelfed and Loops APIs

### Takeaway
Loops (flagship loops.video, 1.0.0-beta.14) has ~47k users, ~3.9k MAU and ~58k local posts; its public, unauthenticated surface is limited to `/api/v1/config`, `/api/v1/explore/tags` and account/starter-kit metadata — every feed endpoint (For You, following, tag feed) returned 401/404 without a token. Pixelfed's `/api/v1/timelines/public` returned 401 on pixelfed.social. Neither is a meaningful unauthenticated video source today; Loops videos do reach Mastodon timelines via federation as Note+video.

### Cited Findings
- Loops nodeinfo: software `loops 1.0.0-beta.14`, users total 46,696, activeMonth 3,872, activeHalfyear 12,052, localPosts 57,840, openRegistrations true — [loops.video/nodeinfo/2.0](https://loops.video/nodeinfo/2.0)
- Loops `/api/v1/config` (200, no auth): `max_video_size 40` (MB), `max_video_duration 180` (s), `allowed_video_formats mp4, mov, m4v`, `fyf true`, `federation true`, `atomFeeds true`, `starterKits true` — [loops.video/api/v1/config](https://loops.video/api/v1/config)
- Loops `/api/v1/explore/tags` (200, no auth, `x-ratelimit-limit: 60`, CORS `*`): music 3,022, fyp 3,010, gaming 1,373, loops 1,164, art 1,155, Funny 1,148, nature 1,067, Travel 689 — [loops.video/api/v1/explore/tags](https://loops.video/api/v1/explore/tags)
- Loops `/api/v1/explore/tag-feed/113` (music) unauth → 404 `Record not found`; `/api/v0/feed/for-you` → 302 to /login; `/api/v1/timelines/public` → 404 — [probe](https://loops.video/api/v1/explore/tag-feed/113?limit=5)
- Loops API docs: authenticated (401 listed) feeds `GET /v0/feed/recommended` (For You), `GET /v1/feed/following`, `GET /v1/feed/account/{profileId}/cursor`; public group includes `GET /v1/config`, `GET /v1/account/username/{id}`, `GET /v1/account/playlists/{id}`, `GET /v1/starter-kits/hashtag/popular`, `GET /v1/starter-kits/hashtag/kits?tag=`; video objects carry `media.src_url`, `media.hls_url`, `duration`, `width`, `height`, `thumbnail`, `is_sensitive`; rate limits not documented — [docs.joinloops.org](https://docs.joinloops.org/)
- Loops federation: videos federate as ActivityPub `Note` objects with video attachments (for Mastodon compatibility), replies as Comment objects — [blog.joinloops.org](https://blog.joinloops.org/loops-joins-the-fediverse/); roadmap lists a public API for third-party apps as available — [joinloops.org/roadmap](https://joinloops.org/roadmap)
- FediDB: Loops 26 instances, 47,535 users, 98,642 statuses; Pixelfed 670 instances, 1,196,354 users, 23,963,052 statuses (v0.14.4, 2026-09-30) — [api.fedidb.org/v1/software/loops](https://api.fedidb.org/v1/software/loops); [api.fedidb.org/v1/software/pixelfed](https://api.fedidb.org/v1/software/pixelfed)
- pixelfed.social `GET /api/v1/timelines/public?limit=5` without token → 401 `{"message":"Unauthenticated."}` — [probe](https://pixelfed.social/api/v1/timelines/public?limit=5)
- Pixelfed server code: public timeline returns 403 when the local timeline isn't configured public (`instance.timeline.local.is_public`) and no user is present; so anonymous access is an instance setting — [git.yunohost.org mirror of pixelfed commit](https://git.yunohost.org/YunoHost-Apps/pixelfed_ynh/commit/a691b27829f793ea457ded09929b2c7a2eccdb35); third-party client docs list the endpoint as auth-required — [packagist dansup/pixelfed-php](https://root.packagist.org/packages/dansup/pixelfed-php)

### Inferences
- Loops' entire flagship corpus (~58k posts, all <=180 s by config) is smaller than two days of Mastodon video. Its value is quality (vertical, TikTok-style, <=3 min) not volume; the practical read path is to register an app (`POST /v1/apps`) and use the authenticated For You feed, or harvest Loops posts as they federate into Mastodon media timelines (`acct` ending `@loops.video`).
- Pixelfed is photo-first; video exists but unauthenticated access depends on each instance's setting. Low priority.

### Gaps
- The Loops docs page was truncated; `getwebPublic.showVideo` path and whether a single public video can be fetched without auth were not confirmed.
- Did not confirm whether a Loops app token (client credentials) can read the For You feed without a user login.

## Q7. ActivityPub relays / firehose options (fedi.buzz, buzzrelay, FediDB)

### Takeaway
fedi.buzz exposes a Mastodon-compatible unauthenticated SSE firehose at `https://fedi.buzz/api/v1/streaming/public` (CORS `*`) and tag timelines at `/api/v1/timelines/tag/:tag`; a 60 s sample showed ~416 statuses/min (~600k/day), 99 with media and 9 with video attachments (~13k video attachments/day extrapolated). It is informal (no docs, no stated rate limits) and run by one maintainer, so treat as a convenience, not infrastructure.

### Cited Findings
- `GET https://fedi.buzz/api/v1/streaming/public` (no token) → 200, SSE `event: update` with full Mastodon Status JSON (e.g. a misskey.io note) — [probe](https://fedi.buzz/api/v1/streaming/public)
- 60 s sample (2026-10-11 ~19:45 UTC): 416 statuses, 99 with media attachments, 9 `video`, 3 `gifv`; video posters' hosts: sportsbots.xyz 4, bsky.brid.gy 2 (Bluesky bridge), threads.net 2, en.tg.anyfeed.cc 1; video durations 13, 14, 14, 19, 23, 24, 26, 26, 98 s — [probe](https://fedi.buzz/api/v1/streaming/public)
- `GET https://fedi.buzz/api/v1/timelines/tag/video?only_media=true&limit=40` → 200, CORS `access-control-allow-origin: *`, 39 statuses spanning 2026-10-11T17:19Z→19:30Z, 1 video; `/api/v1/timelines/public` → 404 — [probe](https://fedi.buzz/api/v1/timelines/tag/video?only_media=true&limit=40)
- buzzrelay (software behind relay.fedi.buzz): "A follow-only ActivityPub relay that connects to Mastodon's Streaming API"; AGPL-3.0, Rust, 110 stars, 262 commits; ethics note that many direct connections to large instances would be a problem so "fedi.buzz also serves its firehose through the streaming API" — [github.com/astro/buzzrelay](https://github.com/astro/buzzrelay)
- Relay follow targets: `@<language-id>@relay.fedi.buzz` for language feeds, `@tag-<tag>@relay.fedi.buzz` for hashtags; operator Astro pointed users to `https://fedi.buzz/api/v1/timelines/tag/hiking` as a backfill source (informal) — [activitypub.space discussion](https://activitypub.space/topic/2f67e1ad-14d6-4d80-be4b-2e64923e187d/is-the-only-point-of-a-fedi-relay-such-that-when-you-look-at-your-federated-timeline-on-a-small-instance-you-can-see-much-more-of-the-fedi)
- FediDB API (no auth): `GET https://api.fedidb.org/v1/software` lists per-software `instance_count, user_count, monthly_active_users, status_count, latest_version`; `GET /v1/servers` lists servers with `stats.status_count/user_count/monthly_active_users`, `software.version`, `open_registration`, `last_seen_at` — [api.fedidb.org/v1/software](https://api.fedidb.org/v1/software?limit=3); [api.fedidb.org/v1/servers](https://api.fedidb.org/v1/servers?limit=5)
- Mastodon's own streaming API requires a token even for public channels on mastodon.social (401 "Missing access token") — [probe](https://streaming.mastodon.social/api/v1/streaming/public)

### Inferences
- For a Node proxy, the cheapest "whole-Fediverse video firehose" is one SSE connection to fedi.buzz filtered client-side on `media_attachments[].type == "video"` (~9/min). Running your own buzzrelay (Rust + Postgres) removes the single-operator dependency and lets you pull several instances' streaming APIs with app tokens.
- A proper ActivityPub relay subscription (your proxy as a relay-follower actor) would receive Announce activities for every public post on participating instances; it requires HTTP-signature-capable inbox code — more work than polling REST timelines.

### Gaps
- No documentation, rate limit or terms for fedi.buzz's REST/SSE endpoints; sample is a single minute on a Sunday evening UTC, so the /day extrapolation has wide error bars.
- Which instances fedi.buzz ingests is not published.

## Q8. Licensing, legal and ToS norms for third-party display

### Takeaway
PeerTube attaches a licence to every video but in practice ~56% of recent uploads are "Unknown" (no licence set); Creative Commons variants (BY, BY-SA, BY-NC, BY-NC-SA, BY-NC-ND), Public Domain and "All Rights Reserved" make up the rest. Fediverse norms treat public posts as viewable via the public API/embeds, but I found no instance ToS explicitly authorising third-party apps to re-display video; the safest pattern is embed/stream from origin with attribution and honour `nsfw`, `embedPrivacyPolicy`, `downloadEnabled` and licence fields.

### Cited Findings
- Licence distribution, 900 newest Sepia-indexed videos (2026-10-11): Unknown 502, Attribution 106, Attribution-ShareAlike 71, Attribution-NonCommercial-ShareAlike 45, Public Domain Dedication 38, Attribution-NonCommercial 35, Attribution-NonCommercial-NoDerivatives 24, "Free of known copyright restrictions" 23, All Rights Reserved 22, "CC BY 4.0" (custom label) 16 — [probe](https://search.joinpeertube.org/api/v1/search/videos?count=100&sort=-publishedAt&startDate=2026-08-12T00:00:00.000Z)
- Licence field shape in the detail API: `"licence":{"id":null,"label":"Unknown"}` when unset (kolektiva example); ids 1–7 map to CC BY, CC BY-SA, CC BY-ND, CC BY-NC, CC BY-NC-SA, CC BY-NC-ND, Public Domain in the sample labels — [probe](https://kolektiva.media/api/v1/videos/6303dc21-e841-458b-927a-934dcde001ba)
- Activism-category uploads skew CC BY-SA (111 of 288) with 44 "All Rights Reserved"; News & Politics skews Unknown (572 of 900) — probes in Q4
- PeerTube detail exposes `embedPrivacyPolicy`, `downloadEnabled`, `nsfw`, `nsfwFlags`, `nsfwSummary`, `commentsPolicy`; download endpoint accepts an optional `videoFileToken` for restricted files — [docs.joinpeertube.org](https://docs.joinpeertube.org/api-rest-reference.html); [probe](https://kolektiva.media/api/v1/videos/6303dc21-e841-458b-927a-934dcde001ba)
- Instance-list fields `defaultNSFWPolicy` (`display` / `blur` / `do_not_list`) and `isNSFW` let you pre-filter adult instances (e.g. kolektiva `display`, apps.education.fr `do_not_list`) — [instances.joinpeertube.org/api/v1/instances](https://instances.joinpeertube.org/api/v1/instances?start=0&count=50&sort=-totalLocalVideos)
- Mastodon: instances can disable "public preview" / unauthenticated API access (3.0.0 docs note; 4.5.0 "access control settings"); mastodon.social and several large instances have done so for public timelines — [docs.joinmastodon.org](https://docs.joinmastodon.org/methods/timelines/); probes in Q5
- Fediverse search-consent work: FEP-5feb "Search indexing consent for actors" proposes a per-actor flag for indexing consent — [socialhub.activitypub.rocks](https://socialhub.activitypub.rocks/t/fep-5feb-search-indexing-consent-for-actors/3550)
- Framasoft on Sepia: the gateway operator "has the power to decide what will be accepted (or rejected) in the search directory" (2020) — [framablog.org](https://framablog.org/2020/09/22/sepia-search-our-search-engine-to-promote-peertube/)

### Inferences
- For a reel feed, filter PeerTube to licence ids 1–2 and 7 (CC BY, CC BY-SA, PD) plus "Free of known copyright restrictions" if you want clean rights; that is ~25–30% of recent uploads. NC/ND variants are usable for non-commercial display without edits; "Unknown" (56%) is the default-rights-reserved bucket and should be treated as embed/stream-from-origin only with attribution and a link back.
- Mastodon posts have no licence field; display should follow the Mastodon-client norm (show post, author, link to origin; respect `sensitive`/`spoiler_text`; honour `visibility == "public"` only). Mastodon's `#nobot`/`noindex` conventions and the 4.5 access-control toggles signal that scraping-style use is increasingly opt-out by instance, so an app token per instance and respecting 422/401 is the polite minimum.

### Gaps
- No PeerTube or Mastodon instance ToS text was retrieved that explicitly addresses third-party apps re-displaying video; kolektiva's and framatube's terms pages were not fetched. This should be checked per host before launch.
- No case law or Framasoft/Mastodon gGmbH policy statement on third-party aggregation was found in this pass.
