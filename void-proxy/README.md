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
  "metrics": { "score": 1234, "replies": 567 },
  "media": [ { "type": "image", "url": "https://…", "thumb": "https://…" } ]
}
```

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
