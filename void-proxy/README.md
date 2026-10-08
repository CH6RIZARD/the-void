# void-proxy

A small, zero-dependency backend proxy that feeds the client in
`../void2-final.html` with live, tension-ranked social content.

The Reddit provider is **keyless and always on**, so the server works out of the
box with no configuration. An X (Twitter) provider activates only if you supply
a bearer token; a Threads provider is a documented stub.

## Run

```bash
cd "The Void/void-proxy"
npm i        # no dependencies — completes instantly
npm start    # -> node server.js, listens on http://localhost:8787
```

Requires **Node 18+** (uses the built-in global `fetch`; falls back to `https`
on older runtimes). Set a different port with `PORT=9000 npm start`.

## Connect the client

Open the app once with a `?proxy=` query param pointing at this server:

```
void2-final.html?proxy=http://localhost:8787
```

The client persists that value to `localStorage['void_proxy']`, so subsequent
opens (without the param) keep using the proxy. To disconnect, clear that
localStorage key. **Do not edit the HTML** — it is already wired for this.

## Endpoint contract

### `GET /feed?mode=tension&limit=40`
Global aggregated feed across all enabled providers.

### `GET /social?country=<name>&mode=tension&limit=30`
Country-scoped feed. `<name>` is a display name (e.g. `Ukraine`, `Israel`).
Unknown countries fall back to global geopolitics subreddits.

Both return:

```json
{ "items": [ POST, ... ] }
```

`mode` may be `tension` (controversy ranking, default) or anything else
(newest-first). `limit` is clamped to 1..100.

### `GET /reels?limit=30&offset=0`
Posts from the last 48h that carry a playable clip, ranked by engagement per
hour of age (most engaged and newest first). Same shape, paging and caching as
`/feed`; `mode` is ignored. X contributes a dedicated `has:videos` query (one
more query against the X budget, see "X spend caps"); Reddit contributes the
clips in its global pool. Reddit graphic items are included with `graphic: true`.

### `GET /curated?limit=30`
The curator's LLM-labelled clips, best first, in the `/reels` item shape plus
`caption`, `genre`, `topic` and `fit` (0-1). `{ items, generated }`; empty until
the first push. Same caching as `/feed`.

### `POST /curated/ingest`
Body = `scripts/curated.public.json` (`{ generated, items: [{ key, platform,
text, caption, video, thumb, url, createdAt, likes, reposts, graphic, genre,
topic, fit, labeledAt }] }`, 2MB max). Header `x-curator-key` must equal
`CURATOR_KEY`; 401 otherwise, and always 401 when the env is unset. Replaces the
whole list in memory (a redeploy empties it until the next push). Returns
`{ ok: true, count }`; items without an `http(s)` `video` are dropped.

```
curl -X POST "$PROXY/curated/ingest" -H "x-curator-key: $CURATOR_KEY" \
  -H "Content-Type: application/json" --data-binary @scripts/curated.public.json
```

### POST shape

```jsonc
{
  "id": "reddit_abc123",
  "platform": "reddit",          // 'reddit' | 'x' | 'threads' | ...
  "author": "display name",
  "handle": "u/name",            // or @name for X
  "country": "Ukraine",          // '' for the global feed
  "text": "post title / body",
  "url": "https://…",
  "createdAt": 1722200000000,    // epoch MS
  "metrics": { "score": 1234, "replies": 567, "views": 0 }, // views: X video plays
  "graphic": false,              // NSFW / possibly_sensitive: veil it, never drop it
  "media": [ { "type": "image", "url": "https://…", "thumb": "https://…" } ]
}
```

X videos carry the best playable variant as `url` and the poster as `thumb`:
on `/reels` HLS when offered, everywhere else the richest mp4 under 2.5Mbps
(the web feed card and thread view play a bare `<video src>`, which cannot
play HLS). Every endpoint still omits graphic X posts, because no client reads
`graphic` yet; sensitive X posts whose text reads as sexual are always dropped.

CORS: every response sends `Access-Control-Allow-Origin: *`, so the client can
fetch from a `file://` page or any other origin.

Extra: `GET /` or `/health` returns `{ ok, endpoints, providers }` for a quick
sanity check.

## Providers

The registry lives in `server.js`. Each provider implements the
`SocialProvider` interface:

```js
class SocialProvider {
  async fetchGlobal({ mode, limit })            // -> Promise<POST[]>
  async fetchByCountry({ country, mode, limit }) // -> Promise<POST[]>
}
```

| Provider          | Status        | Key needed        | Notes |
|-------------------|---------------|-------------------|-------|
| `RedditProvider`  | real, on      | none              | Pulls `hot`/`rising`/`controversial` from per-nation + global subs; extracts image/video from `preview`/`media`/galleries. |
| `XProvider`       | real, opt-in  | `X_BEARER` env    | X API v2 recent search. Inert (`[]`) when the key is absent. Never hardcoded. |
| `ThreadsProvider` | stub          | n/a               | No public firehose API exists; returns `[]`. Seam left for a future authorized/licensed adapter. |

If a provider throws, it is skipped — the endpoint still returns whatever the
others produced and never 500s the whole response.

### Env keys

Copy `.env.example` to `.env` (gitignored):

- `PORT` — listen port (default `8787`).
- `X_BEARER` — X API v2 bearer token; enables `XProvider` when present.
- `REDDIT_CLIENT_ID` / `REDDIT_SECRET` — from a **script** app at
  <https://www.reddit.com/prefs/apps>. See below.
- `REDDIT_USERNAME` — your Reddit handle, used only to build a compliant
  User-Agent. `REDDIT_USER_AGENT` overrides the whole string.
- `CURATOR_KEY` — shared secret the curator sends as `x-curator-key` on
  `POST /curated/ingest`. Unset = pushes refused.

### Reddit auth

Unauthenticated `www.reddit.com/*.json` answers **403** from anything that looks
like a server, so the keyless path only ever worked from a browser-ish IP. With
credentials the provider fetches an application-only token
(`client_credentials`, no user login) and reads from `oauth.reddit.com` at
100 req/min instead of 10.

Set up: <https://www.reddit.com/prefs/apps> -> create app -> type **script** ->
redirect uri `http://localhost:8787/` (required by the form, unused). The client
ID is the string under the app name; the secret is the `secret` field.

Without the keys everything still runs — the provider silently uses the keyless
host, and a bad key logs once and degrades the same way rather than failing the
feed. `GET /health` reports `reddit: { auth: "oauth" | "keyless", userAgent }`.

Reddit free tier is **non-commercial**; once the app earns money you need a
commercial agreement (<https://redditinc.com/policies/developer-terms>).

### Translation

`POST /translate` with `{ texts: ["..."], target: "en" }` returns
`{ translations: ["..."] }`, aligned with the input. It runs on DeepL and needs
`DEEPL_KEY` (<https://www.deepl.com/pro-api>). Free keys end in `:fx` and stop at
500k characters/month instead of billing you. Results are cached server-side, so
a thread translated for one reader costs nothing for the next.

Limits, because the endpoint is public: 50 texts and 20k characters per request,
30 requests/minute per IP. With no key it answers **503**, and the app falls
back to Google's free endpoint by itself. That endpoint blocks by IP without
warning, so it is not something to launch on.

### X spend caps

X bills **per post read** ($0.005 each on pay-per-use), so `XProvider` is the only
provider that costs money. Four limits keep that bounded:

| Key | Default | Effect |
|---|---|---|
| `X_DAILY_POSTS` | `1000` | Posts read per UTC day — a $5/day ceiling. `0` turns X off. |
| `X_MAX_RESULTS` | `10` | Posts per API call (10 is the API minimum). |
| `X_CACHE_MS` | `3600000` | How long one query is reused before paying again (60 min). |
| `X_MAX_SHARE` | `0.15` | Share of a returned page that may be X items — only while Reddit is authed. |

The global feed runs three X queries per refresh (conflict, unrest, disaster —
each paired with the first-hand filter) and merges them, so one page draws from
several events instead of whichever term relevancy favoured. Cost per day is
`3 queries x 10 posts x 24 windows = 720` reads for the feed, plus 240 for `/reels`,
under the 1000 ceiling; `test.js` asserts this arithmetic against the constants.

Without `REDDIT_CLIENT_ID`/`REDDIT_SECRET`, Reddit is 403 and there is nothing
to ration X against, so `X_MAX_SHARE` is ignored and the whole page may be X.

The cap is **global, not per user** — and that is the cheaper direction. The proxy
serves every user from one shared 60s cache, so a per-user budget would mean
per-user fetches; capping globally means the second user through the door reads
the first user's posts for free.

Spending is counted in `.x-budget.json` beside `server.js`, so a crash-restart
loop cannot re-spend the day. On an ephemeral host that file dies with the
container, so the cap protects a running day, not a redeploy day. `GET /health`
reports `xBudget: { dailyPosts, spentToday, left, maxShare }`. When the budget is
gone X reads exactly like an absent key: `[]`, and the feed falls back to Reddit.

## Tension ranking

`tensionScore(post)` combines three signals so a post needs both real
engagement and a controversy signal to rise:

1. **Engagement velocity** — `(score + replies)` decayed by post age
   (`ageHours^0.8`). Captures content blowing up *right now*.
2. **Divisiveness proxy** — log-damped comment-to-score ratio. Threads with far
   more comments than upvotes read as arguments/controversy, not quiet
   consensus.
3. **Keyword weight** — matches against a conflict/controversy term list
   (`war`, `strike`, `protest`, `ceasefire`, `scandal`, …), capped at +125%.

The three combine as `velocity * divisiveness * keyword`. `mode=tension` sorts
descending by this score; any other mode sorts newest-first.

## Per-nation subreddit map

`COUNTRY_SUBS` in `server.js` maps countries to subreddit sets, covering the
tension-ranked nations (Ukraine, Russia, Israel, Palestine, Iran, Syria, Yemen,
Sudan, and more). Unknown countries fall back to `GLOBAL_SUBS`
(`worldnews`, `geopolitics`, …). Edit the map to tune coverage.

## Caching

Each `endpoint + params` combination is cached in memory for 60s to avoid
hammering Reddit. Restart the server to clear it.
