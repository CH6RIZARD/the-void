#!/usr/bin/env node
/**
 * build-iptv-sources.js — generate a verified, non-YouTube live source pool.
 *
 * WHY
 * The wall is ~96% YouTube in practice. Of 240 declared sources, 209 are
 * YouTube; and 11 of 16 probed non-YouTube sources answer
 * X-Frame-Options: SAMEORIGIN, meaning they can NEVER render in an iframe
 * (every skylinewebcams entry — Ukraine, Israel, Palestine, Lebanon, Iran,
 * Iraq, Pakistan). One provider's policy change takes the whole wall down, and
 * 9 of 13 news channels were dark when probed.
 *
 * HLS sidesteps framing policy entirely: an .m3u8 needs CORS, not embed
 * permission, and hls.js is already wired into attemptSource.
 *
 * iptv-org publishes a maintained country-tagged catalogue (channels.json carries
 * an ISO-2 `country`, which is the country the channel is FROM — its own feed of
 * a brand, e.g. SkyNews.ie vs SkyNews.uk).
 *
 * WHAT IT DOES
 *   1. pull the catalogue
 *   2. map ISO-2 -> the app's own country names (read from the C array;
 *      iptv-org spells the United Kingdom "UK", the C array "GB")
 *   3. keep only channels that are OF that nation:
 *        - multinational brands (Al Jazeera, DW, France 24, BBC, CNN, Euronews,
 *          Sky News, NHK World, Pluto TV, AXN, Viasat, ...) are dropped unless the
 *          nation is the broadcaster's home
 *        - movies / series / kids / animation / shop / sports / xxx channels are
 *          dropped: they are content, not a live picture of the place
 *        - a channel about another nation (Iran International in London, BBC
 *          Arabic, CGTN Russian, exile channels) is dropped
 *        - language / feed variants of one brand collapse to one per nation, and a
 *          region-suffixed feed of a foreign brand ("Dunya News UK") is dropped
 *        - closed / replaced channels are dropped
 *      (the app repeats the global-broadcaster rule at runtime: nationSourceForeign)
 *   4. rank: news / legislative / public / weather, then general / culture / local,
 *      then everything else
 *   5. PROBE the way a browser will play it — liveness AND playability:
 *        https only (the app is served over https; http is mixed content)
 *        manifest serves #EXTM3U with an Access-Control-Allow-Origin header
 *        a master playlist's first variant also serves #EXTINF with CORS
 *      Mirrors of one channel are probed in turn and the first that passes wins,
 *      so one channel costs one slot (the panel dedupes by label anyway).
 *   6. per country: ONE url per channel, cap, sort by rank then probe latency
 *   7. a channel name that two countries both carry (different broadcasters
 *      that happen to share a name — "ATV", "Channel 24") gets the country
 *      suffixed, so no label is ever claimed by two nations
 *   8. write scripts/iptv-sources.generated.json
 *
 * Run from a NORMAL network. From a datacenter IP many broadcasters geo-block
 * or rate-limit and you will bake "everything is dead" into the build — the
 * same trap resolve-live.js warns about.
 *
 *   node scripts/build-iptv-sources.js
 *   node scripts/build-iptv-sources.js --target 800 --per-country 8
 *   node scripts/build-iptv-sources.js --only "Kenya,Serbia"   # re-probe some nations, merge into existing file
 *   node scripts/build-iptv-sources.js --cache probe-cache.json --cache-hours 3   # reuse recent successful probes
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API = 'https://raw.githubusercontent.com/iptv-org/api/gh-pages/';
const OUT = path.join(__dirname, 'iptv-sources.generated.json');

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const TARGET        = parseInt(arg('target', '800'), 10);
const PER_COUNTRY   = parseInt(arg('per-country', '8'), 10);
const CANDIDATES    = parseInt(arg('candidates', '40'), 10);   // channels probed per country
const CONCURRENCY   = parseInt(arg('concurrency', '24'), 10);
const PROBE_MS      = parseInt(arg('timeout', '6000'), 10);
const ONLY          = arg('only', '') ? new Set(arg('only', '').split(',').map(s => s.trim())) : null;
const ORIGIN        = 'https://thevoid.app';

const TIER0 = new Set(['news', 'legislative', 'politics', 'public', 'weather']);
const TIER1 = new Set(['general', 'culture', 'local', 'business', 'education']);
const EXCLUDE_CATS = new Set(['movies', 'series', 'kids', 'animation', 'shop', 'xxx', 'sports']);
const CACHE = arg('cache', '');   // --cache <file>: reuse probe results younger than --cache-hours (default 12)
const CACHE_H = parseFloat(arg('cache-hours', '12'));

// A channel FROM one nation but ABOUT another (London's Iran International, BBC
// Persian, a diaspora feed) is not that nation's picture. Aliases beyond the C names.
const NATION_ALIASES = {
  'Iran': ['persian', 'farsi', 'irane', 'iranian'], 'Afghanistan': ['afghan'], 'India': ['bharat', 'hindi'],
  'Pakistan': ['urdu'], 'China': ['chinese'], 'Russia': ['russian'], 'Turkey': ['turkish'], 'Israel': ['hebrew'],
  'United States': ['usa', 'america'], 'United Kingdom': ['uk', 'british'], 'Ukraine': ['ukrainian'],
  'North Korea': ['dprk', 'korean', 'choson'], 'South Korea': ['korean'], 'France': ['french'],
  'Germany': ['deutsch', 'german'], 'Saudi Arabia': ['saudi'], 'Somalia': ['somali'],
};
function mentionsOtherNation(label, own, names) {
  const t = ' ' + String(label).toLowerCase().replace(/[^a-z0-9À-￿]+/g, ' ') + ' ';
  if (/palestin/.test(t)) return 'Palestine';
  const ownWords = [own.toLowerCase(), ...(NATION_ALIASES[own] || [])];
  if (ownWords.some(w => t.includes(' ' + w + ' '))) return null;   // names itself: its own
  for (const n of names) {
    if (n === own) continue;
    for (const w of [n.toLowerCase(), ...(NATION_ALIASES[n] || [])]) if (t.includes(' ' + w + ' ')) return n;
  }
  // A foreign-language service ("BBC Arabic", "CGTN Russian") speaks to other nations.
  for (const [w, home] of Object.entries(LANGUAGE_NATIONS)) if (t.includes(' ' + w + ' ') && !home.includes(own)) return w;
  // Exile / opposition channels licensed in one nation, about another.
  if (/almahriah|elsharq|mekameleen|iranefarda|iran international|afghanistan international|manoto/.test(t)) return 'exile';
  return null;
}
const ARAB = ['Saudi Arabia', 'United Arab Emirates', 'Egypt', 'Iraq', 'Jordan', 'Lebanon', 'Libya', 'Syria', 'Tunisia', 'Algeria', 'Morocco', 'Yemen', 'Sudan', 'Somalia'];
const LANGUAGE_NATIONS = {
  arabic: ARAB, persian: ['Iran', 'Afghanistan'], farsi: ['Iran', 'Afghanistan'], dari: ['Afghanistan'], pashto: ['Afghanistan', 'Pakistan'],
  urdu: ['Pakistan'], hindi: ['India'], russian: ['Russia', 'Belarus', 'Kazakhstan', 'Ukraine'], turkish: ['Turkey'],
  chinese: ['China', 'Taiwan'], mandarin: ['China', 'Taiwan'], spanish: ['Spain', 'Mexico', 'Argentina', 'Bolivia', 'Chile', 'Colombia', 'Cuba', 'Peru', 'Venezuela'],
  espanol: ['Spain', 'Mexico', 'Argentina', 'Bolivia', 'Chile', 'Colombia', 'Cuba', 'Peru', 'Venezuela'],
};
// Language / feed variants of one brand ("CGTN Arabic", "i24NEWS French", "RT Balkan")
// are one channel to a viewer: keep the best-ranked variant per nation.
const VARIANT_WORDS = /\b(english|arabic|french|spanish|espanol|español|espanhol|russian|hebrew|chinese|portuguese|german|turkish|persian|world|international|global|balkan|africa|afrique|maghreb|monde|europe|asia|premium|plus|hd|sd|fhd|uhd|4k|live|un|de|en|fr|es|ar|tv|\d+)\b/gi;
const brandKey = l => String(l).toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').replace(/\b(uk|usa|us|north america|america|canada|australia|middle east)\s*$/, '').replace(VARIANT_WORDS, ' ').replace(/[^a-z0-9À-￿]+/g, ' ').trim() || String(l).toLowerCase();
const REGION_SUFFIX = /\b(uk|usa|us|north america|america|europe|international|canada|australia|middle east)\s*$/i;

// Brands that broadcast to many nations. [name/network pattern, home ISO-2 or null
// for "no nation's own picture"]. A nation keeps the brand only when it is home.
const MULTINATIONAL = [
  [/al ?jazeera/i, 'QA'], [/\bdw\b|deutsche welle/i, 'DE'], [/france ?24/i, 'FR'], [/\btv5 ?monde/i, 'FR'],
  [/\bbbc\b/i, 'GB'], [/bloomberg/i, 'US'], [/aaj tak/i, 'IN'], [/\bcnn\b/i, 'US'], [/\bcnbc\b/i, 'US'],
  [/euronews/i, null], [/\bsky news\b(?! arabia)/i, 'GB'], [/nhk world/i, 'JP'], [/\bcgtn\b/i, 'CN'],
  [/trt world/i, 'TR'], [/\bwion\b/i, 'IN'], [/africanews|africa ?24/i, null], [/\bi24 ?news\b/i, 'IL'],
  [/al ?arabiya|al ?hadath/i, 'SA'], [/sky news arabia/i, 'AE'], [/^rt\b|\brt (news|arabic|documentary|español|espanol|de|france|balkan)\b/i, 'RU'],
  [/telesur/i, 'VE'], [/press tv/i, 'IR'], [/\bal ?alam\b/i, 'IR'], [/cgntv/i, 'KR'], [/arirang/i, 'KR'],
  [/voice of america|\bvoa\b/i, 'US'], [/\bfox news\b/i, 'US'], [/newsmax/i, 'US'], [/\bnbc news\b/i, 'US'],
  [/pluto ?tv/i, null], [/\baxn\b|disney|nickelodeon|cartoon network|national geographic|nat ?geo|discovery|viasat|cinemaworld/i, null],
  [/fashion ?tv|\bftv\b|\bxite\b|red bull|fuel tv|setanta|\bf1 channel\b|motorvision|wildearth|bondi rescue|curiosity ?now/i, null],
  [/\b3abn\b|\bgod ?tv\b|daystar|\btbn\b|hope channel|ewtn|supreme master|miracle channel/i, null],
  [/tna wrestling|top barca|\bsci ?fi\b|\bhgtv\b|persiana|premier sports|\bmtv\b|\bvh1\b|bollywood|lollywood/i, null],
];
function multinationalHome(ch) {
  const text = [ch.name, ...(ch.alt_names || []), ch.network || ''].join(' | ');
  for (const [re, home] of MULTINATIONAL) if (re.test(text)) return { home };
  return null;
}

/** ISO-2 -> app country names, read from the real C array so they always match. */
function appCountries() {
  const html = fs.readFileSync(path.join(ROOT, 'void2-final.html'), 'utf8');
  const i = html.search(/const C\s*=\s*\[/);
  if (i < 0) throw new Error('could not find the C country array in void2-final.html');
  let depth = 0; const j = html.indexOf('[', i); let k = j;
  for (; k < html.length; k++) {
    if (html[k] === '[') depth++;
    else if (html[k] === ']') { depth--; if (!depth) break; }
  }
  const map = {};
  const body = html.slice(j, k + 1);
  for (const m of body.matchAll(/n:\s*['"]([^'"]+)['"][^}]*?iso:\s*['"]([A-Za-z]{2})['"]/g)) {
    map[m[2].toUpperCase()] = m[1];
  }
  if (map.GB && !map.UK) map.UK = map.GB;   // iptv-org: UK
  return map;
}

async function getJSON(name) {
  const r = await fetch(API + name, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(name + ' HTTP ' + r.status);
  return r.json();
}

const corsOk = r => { const a = r.headers.get('access-control-allow-origin'); return a === '*' || a === ORIGIN; };
async function get(url, extra = {}) {
  return fetch(url, {
    signal: AbortSignal.timeout(PROBE_MS), redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36', Origin: ORIGIN, Referer: ORIGIN + '/', ...extra },
  });
}
/**
 * Playable = what hls.js will need: https, CORS on the manifest, and for a master
 * playlist a variant that also answers with CORS and real segments. Range-limited
 * GET, not HEAD: many CDNs answer HEAD with 405 while serving GET fine.
 * Returns latency in ms, or a string reason.
 */
async function probe(url) {
  if (!/^https:/i.test(url)) return 'http';
  const t0 = Date.now();
  try {
    const r = await get(url);
    if (!r.ok) return 'status ' + r.status;
    if (!corsOk(r)) return 'no-cors';
    const text = (await r.text()).slice(0, 65536);
    if (!text.includes('#EXTM3U')) return 'not-m3u8';
    if (/#EXT-X-STREAM-INF/i.test(text)) {
      const line = text.split(/\r?\n/).map(s => s.trim()).find(s => s && !s.startsWith('#'));
      if (!line) return 'no-variant';
      const vu = new URL(line, r.url || url).href;
      if (!/^https:/i.test(vu)) return 'http-variant';
      const v = await get(vu);
      if (!v.ok) return 'variant ' + v.status;
      if (!corsOk(v)) return 'variant-no-cors';
      const vt = (await v.text()).slice(0, 65536);
      if (!/#EXTINF/i.test(vt)) return 'variant-empty';
    } else if (!/#EXTINF/i.test(text)) return 'empty';
    return Date.now() - t0;
  } catch (e) { return 'error'; }
}

async function pool(items, worker, n) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const at = i++; out[at] = await worker(items[at]); }
  }));
  return out;
}

(async () => {
  const iso2name = appCountries();
  const name2iso = {}; for (const [iso, n] of Object.entries(iso2name)) if (iso !== 'UK') name2iso[n] = iso;
  console.log('app countries mapped from C array :', Object.keys(name2iso).length);

  const [streams, channels] = await Promise.all([getJSON('streams.json'), getJSON('channels.json')]);
  console.log('iptv-org streams / channels       :', streams.length, '/', channels.length);

  const byId = {};
  for (const c of channels) byId[c.id] = c;
  const drops = { foreign: 0, category: 0, closed: 0, http: 0, about_other_nation: 0 };
  const allNames = Object.keys(name2iso);

  // country -> channelId -> {label, tier, urls[]}
  const byCountry = {}; const seen = new Set();
  for (const s of streams) {
    if (!s.url || !/\.m3u8/i.test(s.url) || seen.has(s.url)) continue;
    const ch = byId[s.channel];
    if (!ch || !ch.country || ch.is_nsfw) continue;
    const iso = String(ch.country).toUpperCase();
    const name = iso2name[iso];
    if (!name || (ONLY && !ONLY.has(name))) continue;
    seen.add(s.url);
    if (ch.closed || ch.replaced_by) { drops.closed++; continue; }
    const cats = ch.categories || [];
    if (cats.some(c => EXCLUDE_CATS.has(c))) { drops.category++; continue; }
    const mn = multinationalHome(ch);
    if (mn && (mn.home === null || (mn.home === 'GB' ? 'GB' : mn.home) !== (iso === 'UK' ? 'GB' : iso))) { drops.foreign++; continue; }
    if (!/^https:/i.test(s.url)) { drops.http++; continue; }
    if (mentionsOtherNation(ch.name || '', name, allNames)) { drops.about_other_nation++; continue; }
    const radio = /\b(radio|fm)\b/i.test(ch.name || '');   // visual radio: a studio, not the place
    const tier = radio ? 2 : cats.some(c => TIER0.has(c)) ? 0 : (!cats.length || cats.some(c => TIER1.has(c))) ? 1 : 2;
    const perCh = (byCountry[name] = byCountry[name] || {});
    const e = (perCh[ch.id] = perCh[ch.id] || { country: name, channel: ch.id, label: ch.name || s.channel, tier, urls: [] });
    e.urls.push(s.url);
  }
  console.log('dropped streams                   :', JSON.stringify(drops));
  console.log('countries the globe can place     :', Object.keys(byCountry).length);

  const queue = [];
  for (const list of Object.values(byCountry)) {
    queue.push(...Object.values(list).sort((a, b) => a.tier - b.tier).slice(0, CANDIDATES));
  }
  console.log('channels to probe                 :', queue.length, `(max ${CANDIDATES}/country)`);

  console.log(`\nprobing (concurrency ${CONCURRENCY}, ${PROBE_MS}ms, CORS + variant)…`);
  const t0 = Date.now(); let done = 0; const reasons = {};
  let cache = {};
  if (CACHE && fs.existsSync(CACHE)) { try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch {} }
  const fresh = Date.now() - CACHE_H * 3600e3;
  const results = await pool(queue, async (c) => {
    let win = null;
    for (const u of c.urls.slice(0, 4)) {
      const hit = cache[u] && cache[u].at > fresh ? cache[u] : null;
      let r = hit ? hit.r : await probe(u);
      if (r === 'error') { await new Promise(res => setTimeout(res, 1500)); r = await probe(u); }   // one retry on timeout / reset
      if (!hit && typeof r === 'number') cache[u] = { at: Date.now(), r };   // cache successes only: a failure is re-probed
      if (typeof r === 'number') { win = { ...c, url: u, ms: r }; break; }
      reasons[r.split(' ')[0]] = (reasons[r.split(' ')[0]] || 0) + 1;
    }
    if (++done % 100 === 0) process.stdout.write(`  ${done}/${queue.length}\r`);
    return win;
  }, CONCURRENCY);

  if (CACHE) fs.writeFileSync(CACHE, JSON.stringify(cache));
  const live = results.filter(Boolean);
  console.log(`  probed ${queue.length} channels in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log('  PLAYABLE                        :', live.length, `(${Math.round(live.length / Math.max(1, queue.length) * 100)}%)`);
  console.log('  failure reasons                 :', JSON.stringify(reasons));

  const grouped = {};
  for (const c of live) (grouped[c.country] = grouped[c.country] || []).push(c);
  for (const k of Object.keys(grouped)) {
    grouped[k].sort((a, b) => a.tier - b.tier || a.ms - b.ms);
    const brands = new Set();
    grouped[k] = grouped[k].filter(c => { const b = brandKey(c.label); if (brands.has(b)) return false; brands.add(b); return true; });
  }
  // A brand carried by two nations: a region-suffixed feed ("Dunya News UK") is the
  // other nation's channel abroad — it goes; the home feed stays.
  const brandOwners = {};
  for (const list of Object.values(grouped)) for (const c of list) (brandOwners[brandKey(c.label)] = brandOwners[brandKey(c.label)] || []).push(c);
  for (const list of Object.values(brandOwners)) {
    if (new Set(list.map(c => c.country)).size < 2) continue;
    for (const c of list) if (REGION_SUFFIX.test(c.label) && list.some(o => o.country !== c.country && !REGION_SUFFIX.test(o.label))) c.drop = true;
  }
  for (const k of Object.keys(grouped)) grouped[k] = grouped[k].filter(c => !c.drop);
  // Keep the spread: rank 0 from every country before any country's rank 1.
  const final = [];
  for (let rank = 0; rank < PER_COUNTRY && final.length < TARGET; rank++) {
    let any = false;
    for (const k of Object.keys(grouped)) {
      const c = grouped[k][rank];
      if (c) { final.push(c); any = true; if (final.length >= TARGET) break; }
    }
    if (!any) break;
  }

  let out = {};
  if (ONLY && fs.existsSync(OUT)) {   // partial run: merge over the previous pool
    out = JSON.parse(fs.readFileSync(OUT, 'utf8')).sources || {};
    for (const n of ONLY) delete out[n];
  }
  for (const c of final) {
    (out[c.country] = out[c.country] || []).push({ type: 'hls', url: c.url, label: c.label });
  }
  // A label two nations both carry is two broadcasters sharing a name. Suffix the
  // country so no label — the thing the panel dedupes on — belongs to two nations.
  const norm = l => String(l).toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').replace(/[^a-z0-9\u00c0-\uffff]+/g, ' ').trim();
  const owners = {};
  for (const [n, list] of Object.entries(out)) for (const s of list) (owners[norm(s.label)] = owners[norm(s.label)] || new Set()).add(n);
  let renamed = 0;
  for (const [n, list] of Object.entries(out)) for (const s of list) {
    if (owners[norm(s.label)].size > 1 && !/\([A-Z]{2}\)$/.test(s.label)) { s.label = `${s.label} (${name2iso[n] || n})`; renamed++; }
  }
  const count = Object.values(out).reduce((a, l) => a + l.length, 0);
  fs.writeFileSync(OUT, JSON.stringify({
    generated: new Date().toISOString(),
    note: 'Generated by scripts/build-iptv-sources.js from iptv-org. Only channels FROM the nation; ' +
          'every URL served #EXTM3U over https with CORS (and a playable variant) at generation time. ' +
          'Re-run from a normal network to refresh.',
    count, countries: Object.keys(out).length, sources: out,
  }, null, 1));

  console.log('\nWROTE', path.relative(ROOT, OUT));
  console.log('  sources  :', count, ' label collisions suffixed:', renamed);
  console.log('  countries:', Object.keys(out).length);
  const missing = Object.keys(name2iso).filter(n => !out[n]);
  console.log('  nations with no playable IPTV:', missing.join(', ') || 'none');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
