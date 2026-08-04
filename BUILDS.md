# THE VOID — builds

Three files, one source. **Only `void2-final.html` is edited by hand.**

| | file | build | grid | shipped as |
|---|---|---|---|---|
| **SOURCE** | `void2-final.html` | `mobile` | 2-wide | the canonical app — all shared work lands here |
| **NATIVE** | `void-app/assets/void.html` | `native` | 2-wide | bundled by the Samsung/iOS shell via `require()` |
| **WEB** | `copy33thevoid.html` | `web` | 3-wide | browser / PWA |

```
node build.js          regenerate NATIVE and WEB from SOURCE, applying each build's patches
node build.js --check   verify only — non-zero exit if a target has drifted (use in CI)
```

## How changes reach each build

A feature goes into **`void2-final.html`**. `node build.js` regenerates the other
two from it and re-applies their patch sets, so the feature lands in both without
being copied by hand.

The targets are **not** byte-identical to the source or to each other — each one
carries its own patches. That is the point: the native shell and the browser are
different environments and get patched accordingly.

- **NATIVE** — 2-wide grid, `VOID_NATIVE_SHELL=true`. Runs inside a WebView that
  provides `window.ReactNativeWebView` and the sensing bridge.
- **WEB** — 3-wide grid (constant, CSS columns, and the pre-paint `g3` class),
  `VOID_NATIVE_SHELL=false`. No shell.

## Do not hand-edit a target

`void-app/assets/void.html` and `copy33thevoid.html` are **generated**. Anything
edited into them directly is overwritten on the next build. That is deliberate:
it keeps the divergence between builds to one readable list (`TARGETS[].patches`
in `build.js`) instead of letting it accumulate invisibly across three files.

A build-specific difference belongs in that patch list and nowhere else.

## Patches fail loudly

Each patch must match its anchor in the source **exactly once**. If the source
changes shape so an anchor no longer matches, the build throws and names the
patch:

```
Error: web: patch "globe wall columns" matched 0x in the source (need exactly 1).
The source changed shape — update the patch, do not hand-edit the target.
```

This is the important property. The alternative — a patch that silently matches
zero times — ships a web build quietly running the mobile layout.

## Invariants

`build.js` asserts these in all three files on every run. They are regressions
this codebase has actually shipped, so they are checked rather than trusted.

**Must be absent**
- `REEL_FEEDS.concat(BSKY_FEEDS)` — reels must never fall back to the feed's news
  sources. That is what made reels look like the feed replayed.
- `over_18||!d.id` — combat/NSFW must not be rejected at ingest. It is tagged
  `graphic` and the per-user ranker decides.
- `localStorage.getItem('v_grid3')` — the grid is a build property, not a runtime
  preference. A stored override would let a build render as the wrong one.

**Must be present**
- `isNewsAccount` — no ingesting news orgs (reposts and VOID-native accounts exempt)
- `reelBlocked` — reel moderation/author label gate
- `REEL_BLOCK_TOPIC` — reel pet/wildlife filter
- `pullPeerTubeReels` — the PeerTube reel lane
- `void_seen_ids` — persisted cross-session dedupe

## Hosting — Railway

One Railway service (`void-proxy/`) serves the API **and** both UIs, same origin:

| route | serves |
|---|---|
| `/` | WEB build (browser / PWA) |
| `/void.html` | NATIVE build — what the phone's WebView loads |
| `/feed`, `/social`, `/streams`, `/health` | the proxy API |

`node build.js` writes the generated builds into `void-proxy/public/`, so
deploying the proxy deploys the current UI. `railway.json` pins the start command
and a `/health` healthcheck; `PORT` is already read from the environment.

### Getting your URLs

Railway assigns the subdomain when the service is created, so it is not knowable
until then. The service reports it back — after the first deploy:

```
curl https://<your-app>.up.railway.app/health
```

```jsonc
{
  "base": "https://<your-app>.up.railway.app",
  "config": {                      // paste into void-app/app.json -> expo.extra
    "voidHtmlUrl":   "https://<your-app>.up.railway.app/void.html",
    "voidProxyBase": "https://<your-app>.up.railway.app"
  }
}
```

It reads `RAILWAY_PUBLIC_DOMAIN`, which Railway injects at runtime. If `public/`
is missing (a deploy that forgot `node build.js`), `/health` returns `ui: null`
and a `warning` — otherwise the API would look healthy while every device silently
fell back to its stale bundled UI.

**Set this once, on the native build:**

```
VOID_HTML_URL=https://<your-app>.up.railway.app/void.html
```

Railway terminates TLS, so this is HTTPS by default — which iOS ATS requires and
which stops anyone on the network from swapping out your entire UI.

Optionally point the app at the same host for the API:

```
VOID_PROXY_BASE=https://<your-app>.up.railway.app
```

HTML is served `Cache-Control: no-store`. That is deliberate: a cached copy at the
CDN or in the WebView would pin devices to an old UI and make a deploy look like
it did nothing.

### Deploying

```
node build.js     # in The Void/ — regenerates all builds + void-proxy/public/
git push          # Railway builds and restarts
```

Devices pick up the new UI on next launch or foreground.

## Shipping a UI change to devices — no rebuild

The app loads `void.html` **from a URL at runtime**. The bundled asset is only the
offline fallback. So shipping a UI change is:

```
node build.js                      # regenerate NATIVE from source
<upload void-app/assets/void.html> # to whatever host VOID_HTML_URL points at
```

Devices pick it up on next launch or when the app is foregrounded. No rebuild, no
store review.

Set the URL at build time:

```
VOID_HTML_URL=https://yourhost.example/void.html eas build ...
```

Leave `VOID_HTML_URL` unset and the app uses the bundled asset — the old
rebuild-every-time behaviour.

### It fails safe

Tested against a live server for every path. If anything is wrong with the remote
copy, the app renders the **bundled** one instead of showing an error:

| condition | result |
|---|---|
| valid remote UI | remote |
| 404 / 500 from host | bundled |
| captive portal returning 200 | bundled |
| host unreachable (offline) | bundled |
| slow host | bundled, aborts at 4s |
| `VOID_HTML_URL` unset | bundled |
| remote fails *mid-load* | bundled (`onError`) |

The captive-portal case matters: a hotel WiFi login page returns HTTP 200, so a
naive check would replace the app with a sign-in screen. The probe requires
`id="void-feed"` in the body before it will trust a response.

`localStorage` survives across loads (same origin every time), so the seen-set,
cursors and interest model are not reset by an update.

## When a native rebuild IS still required

Only for **native** changes — a new native module, a permission, an SDK upgrade,
an icon or splash change. Those are rare. UI, feed rules, filters, ranking and
layout all ship over the air.
