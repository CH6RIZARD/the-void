// THE WEB WALL PLAYS, AND PLAYS HLS.
//
// Three changes, one cause. The pool is probed server side, where CORS does not
// exist; the browser then refuses a share of it, and a tile that burns its whole
// chain on CORS-refused urls reads RETRYING forever. Meanwhile the "life" slots
// (3 of every 10) are YouTube by construction, so the wall still grew iframes
// with YouTube chrome - reported, correctly, for weeks.
//
//   1. void2-final.html: the WALL takes HLS only. No YouTube, no iframes, ever.
//      Country sections and the nation cinema keep their own chains.
//   2. void2-final.html: VOID_PROXY_BASE defaults to the production proxy (it
//      defaulted to '' - the deployed page had NO proxy, so /feed, /social and
//      any stream rescue were dead unless someone passed ?proxy=).
//   3. void2-final.html + void-proxy/server.js: when hls.js dies on a network
//      error before first play - which is what a CORS refusal looks like from
//      JS - the tile retries ONCE through the proxy's new /hls passthrough,
//      which rewrites the playlist so segments and keys ride through too.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const L = (...x) => x.join('\n');
const page = fileURLToPath(new URL('../void2-final.html', import.meta.url));
const srv = fileURLToPath(new URL('../void-proxy/server.js', import.meta.url));

const edit = (path, fn) => {
  let s = readFileSync(path, 'utf8'); const crlf = s.includes('\r\n'); s = s.replace(/\r\n/g, '\n');
  const rep = (a, b) => { const n = s.split(a).length - 1; if (n !== 1) { console.log('ANCHOR x' + n + ' in ' + path + ': ' + a.slice(0, 90)); process.exit(1); } s = s.split(a).join(b); };
  fn(rep);
  if (crlf) s = s.replace(/\n/g, '\r\n');
  writeFileSync(path, s);
};

edit(page, (rep) => {
  // ── 2. The deployed page gets the proxy by default ───────────────────────
  rep("const VOID_PROXY_BASE=(new URLSearchParams(location.search).get('proxy'))||localStorage.getItem('void_proxy')||'';",
      "// Default to the production proxy: the deployed page shipped with '' here, so\n// /feed, /social, translate and stream rescue were all silently off unless\n// someone passed ?proxy=. ?proxy= and localStorage still override.\nconst VOID_PROXY_BASE=((new URLSearchParams(location.search).get('proxy'))||localStorage.getItem('void_proxy')||'https://void-proxy-production.up.railway.app').replace(/\\/$/,'');");

  // ── 1. The wall is HLS only ──────────────────────────────────────────────
  rep(L(
"  const usable=s=>{",
"    if(!s||isBadStream(s))return false;             // bars/slate or removed/embed-disabled VOD",
  ), L(
"  const usable=s=>{",
"    if(!s||isBadStream(s))return false;             // bars/slate or removed/embed-disabled VOD",
"    // THE WALL IS HLS ONLY. A YouTube entry here becomes an iframe with YouTube",
"    // chrome on it, which this wall must never show - said and re-said for weeks.",
"    // The life pools are YouTube-heavy, so this mostly empties them; the news",
"    // pool (2,500+ probed .m3u8) fills whatever the mix cannot, which the",
"    // round-robin below already does. Country sections and the nation cinema",
"    // keep their own chains - this rule is the wall's alone.",
"    if(s.type!=='hls')return false;",
  ));

  // ── 3a. One retry through the proxy when hls.js dies before first play ───
  rep(L(
"            const hls=new Hls(liveHlsConfig());",
"            v.__hls=hls;                      // livePark / liveWake drive this",
"            hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(v.play)v.play().catch(()=>{});});",
"            // CURSOR #6 — post-PLAYING fatals used to no-op (finish already done)",
"            // and leave a black cell. Recover in place; only heal on hard death.",
"            hls.on(Hls.Events.ERROR,(_,d)=>{",
"              if(!d||!d.fatal)return;",
"              if(!done){finish(false);return;}",
"              try{",
"                if(d.type===Hls.ErrorTypes.NETWORK_ERROR){hls.startLoad();return;}",
"                if(d.type===Hls.ErrorTypes.MEDIA_ERROR){hls.recoverMediaError();return;}",
"              }catch(e){}",
"              cell.__needsHeal=true;",
"            });",
"            hls.loadSource(source.url);hls.attachMedia(v);",
"            teardown=()=>{try{hls.destroy();}catch(e){}v.remove();};",
  ), L(
"            // A connect-time NETWORK_ERROR is what a CORS refusal looks like from",
"            // here: the pool was probed server side, where CORS does not exist, so",
"            // a share of it can never load directly in a browser. Those urls get",
"            // ONE retry through the proxy's /hls passthrough, whose playlist",
"            // rewrite carries the segments and keys through as well. Everything",
"            // else about the attempt - the timer, the frame judge, the key claim -",
"            // is unchanged, and a url that fails through the proxy too fails the",
"            // attempt exactly as before.",
"            let triedProxy=false;",
"            const begin=(url)=>{",
"              const hls=new Hls(liveHlsConfig());",
"              v.__hls=hls;                      // livePark / liveWake drive this",
"              hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(v.play)v.play().catch(()=>{});});",
"              // CURSOR #6 — post-PLAYING fatals used to no-op (finish already done)",
"              // and leave a black cell. Recover in place; only heal on hard death.",
"              hls.on(Hls.Events.ERROR,(_,d)=>{",
"                if(!d||!d.fatal)return;",
"                if(!done){",
"                  if(!triedProxy&&VOID_PROXY_BASE&&d.type===Hls.ErrorTypes.NETWORK_ERROR){",
"                    triedProxy=true;",
"                    try{hls.destroy();}catch(e){}",
"                    begin(VOID_PROXY_BASE+'/hls?u='+encodeURIComponent(source.url));",
"                    return;",
"                  }",
"                  finish(false);return;",
"                }",
"                try{",
"                  if(d.type===Hls.ErrorTypes.NETWORK_ERROR){hls.startLoad();return;}",
"                  if(d.type===Hls.ErrorTypes.MEDIA_ERROR){hls.recoverMediaError();return;}",
"                }catch(e){}",
"                cell.__needsHeal=true;",
"              });",
"              hls.loadSource(url);hls.attachMedia(v);",
"              teardown=()=>{try{hls.destroy();}catch(e){}v.remove();};",
"            };",
"            begin(source.url);",
  ));
});

edit(srv, (rep) => {
  // ── 3b. /hls: a bounded media passthrough with playlist rewriting ────────
  rep("    if (path === '/' || path === '/health') {", L(
"    if (path === '/hls') {",
"      // A CORS shim for the wall, not an open proxy: the pool is probed server",
"      // side where CORS does not exist, so a share of its streams can never be",
"      // fetched by hls.js directly. This fetches one url, adds CORS, and - when",
"      // the body is an M3U8 - rewrites every URI line and URI=\"...\" attribute to",
"      // come back through here, so segments and keys follow without the client",
"      // knowing anything beyond the one rewritten url it retried.",
"      if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET only' });",
"      const raw = u.searchParams.get('u') || '';",
"      let target;",
"      try { target = new URL(raw); } catch (_) { return sendJson(res, 400, { error: 'bad url' }); }",
"      if (target.protocol !== 'http:' && target.protocol !== 'https:') return sendJson(res, 400, { error: 'http(s) only' });",
"      // SSRF guard: never fetch into the network this proxy stands in.",
"      const host = target.hostname.toLowerCase();",
"      if (host === 'localhost' || host === '0.0.0.0' || /^127\\./.test(host) || /^10\\./.test(host) || /^192\\.168\\./.test(host) ||",
"          /^172\\.(1[6-9]|2\\d|3[01])\\./.test(host) || /^169\\.254\\./.test(host) || host === '::1' || /^\\[?f[cd][0-9a-f]{2}:/.test(host)) {",
"        return sendJson(res, 400, { error: 'refused host' });",
"      }",
"      const ctl = new AbortController();",
"      const kill = setTimeout(() => ctl.abort(), 12000);",
"      let r;",
"      try {",
"        const h = { 'User-Agent': 'void-proxy/1.1 hls', Accept: '*/*' };",
"        if (req.headers.range) h.Range = String(req.headers.range); // segments seek",
"        r = await fetch(target.href, { headers: h, redirect: 'follow', signal: ctl.signal });",
"      } catch (e) {",
"        clearTimeout(kill);",
"        return sendJson(res, 502, { error: 'upstream unreachable' });",
"      }",
"      const ct = String(r.headers.get('content-type') || '').toLowerCase();",
"      const finalUrl = r.url || target.href;",
"      const looksM3u8 = /\\.m3u8(\\?|$)/i.test(finalUrl) || ct.includes('mpegurl') || ct.includes('vnd.apple');",
"      cors(res);",
"      if (looksM3u8) {",
"        // Playlists are small text; 2MB is already absurd for one.",
"        let text;",
"        try { text = await r.text(); } catch (e) { clearTimeout(kill); return sendJson(res, 502, { error: 'upstream read failed' }); }",
"        clearTimeout(kill);",
"        if (text.length > 2 * 1024 * 1024 || text.slice(0, 7) !== '#EXTM3U') return sendJson(res, 502, { error: 'not a playlist' });",
"        const abs = (ref) => { try { return new URL(ref, finalUrl).href; } catch (_) { return ref; } };",
"        const via = (href) => '/hls?u=' + encodeURIComponent(href);",
"        const out = text.split('\\n').map((line) => {",
"          const t = line.trim();",
"          if (!t) return line;",
"          // Key/map/media/part tags carry their url in URI=\"...\".",
"          if (t.startsWith('#')) return line.replace(/URI=\"([^\"]+)\"/g, (_, ref) => 'URI=\"' + via(abs(ref)) + '\"');",
"          return via(abs(t));",
"        }).join('\\n');",
"        res.writeHead(r.status, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });",
"        return res.end(out);",
"      }",
"      // Segments, keys, anything else: stream the bytes through untouched.",
"      const head = { 'Cache-Control': 'public, max-age=10' };",
"      if (ct) head['Content-Type'] = ct;",
"      const len = r.headers.get('content-length'); if (len) head['Content-Length'] = len;",
"      const cr = r.headers.get('content-range'); if (cr) head['Content-Range'] = cr;",
"      res.writeHead(r.status, head);",
"      try {",
"        if (r.body) { for await (const chunk of r.body) res.write(chunk); }",
"        res.end();",
"      } catch (e) {",
"        try { res.destroy(); } catch (_) {}",
"      } finally { clearTimeout(kill); }",
"      return;",
"    }",
"",
"    if (path === '/' || path === '/health') {",
  ));
  rep("        endpoints: ['/feed?mode=tension&limit=40', '/social?country=<name>&mode=tension&limit=30', 'POST /translate {texts:[...], target:\"en\"}'],",
      "        endpoints: ['/feed?mode=tension&limit=40', '/social?country=<name>&mode=tension&limit=30', '/hls?u=<m3u8 url>', 'POST /translate {texts:[...], target:\"en\"}'],");
});

console.log('wall is hls-only; proxy baked in; /hls passthrough with playlist rewriting');
