# Cursor prompt — deploy THE VOID to Railway end to end

Copy everything below the line into Cursor.

---

You are deploying an existing, working app. Do not refactor it. Do not rename
files. Do not "improve" code you were not asked to touch.

## Repo layout

Repo root: `d:\all projects`

- `void-proxy/` — Express API **and** static host for the UI. This is the thing
  being deployed. Node >= 18, ESM (`"type": "module"`), deps: express + cors only.
  - Reads `PORT` from the environment already.
  - `railway.json` exists (NIXPACKS, `npm start`, healthcheck `/health`).
  - Serves `public/index.html` at `/` and `public/void.html` at `/void.html`.
  - `public/` is generated — see build step. It is committed on purpose.
- `The Void/` — the app itself.
  - `void2-final.html` is the SOURCE. It is the only HTML edited by hand.
  - `build.js` generates the other builds from it and writes deploy copies into
    `void-proxy/public/`.
  - `void-app/` — the Expo app (React Native WebView shell) for iOS + Android.

Read `The Void/BUILDS.md` first. It explains the build split. Follow it.

## Goal

1. Deploy `void-proxy/` to Railway, on HTTPS.
2. Get the public URL.
3. Wire that URL into the Expo app so the phone loads its UI over the air.
4. Verify all of it with real requests.

## Step 1 — build

```bash
cd "d:/all projects/The Void"
node build.js
```

Expect: NATIVE + WEB regenerated, `void-proxy/public/void.html` and
`void-proxy/public/index.html` written, syntax OK, invariants OK.

If it errors with `patch "<name>" matched 0x in the source`, a patch anchor in
`build.js` no longer matches `void2-final.html`. Fix the patch in `build.js`.
**Do not** hand-edit the generated files — they are overwritten.

Commit `void-proxy/public/` — Railway builds from the repo, so the generated UI
must be in git.

## Step 2 — Railway

The Railway CLI is installed (`railway --version` → 4.35.0) but its token is
expired. Authenticate, then deploy `void-proxy` as the service root.

```bash
railway login              # opens a browser; use `railway login --browserless` if headless
cd "d:/all projects/void-proxy"
railway init               # create the project/service if it does not exist
railway up                 # deploy
railway domain             # generate the public HTTPS domain, print it
```

Requirements:
- Service root MUST be `void-proxy/`, not the repo root. If Railway is pointed at
  the monorepo root, set the service's root directory to `void-proxy`.
- Do not set `PORT` manually. Railway injects it and the server already reads it.
- No other env vars are required. `TWITTER_BEARER` / `YOUTUBE_API_KEY` are
  optional; their providers are inert without them.

## Step 3 — read the URLs back off the service

The service reports its own canonical config. Do not hand-assemble the URL.

```bash
curl https://<domain>/health
```

Expect JSON containing:

```jsonc
{
  "ok": true,
  "base": "https://<domain>",
  "ui": { "native": "https://<domain>/void.html", "web": "https://<domain>/" },
  "config": {
    "voidHtmlUrl":   "https://<domain>/void.html",
    "voidProxyBase": "https://<domain>"
  }
}
```

If `ui` is `null` and there is a `warning`, `public/` did not get deployed —
re-run Step 1, commit, redeploy. **Do not proceed past this point**: the API would
look healthy while every device silently falls back to a stale bundled UI.

## Step 4 — wire the app

Put the two values from `config` into `The Void/void-app/app.json` under
`expo.extra`:

```jsonc
"extra": {
  "eas": { "projectId": "<real id, see Step 5>" },
  "voidProxyBase": "https://<domain>",
  "voidHtmlUrl": "https://<domain>/void.html"
}
```

`app.config.js` already reads both, preferring `VOID_HTML_URL` /
`VOID_PROXY_BASE` env vars if set. Putting them in `app.json` makes them the
default so nobody has to remember to pass them.

Must be `https://`. iOS ATS blocks plain HTTP, and an HTTP-served UI can be
replaced in transit by anyone on the network.

## Step 5 — EAS

`app.json` currently has `"projectId": "REPLACE_WITH_YOUR_EAS_PROJECT_ID"`, which
will fail any build.

```bash
cd "d:/all projects/The Void/void-app"
eas whoami || eas login
eas init                   # writes the real projectId into app.json
eas build --platform ios --profile production
eas build --platform android --profile production
```

## Step 6 — verify (do not skip)

```bash
# 1. API is up
curl -s https://<domain>/health | jq '{ok, base, ui}'

# 2. Both UIs are served, and are the RIGHT builds
curl -s https://<domain>/void.html | grep -o "VOID_BUILD='[a-z]*'"   # -> 'native'
curl -s https://<domain>/         | grep -o "VOID_BUILD='[a-z]*'"   # -> 'web'

# 3. HTML must NOT be cached, or devices pin to an old UI
curl -sI https://<domain>/void.html | grep -i cache-control          # -> no-store

# 4. The feed actually returns content
curl -s "https://<domain>/feed?mode=tension&limit=20" | jq '.items | length'

# 5. Nothing regressed
cd "d:/all projects/void-proxy" && node --test          # expect 81/81 pass
cd "d:/all projects/The Void"   && node build.js --check # expect OK
```

All five must pass. If `/feed` returns 0 items, check the Railway logs for
`[sources]` and `[floor]` lines — the floor rejecting 100% of a source means that
source is misconfigured, not that the deploy failed.

## Constraints

- Do not hand-edit `void-proxy/public/*`, `The Void/copy33thevoid.html`, or
  `The Void/void-app/assets/void.html`. All generated. Edit `void2-final.html`
  and re-run `node build.js`.
- Do not add Reddit as a source. Its OAuth app is pending and the free tier is
  non-commercial only.
- Do not commit secrets. `.env` is gitignored; `.env.example` is the template.
- Do not change `railway.json`'s healthcheck path — `/health` is what the server
  exposes.

## Done means

`https://<domain>/` loads the web app in a browser, `https://<domain>/void.html`
returns the native build, `app.json` carries both URLs, `node --test` is 81/81,
and `node build.js --check` prints OK.
