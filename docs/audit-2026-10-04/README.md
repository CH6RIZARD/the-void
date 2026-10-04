# 2026-10-04 audit — security + performance (three parallel reviewers)

## Security (ranked; items 1-4 FIXED in the same-day batch, verified live)
1. **FIXED — Stored XSS → account takeover (web):** `?proxy=` persisted unvalidated + `esc()` not escaping quotes + raw media-url attribute sinks. Fix: origin allowlist enforced on read AND write, quote-escaping in esc(), `safeMediaUrl()` on src sinks. Residual: audit also recommends a CSP meta tag (open).
2. **FIXED — /hls SSRF:** bracketed IPv6, IPv4-mapped loopback, CGNAT, DNS-inward names and redirect hops all bypassed the guard. Fix: per-hop manual redirects + dns.lookup against a net.BlockList + 30MB byte cap + backpressure. Residual: lookup/connect TOCTOU accepted; HMAC-signed child URLs would close it (open).
3. **FIXED — health-map poisoning:** 3 anonymous reports could kill any stream for everyone. Fix: per-IP rate limit (10/min), dead verdicts require 3 DISTINCT reporter addresses, size-cap computed once. Residual: pool-membership allowlist (open).
4. **FIXED — /translate quota drain:** request-counted limit + client-spoofable first-XFF ip. Fix: last-XFF ip, 25k chars/day/ip, 400k/day global.
5. OPEN — handle-login limiter keyed on spoofable XFF (supabase/functions/handle-login).
6. PARTLY FIXED — mode allowlisted; country allowlist + cache eviction caps still open.
7. OPEN — auth deep-link session injection: switch to PKCE (`flowType:'pkce'` + pending-attempt gate).
8. OPEN — CI: `${{ inputs.profile }}` shell interpolation, no `permissions:` blocks, unpinned eas-cli/yarn.
9. OPEN (low) — WebView `originWhitelist:['*']` + unanchored EMBEDDABLE_IFRAME regex.
Secrets scan: clean (full git history; only the anon JWT + public Brightcove tokens).

## Native perf (top items; R/M/A/N ids from the full agent report in session log)
Fix-first five: AudioOwner context fan-out (one tap re-renders the whole wall); static textures import in app/_layout defeating the deferred-require boot; allPosts never trimmed when the proxy path returns early (voidFeed.ts:30 vs :36); reaction-store global version re-rendering every mounted card app-wide; wall-scroll onScrollActive re-rendering GlobeSurfaces ~60x/s. Plus: MJPEG tiles re-downloading a full JPEG every 1s with remount-per-frame; DM polls overlapping (15s+60s+5s); 8MB earth pixels pinned forever after upload.

## Web/proxy perf (top items)
/feed cache keyed by mode but fetch ignores mode (36 reddit req/min guaranteed → 429s) + no in-flight coalescing; parked HLS tiles keep hls.js+buffers forever (linear memory growth with scroll); pullLivePosts 120s timer runs hidden+off-tab; NO SIGNAL tiles re-heal every 12s forever with unaborted manifest races; /streams/health re-serializes ~600KB uncompressed per request; reels IO rebuilt per append (the stop-on-card-never-plays bug); allPosts unbounded + linear lookups; sparkles animating under reels mode and on offscreen offline tiles.

Full agent reports are in the session transcript (2026-10-04); this file is the ranked index.
