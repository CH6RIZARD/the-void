# Stream Department — Audit

_Measured 2026-09-17 against `main` @ 9b057b7. Every number below came from running
something, not from reading a comment._

## 1. What the app can actually play

`attemptSource` in [void2-final.html:5076](../void2-final.html#L5076) supports exactly
three source types:

| type | how it plays | what it needs from the server |
|---|---|---|
| `hls` | `<video>` + hls.js | **CORS** on the manifest (`Access-Control-Allow-Origin`) |
| `youtube` | iframe embed | video not deleted, embedding allowed, `liveVidFor` resolves |
| `mjpeg` | `<img>` | no CORS needed, but almost nothing publishes MJPEG any more |

There is no DASH, no WebRTC, no generic-iframe path. **Any source family we add that
is not HLS / YouTube / MJPEG is not a data problem, it is a player problem** — budget
for it explicitly instead of discovering it at probe time.

A second, less obvious constraint: the app is served over https, so **http-only
streams are mixed content and can never play**. That alone removes 19.2% of the
largest catalogue on earth (see §4).

## 2. Inventory today

| pool | entries | countries | notes |
|---|---|---|---|
| `IPTV_JSON` (`scripts/iptv-sources.generated.json`) | **508** | **80** | HLS, probed, capped at 8/country |
| `LIFE_JSON` (`scripts/life-sources.generated.json`) | **487** | **82** | YouTube; only **33** are `kind:"livecam"` |
| `CAM_SOURCES` + `RAW_FOOTAGE` | hand-curated | ~28 | mixed live / VOD |

IPTV distribution is top-heavy and pinned at the cap, which means the cap — not
availability — is what limits most countries:

```
8 streams: 51 countries   <- sitting exactly on the --per-country cap
7:  3     6:  3     5:  1     4:  6     3:  6     2:  4
1 stream:  6 countries  (Algeria, Somalia, Cuba, Mali, Ireland, Zimbabwe)
```

**True live inventory is ~541 streams** (508 HLS + 33 live cams). The other 454 LIFE
entries are recorded walking tours — good content, but not live.

The globe itself (`const C` at [void2-final.html:2522](../void2-final.html#L2522))
places **82 nations**. 111 UN members are not on the globe at all.

## 3. The gap, stated plainly

Target: every nation on earth, 30–40 live streams each.

```
193 nations x 30 =  5,790   (floor)
193 nations x 40 =  7,720   (ceiling)
have:                 541
```

**~11–14x the current live inventory — and the globe has to roughly 2.4x its nation
list before a single new stream has anywhere to live.**

## 4. Can iptv-org alone do it? No — measured.

iptv-org is the largest maintained catalogue and the one already wired in. Live
figures pulled today:

```
streams in catalogue        17,418
https (playable at all)     14,078   (80.8%)
countries with >=1 stream      177
```

I probed a random sample of 200 https streams the way a browser will (fetch with an
`Origin` header, require `#EXTM3U` plus CORS):

```
ok                     158   (79%)
403 forbidden           13
transport error         12
no CORS header           6
404                      4
not a manifest           3
400 / 453 / 500 / 503    4
```

**79% survival is far better than the current build assumes** — the pool of 508 is a
cap artifact, not a scarcity artifact. Extrapolated: **~11,100 playable HLS streams
exist in iptv-org right now.**

But the *distribution* is what defeats the goal. Estimated playable streams per UN
member (raw https count x 0.79):

| tier | nations | verdict |
|---|---|---|
| 30+ | **50** | iptv-org alone reaches the target |
| 8–29 | **53** | needs one more source family |
| 1–7 | **55** | needs three or four more source families |
| 0 | **33** | needs everything, and some will never reach 40 native TV feeds |

The zero tier is real places with real people: Bhutan, Botswana, Burundi, CAR,
Comoros, Djibouti, Dominica, Eswatini, Fiji, Gabon, Grenada, Guinea-Bissau, Kiribati,
Lesotho, Liberia, Liechtenstein, Madagascar, Malawi, Marshall Is., Mauritania,
Mauritius, Micronesia, Nauru, Palau, Sao Tome, Seychelles, Solomon Is., South Sudan,
Timor-Leste, Tonga, Tuvalu, Vanuatu, Zambia.

**Conclusion: a single-source script cannot meet this requirement.** The work is a
multi-source aggregation pipeline, and the plan has to say out loud which nations get
40 native live TV feeds and which get 40 *live things* of a different kind.

## 5. Five structural blockers found in the code

### B1 — The per-country cap is doing the damage, not the world

`--per-country 8` and `--candidates 40` at
[build-iptv-sources.js:60-62](../scripts/build-iptv-sources.js#L60). 51 of 80
countries sit exactly at 8. Raising the cap is the cheapest multiplier available and
costs nothing but probe time.

### B2 — Sources are baked into the HTML at build time

`inject-iptv.js` splices a JSON **string** into `void2-final.html`. At 508 streams
that block is ~66KB of an 800KB file. At 7,000 streams it becomes **~900KB shipped to
every user on every load** — and it is a static snapshot. IPTV URLs rot within weeks,
so a stale build means a wall of dead tiles with no fix short of a redeploy. This
architecture does not survive the target size. It has to become a served,
continuously re-verified registry.

### B3 — `void-proxy` has no HLS relay, and that is the biggest missed multiplier

[void-proxy/server.js:510](../void-proxy/server.js#L510) dispatches exactly three
paths: `/feed`, `/social`, `/health`. Every stream that fails the probe for **CORS
alone** (6/200 in the sample, plus most of the 403s, which are Origin/Referer checks
rather than true blocks) is recoverable by relaying the manifest through our own
origin. That is on the order of **10% of the catalogue — ~1,400 streams — discarded
today for a fixable reason.** It also unlocks whole provider families that will never
set CORS: national broadcasters, government traffic cams, municipal webcams.

### B4 — Country identity is string-keyed and alias-fragile

Pools are keyed by the app's display name ("United Kingdom"); iptv-org uses `UK`; ISO
says `GB`. My own tiering pass above reported the United Kingdom as having *zero*
streams purely because of that alias — a bug I hit within minutes of touching the
data. At 193 nations across half a dozen catalogues, name-keying will silently lose
whole countries. **Everything keys on ISO-3166-1 alpha-2; display names become a
presentation-only lookup.**

### B5 — Verification happens once, at build time, from one machine

Both builders warn "run from a NORMAL network", because a datacenter IP gets
geo-blocked and bakes "everything is dead" into the build. That warning is correct,
and it is also an admission that the model is wrong: a one-shot probe from one vantage
point cannot certify 7,000 streams for a global audience. Liveness is a *continuous*
property and needs a scheduled re-verifier with per-stream health history.

## 6. What is not broken

Worth saying, because the plan builds on these rather than around them:

- The **probe discipline** in `build-iptv-sources.js` is genuinely good — https-only,
  `#EXTM3U` plus CORS, and it follows a master playlist down to a variant so it
  rejects manifests that parse but never decode. Keep it; scale it.
- **Bars/slate detection** (`isBadStream`, decoded-frame inspection in
  `attemptSource`) catches the failure a manifest probe cannot: a channel that is
  "up" and showing a test card. That is the hard part, and it already exists.
- **`claimLiveKey`** enforces one-stream-one-place, so a bigger pool will not paint
  the same feed into eight tiles.
- The **editorial rules** in `build-iptv-sources.js` — drop multinational brands
  unless it is the broadcaster's home, drop movies/shopping/sports, collapse feed
  variants — are why the wall feels like *places* instead of a channel list. Every
  new source family runs through that filter, not past it.
