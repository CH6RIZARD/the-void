// ─── NATION FEED ────────────────────────────────────────────────────────
// Every tier runs in parallel and lands the moment it answers:
//   Supabase region_view posts -> proxy social -> Mastodon #nation (all + media-only)
//   -> Lemmy search -> radio-browser -> Commons photos | detached: PeerTube, Internet
//   Archive, Commons video, GDELT (behind its 6s gate).
// Everything is filtered to THIS nation (published there, tagged with it, or naming
// it). Seen-before items sink below fresh ones instead of vanishing, empty pulls
// re-scan on a backoff, and scrolling pages deeper into each source.
import { env } from '../env.ts';
import type { Country, Post } from '../types.ts';
import { NATION_VOCAB } from '../data/nationVocab.generated.ts';
import { C as NATIONS } from '../data/countries.generated.ts';
import { REGION_ALIASES, _regionNorm, resolveRegion } from '../data/regions.ts';
import { _normText, wasSeen } from '../rank/seen.ts';
import { inferTags } from '../rank/tags.ts';
import { nationCode, nationRegionView } from '../streams/nation.ts';
import { VoidAPI } from '../api/voidApi.ts';
import { htmlText, nfFetchJson, nfFold, nfHost, urlKey } from '../util.ts';
import { lemmyToPost, mastoToPost, peertubeSrc } from './fedi.ts';
import { _gdeltCache, gdeltQuery } from './gdelt.ts';
import { pullSocial } from './proxy.ts';
import { allPosts } from './store.ts';
import { sbPostToApp } from './voidFeed.ts';

export { NATION_VOCAB };
type C = Pick<Country, 'n' | 'iso'> & Partial<Pick<Country, 'lat' | 'lon'>> & { _nre?: RegExp };

export function nationVocab(c: { n: string } | null | undefined): string[] { return String((c && NATION_VOCAB[c.n]) || '').split('|'); }
export function nationTerms(c: C): string[] {
  const name = c.n || '', code = nationCode(c), terms = new Set([name]);
  for (const k in REGION_ALIASES) {
    const v = REGION_ALIASES[k], vc = typeof v === 'string' ? v : (v && (v.parent || v.code));
    if (vc && vc === code && k.length > 3) terms.add(k);
  }
  if (name.length >= 7) terms.add(name.slice(0, -1));          // Morocc-an, Ukrain-ian
  for (const v of nationVocab(c)) if (v && v.length >= 3) { terms.add(v); terms.add(nfFold(v)); }
  return [...terms];
}
// A term only counts as a WORD: "Nepal", "Nepalese", "Japan's" — never "Indiana".
// Latin terms take a demonym-style suffix and a word boundary; non-Latin names
// (日本, नेपाल) match as written. Cached on the country object as _nre.
export function nationMentionRe(c: C): RegExp {
  if (c._nre) return c._nre;
  const q = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lat: string[] = [], nat: string[] = [];
  for (const t of nationTerms(c).sort((a, b) => b.length - a.length)) (/^[\x00-\x7f]+$/.test(t) ? lat : nat).push(q(t));
  const lp = lat.length ? '\\b(?:' + lat.map(t => /\w$/.test(t) ? t + '(?:n|an|ans|ian|ians|ese|i|is|s|ns)?\\b' : t).join('|') + ')' : '';
  return c._nre = new RegExp([lp, nat.join('|')].filter(Boolean).join('|') || '(?!)', 'i');
}
export function nationNamed(c: C, s: unknown): boolean { const re = nationMentionRe(c); return re.test(String(s || '')) || re.test(nfFold(s)); }
export function nationIsLocal(country: string | undefined, c: C): boolean {
  if (!country) return false;
  if (_regionNorm(country) === _regionNorm(c.n)) return true;
  const r = resolveRegion(country); return !!(r && r.code && r.code === nationCode(c));
}
// 0 when the nation is named in the post's own words, 1 when only as a trailing
// #hashtag — tag-stuffed link posts sink below posts actually about the place.
export function nationRelevance(p: Partial<Post>, c: C): 0 | 1 {
  const words = String(p.body || '').replace(/#[\p{L}\p{N}_]+/gu, ' ');
  return nationNamed(c, words) || nationIsLocal(p.country, c) ? 0 : 1;
}

export interface NationFeedState {
  c: C; token: number; busy: boolean; inflight: Record<string, boolean>; rendered: number; attempt: number; dry: number;
  ids: Set<string>; texts: Set<string>; mastoMax: string; mastoMediaMax: string; lemmyPage: number; gdeltSpan: string;
  exhausted: Record<string, boolean>; pool: Post[]; hist: string[]; ptQ: number; ptStart: number; radioOff: number;
  radioUrls: Set<string>; iaPage: number; commonsOff: number; commonsVidOff: number; t0: number;
  lastRadio: number | null; voiceOff: number;
  [k: string]: any;
}
let _tokenSeq = 0;
/** Fresh per-open state (web loadCountryFeed). Opening another nation = a new state; old tokens go stale. */
export function createNationFeed(c: C): NationFeedState {
  return {
    c, token: ++_tokenSeq, busy: false, inflight: {}, rendered: 0, attempt: 0, dry: 0, ids: new Set(), texts: new Set(), shapes: new Set(), authors: {}, lastRadio: null, voiceOff: 0,
    mastoMax: '', mastoMediaMax: '', lemmyPage: 1, gdeltSpan: '7d', exhausted: {}, pool: [], hist: [],
    ptQ: 0, ptStart: 0, radioOff: 0, radioUrls: new Set(), iaPage: 1, commonsOff: 0, commonsVidOff: 0, t0: env.now(),
  };
}
let _currentToken = 0;
export function setCurrentNationToken(t: number): void { _currentToken = t; }

// ── sources ──────────────────────────────────────────────────────────────
export async function nationFeedSupabase(c: C): Promise<Post[]> {
  const rv = await nationRegionView(c);
  let rows: any[] = (rv && rv.posts) || [];
  if (!rows.length && VoidAPI.base) { try { rows = ((await VoidAPI.nationFeed(nationCode(c))) || {}).items || []; } catch { rows = []; } }
  rows = rows.filter(r => r && r.id && !r.reply_to);
  // region_view returns bare rows: no post_media, no author. Voice notes (empty
  // body + an audio attachment) were dropped outright and every photo/video drop
  // became a text card. Re-read the same posts with the main feed's select.
  const full: Record<string, Post> = {};
  try { (await VoidAPI.recentPosts(rows.length, rows.map(r => r.id))).forEach(x => { const p = sbPostToApp(x); if (p) full[p.id] = p; }); } catch { /* */ }
  return rows.map(r => {
    const p = full[r.id];
    if (p) return { ...p, country: c.n, iso: c.iso, _region: r.region_code || nationCode(c), tags: inferTags(p.body, []), score: r.rank_score || p.score || 0 } as Post;
    return r.body ? {
      id: r.id, style: 'take', country: c.n, iso: c.iso, _region: r.region_code || nationCode(c), _authorId: r.author_id || null,
      tags: inferTags(r.body, []), body: r.body, score: r.rank_score || 0, replies: 0, time: r.created_at ? Date.parse(r.created_at) : env.now(),
      source: 'void', _author: 'void', _handle: '@void', _img: '', _video: '',
    } as Post : null;
  }).filter(Boolean) as Post[];
}
export async function nationFeedGdelt(c: C, st: NationFeedState): Promise<Post[]> {
  const slug = (c.n || '').toLowerCase().replace(/[^a-z]/g, '');
  const span = st.gdeltSpan;
  if (!slug || !span) { st.exhausted.gdelt = true; return []; }
  const key = slug + '|' + span;
  let list = _gdeltCache[key];
  if (!list) { list = await gdeltQuery(`(sourcecountry:${slug} OR "${c.n}")`, span); if (list.length) _gdeltCache[key] = list; }
  if (!list.length && span === '7d') return [];                 // throttled: same window is tried again next pull
  st.gdeltSpan = span === '7d' ? '30d' : '';                    // next page widens the window once, then GDELT is done
  // GDELT's OR also matches articles mentioning the country deep in the body. Keep
  // local outlets and headlines that actually name the nation.
  return list.map(p => { const local = nationIsLocal(p.country, c); return (local || nationNamed(c, p.body)) ? { ...p, country: local ? c.n : '', _nation: c.n } : null; }).filter(Boolean) as Post[];
}
// Two independent paged streams over one tag set (#nation, #capital, #demonym):
// 'masto' is everything, 'mastoMedia' only posts with media.
export async function nationFeedMastodon(c: C, st: NationFeedState, media: boolean): Promise<Post[]> {
  const key = media ? 'mastoMedia' : 'masto', maxKey = key + 'Max';
  const slug = (s: string) => nfFold(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const v = nationVocab(c), tags = [...new Set([slug(c.n), slug(v[0]), slug(v[1])].filter(t => t && t.length >= 3))];
  if (!tags.length) { st.exhausted[key] = true; return []; }
  const any = tags.slice(1).map(t => '&any[]=' + encodeURIComponent(t)).join('');
  const d = await nfFetchJson(`https://mastodon.social/api/v1/timelines/tag/${tags[0]}?limit=40${any}${media ? '&only_media=true' : ''}${st[maxKey] ? '&max_id=' + st[maxKey] : ''}`);
  if (!Array.isArray(d)) return [];
  if (!d.length) { st.exhausted[key] = true; return []; }
  st[maxKey] = d[d.length - 1].id;
  // Link-dump bots stuff a dozen hashtags onto unrelated posts. Keep a post that
  // names the nation in its own words, or carries a modest tag set.
  return d.map(x => mastoToPost(x, c)).filter((p): p is Post => {
    if (!p) return false;
    const tags = (String(p.body).match(/#[\p{L}\p{N}_]+/gu) || []).length;
    return nationRelevance(p, c) === 0 || tags <= 4;
  });
}
export async function nationFeedLemmy(c: C, st: NationFeedState): Promise<Post[]> {
  const d = await nfFetchJson(`https://lemmy.world/api/v3/search?q=${encodeURIComponent(c.n)}&type_=Posts&sort=New&limit=30&page=${st.lemmyPage}`);
  if (!d) return [];
  const list = d.posts || [];
  if (!list.length) { st.exhausted.lemmy = true; return []; }
  st.lemmyPage++;
  // Title only: Lemmy search also matches bodies (anime art, passing mentions).
  return list.map((v: any) => lemmyToPost(v, c)).filter((p: Post | null) => p && nationNamed(c, p.body)) as Post[];
}
// VIDEO — PeerTube federated search via SepiaSearch, then the video's own instance.
export async function nationFeedPeertube(c: C, st: NationFeedState): Promise<Post[]> {
  const v = nationVocab(c), queries = [c.n, v[0]].filter(q => q && q.length >= 3);
  const qi = st.ptQ || 0, q = queries[qi];
  if (!q) { st.exhausted.peertube = true; return []; }
  const start = st.ptStart || 0, count = 20;
  const d = await nfFetchJson(`https://sepiasearch.org/api/v1/search/videos?search=${encodeURIComponent(q)}&sort=-publishedAt&count=${count}&start=${start}&nsfw=false`, 10000);
  if (!d) return [];
  const list = d.data || [];
  st.ptStart = start + list.length;
  if (!list.length || st.ptStart >= Math.min(d.total || 0, 400)) { st.ptQ = qi + 1; st.ptStart = 0; if (!queries[qi + 1]) st.exhausted.peertube = true; }
  // Named in the title or description — uploader tags alone are not enough.
  const hits = list.filter((x: any) => x && x.uuid && x.url && !x.nsfw && !x.isLive && (x.duration || 0) > 0 && x.duration <= 5400 &&
    nationNamed(c, (x.name || '') + ' ' + (x.truncatedDescription || x.description || '')));
  const out = await Promise.all(hits.map(async (x: any) => {
    const host = nfHost(x.url); if (!host) return null;
    const src = peertubeSrc(await nfFetchJson(`https://${host}/api/v1/videos/${x.uuid}`, 7000));
    if (!src) return null;
    const ch = x.channel || x.account || {}, desc = String(x.truncatedDescription || x.description || '');
    return {
      id: 'pt_' + x.uuid, style: 'video', country: '', iso: '', _nation: c.n, tags: inferTags(x.name + ' ' + desc, x.nsfw ? ['graphic'] : []),
      body: x.name, _desc: desc.slice(0, 400), score: x.likes || 0, replies: x.comments || 0, reposts: 0, views: x.views || 0,
      time: Date.parse(x.publishedAt || x.createdAt) || env.now(), source: 'peertube',
      _author: ch.displayName || ch.name || host, _handle: '@' + (ch.name || 'peertube') + '@' + (ch.host || host),
      _img: x.previewUrl || x.thumbnailUrl || '', _video: src, _dur: x.duration, _url: x.url, sourceUrl: x.url, _social: true,
      provenance: { sourceHost: host }, imgHue: 270,
    } as Post;
  }));
  return out.filter(Boolean) as Post[];
}
// AUDIO — live radio from radio-browser.info. HTTPS streams only, no HLS/playlist
// files (a bare audio element cannot open them), one post per stream URL.
export const NF_RADIO_HOSTS = ['de1', 'de2', 'all'];
// Nations whose own territory (or overseas parts) runs past 3000km from the centroid.
const NF_WIDE = new Set(['RU', 'US', 'CA', 'CN', 'AU', 'BR', 'FR', 'GB', 'NL', 'DK', 'NZ', 'CL', 'AR', 'IN', 'ID', 'KZ', 'NO', 'ES', 'PT', 'MX']);
/** Great-circle km from the nation's centroid; Infinity when the station gives no coordinates. */
export function nfKmFrom(c: C, la: unknown, lo: unknown): number {
  const lat = parseFloat(String(la)), lon = parseFloat(String(lo));
  if (!isFinite(lat) || !isFinite(lon) || (!lat && !lon) || c.lat == null || c.lon == null) return Infinity;
  const r = Math.PI / 180, a = Math.sin((lat - c.lat) * r / 2) ** 2 + Math.cos(c.lat * r) * Math.cos(lat * r) * Math.sin((lon - c.lon) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
export async function nationFeedRadio(c: C, st: NationFeedState): Promise<Post[]> {
  const cc = (c.iso && /^[A-Z]{2}$/.test(c.iso)) ? c.iso : String(nationCode(c)).slice(0, 2);
  if (!/^[A-Z]{2}$/.test(cc)) { st.exhausted.radio = true; return []; }
  const off = st.radioOff || 0, lim = 20;
  let d: any = null;
  for (const h of NF_RADIO_HOSTS) {
    d = await nfFetchJson(`https://${h}.api.radio-browser.info/json/stations/bycountrycodeexact/${cc}?order=clickcount&reverse=true&limit=${lim}&offset=${off}&hidebroken=true`, 7000);
    if (Array.isArray(d)) break;
  }
  if (!Array.isArray(d)) return [];
  st.radioOff = off + d.length;
  if (d.length < lim || st.radioOff >= 240) st.exhausted.radio = true;
  const seen = st.radioUrls || (st.radioUrls = new Set());
  return d.map((s: any) => {
    const u = String(s.url_resolved || s.url || '');
    if (!/^https:\/\//i.test(u) || s.hls || s.lastcheckok === 0 || s.ssl_error || /\.(m3u8?|pls|asx|xspf|nsv)\b/i.test(u)) return null;
    if (s.codec && !/^(mp3|aac\+?|ogg|opus|flac|unknown)$/i.test(String(s.codec).split(',')[0].trim())) return null;
    const k = u.replace(/[?#].*$/, '').replace(/[;\/]+$/, '').toLowerCase();
    const name = String(s.name || '').replace(/\s+/g, ' ').replace(/^[\s.\-:]+|[\s.\-:]+$/g, '');
    if (!name || seen.has(k) || seen.has('n:' + name.toLowerCase())) return null;
    seen.add(k); seen.add('n:' + name.toLowerCase());
    const tags = String(s.tags || '').split(',').map(t => t.trim()).filter(t => t && t.length < 24).slice(0, 6);
    // radio-browser takes whoever filed a station at their word: MH carried
    // "Offworld Radio", state "Cork". A state naming another nation, or coordinates
    // far from this one, is a mis-filing; a state is only printed when the
    // station's own coordinates put it here.
    if (s.state && NATIONS.some(o => o.n !== c.n && nationNamed(o, s.state))) return null;
    const km = nfKmFrom(c, s.geo_lat, s.geo_long);
    if (isFinite(km) && km > 3000 && !NF_WIDE.has(cc)) return null;   // no coordinates is not evidence
    const where = km < 1500 ? [s.state, c.n].filter(Boolean).join(', ') : c.n;
    return {
      id: 'rb_' + (s.stationuuid || urlKey(u)), style: 'audio', country: c.n, iso: c.iso, _region: nationCode(c), _nation: c.n,
      tags: inferTags(name + ' ' + tags.join(' '), []),
      body: `${name} · LIVE radio from ${where}${tags.length ? '\n' + tags.map(t => '#' + t.replace(/[^\p{L}\p{N}]+/gu, '')).join(' ') : ''}`,
      score: s.votes || 0, replies: 0, reposts: 0, time: env.now(), source: 'radio', _live: true,
      _author: name, _handle: '@' + (nfHost(s.homepage) || nfHost(u) || 'radio'), _img: '', _video: '',
      _audio: u, _audioDur: 3600, _url: s.homepage || u, sourceUrl: s.homepage || u, _social: true,
      provenance: { sourceHost: nfHost(u) }, imgHue: 270,
    } as Post;
  }).filter(Boolean) as Post[];
}
// AUDIO — spoken programmes about the nation from the Internet Archive; music-rip
// collections excluded by restricting to programme collections.
export async function nationFeedArchive(c: C, st: NationFeedState): Promise<Post[]> {
  const v = nationVocab(c), terms = [c.n, v[0], v[1]].filter(t => t && t.length >= 4 && /^[\x00-\x7f]+$/.test(t));
  if (!terms.length) { st.exhausted.archive = true; return []; }
  const page = st.iaPage || 1, rows = 12;
  const q = `(${terms.map(t => `title:("${t}")`).join(' OR ')}) AND mediatype:(audio) AND collection:(radioprograms OR podcasts OR radio-aporee-maps OR audio_news OR audio_podcast)`;
  const d = await nfFetchJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=description&fl[]=publicdate&sort[]=publicdate+desc&rows=${rows}&page=${page}&output=json`, 10000);
  if (!d || !d.response) return [];
  const docs = d.response.docs || [];
  st.iaPage = page + 1;
  if (docs.length < rows || page * rows >= 240) st.exhausted.archive = true;
  const out = await Promise.all(docs.filter((x: any) => x && x.identifier && nationNamed(c, x.title)).map(async (x: any) => {
    const m = await nfFetchJson(`https://archive.org/metadata/${encodeURIComponent(x.identifier)}`, 8000);
    const files = ((m && m.files) || []).filter((f: any) => /\.(mp3|m4a|ogg|opus)$/i.test(f.name || ''));
    if (!files.length || files.length > 40) return null;
    const f = files.find((f: any) => /mp3/i.test(f.format || f.name)) || files[0];
    let dur = +f.length || 0;
    if (!dur && /:/.test(f.length || '')) dur = String(f.length).split(':').reduce((a, b) => a * 60 + (+b || 0), 0);
    if (dur > 4 * 3600) return null;
    const desc = htmlText([].concat(x.description || '').join(' ')).slice(0, 400), creator = ([] as any[]).concat(x.creator || '')[0] || 'archive.org';
    return {
      id: 'ia_' + x.identifier, style: 'audio', country: '', iso: '', _nation: c.n, tags: inferTags(x.title + ' ' + desc, []),
      body: String(x.title), _desc: desc, score: 0, replies: 0, reposts: 0, time: Date.parse(x.publicdate) || env.now(), source: 'archive',
      _author: String(creator).slice(0, 60), _handle: '@archive.org', _img: '', _video: '',
      _audio: `https://archive.org/download/${encodeURIComponent(x.identifier)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
      _audioDur: Math.round(dur) || undefined, _url: `https://archive.org/details/${x.identifier}`, sourceUrl: `https://archive.org/details/${x.identifier}`,
      _social: true, provenance: { sourceHost: 'archive.org' }, imgHue: 270,
    } as Post;
  }));
  return out.filter(Boolean) as Post[];
}
// PHOTOS / VIDEO — Wikimedia Commons uploads whose TITLE names the nation, newest
// first. A burst of numbered shots from one uploader becomes one carousel.
export async function nationFeedCommons(c: C, st: NationFeedState, video: boolean): Promise<Post[]> {
  const key = video ? 'commonsVid' : 'commons', offKey = key + 'Off';
  const term = nfFold(c.n).replace(/"/g, '');
  const params = `action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrsort=create_timestamp_desc&gsrlimit=${video ? 15 : 30}` +
    `&gsrsearch=${encodeURIComponent(`intitle:"${term}" filetype:${video ? 'video' : 'bitmap'}`)}&gsroffset=${st[offKey] || 0}` +
    (video ? '&prop=videoinfo&viprop=url|timestamp|user|derivatives|size&viurlwidth=640' : '&prop=imageinfo&iiprop=url|timestamp|user|size&iiurlwidth=800');
  const d = await nfFetchJson('https://commons.wikimedia.org/w/api.php?' + params, 9000);
  if (!d) return [];
  const next = d.continue && d.continue.gsroffset;
  if (next == null || next >= 600) st.exhausted[key] = true; else st[offKey] = next;
  const pages: any[] = Object.values((d.query && d.query.pages) || {}).sort((a: any, b: any) => (a.index || 0) - (b.index || 0));
  const clean = (t: unknown) => String(t || '').replace(/^File:/, '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ').trim();
  const base = (t: unknown, p: any) => {
    const i = p || {};
    return {
      country: '', iso: '', _nation: c.n, body: clean(t), tags: inferTags(clean(t), []), score: 0, replies: 0, reposts: 0,
      time: Date.parse(i.timestamp) || env.now(), source: 'commons', _author: i.user || 'Wikimedia Commons', _handle: '@' + String(i.user || 'commons').replace(/\s+/g, '_') + '@commons',
      _url: i.descriptionurl || '', sourceUrl: i.descriptionurl || '', _social: true, provenance: { sourceHost: 'commons.wikimedia.org' }, imgHue: 270,
    };
  };
  if (video) {
    return pages.map(p => {
      const i = (p.videoinfo || [])[0]; if (!i || !nationNamed(c, clean(p.title))) return null;
      const ds = i.derivatives || [];
      const pick = ds.find((x: any) => /vp9/.test(x.type) && /\.480p\./.test(x.src)) || ds.find((x: any) => /vp9/.test(x.type) && /\.360p\./.test(x.src)) ||
        ds.find((x: any) => /vp9|vp8/.test(x.type) && !/av01/.test(x.type));
      if (!pick || !i.thumburl || (i.duration && i.duration > 3600)) return null;
      return { ...base(p.title, i), id: 'wc_' + p.pageid, style: 'video', _img: i.thumburl, _video: pick.src, _dur: i.duration || 0 } as Post;
    }).filter(Boolean) as Post[];
  }
  const out: Post[] = []; let grp: { stem: string; user: string; t: number; post: Post } | null = null;
  for (const p of pages) {
    const i = (p.imageinfo || [])[0]; if (!i || !i.thumburl || !nationNamed(c, clean(p.title))) continue;
    if ((i.width || 0) < 400 || (i.height || 0) < 300) continue;                 // icons, flags-in-a-box, map thumbnails
    // Every digit run, not just a trailing "(3)": NASA dumps number mid-title
    // ("ISS075-E-81076 - View of the Marshall Islands", 30 in 3 minutes).
    const stem = clean(p.title).replace(/\d+/g, '#').toLowerCase(), t = Date.parse(i.timestamp) || 0;
    if (grp && grp.stem === stem && grp.user === i.user && Math.abs(grp.t - t) < 30 * 60e3 && grp.post._imgs!.length < 10) { grp.post._imgs!.push(i.thumburl); grp.post.style = 'carousel'; continue; }
    const post = { ...base(p.title, i), id: 'wc_' + p.pageid, style: 'image', _img: i.thumburl, _imgs: [i.thumburl], _video: '' } as Post;
    post.body = clean(p.title).replace(/\s*[\(\[]?\d{1,3}[\)\]]?$/, '');
    grp = { stem, user: i.user, t, post }; out.push(post);
  }
  return out;
}

// VOICE — people speaking about the nation: speeches, statements, press briefings,
// short spoken news clips, from Wikimedia Commons audio whose TITLE names it (web
// nationFeedVoice). Not voice, and dropped: Lingua Libre one-word pronunciations,
// language-coded pronunciation clips ("Pt-Ukraine"), anthems and other music, and
// Wikipedia articles read by an AI voice. An mp3 transcode is preferred (iOS
// cannot play Ogg).
export const NF_VOICE_SKIP = /^LL-Q\d|pronunciation|anthem|hymn|\bsong\b|music|instrumental|spoken by ai|ai voice|text-to-speech/i;
export async function nationFeedVoice(c: C, st: NationFeedState): Promise<Post[]> {
  const term = nfFold(c.n).replace(/"/g, '');
  const d = await nfFetchJson('https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6' +
    `&gsrsort=create_timestamp_desc&gsrlimit=30&gsrsearch=${encodeURIComponent(`intitle:"${term}" filetype:audio`)}&gsroffset=${st.voiceOff || 0}` +
    '&prop=videoinfo&viprop=url|timestamp|user|mime|derivatives', 9000);
  if (!d) return [];
  const next = d.continue && d.continue.gsroffset;
  if (next == null || next >= 300) st.exhausted.voice = true; else st.voiceOff = next;
  const clean = (t: unknown) => String(t || '').replace(/^File:/, '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ').trim();
  const pages: any[] = Object.values((d.query && d.query.pages) || {}).sort((a: any, b: any) => (a.index || 0) - (b.index || 0));
  return pages.map(p => {
    const i = (p.videoinfo || [])[0], title = clean(p.title);
    if (!i || NF_VOICE_SKIP.test(title) || /^[a-z]{2,3}(?:-[a-z]{2,4})?-\S/i.test(title) || title.split(/\s+/).length < 4 || !nationNamed(c, title)) return null;
    const dur = Math.round(+i.duration || 0);
    if (dur && (dur < 8 || dur > 2 * 3600)) return null;
    const mp3 = (i.derivatives || []).find((x: any) => /mpeg|mp3/i.test(x.type || x.transcodekey || ''));
    const src = mp3 ? mp3.src : /mpeg|mp3|wav|mp4|aac/i.test(i.mime || '') ? i.url : '';
    if (!src) return null;
    return {
      id: 'wa_' + p.pageid, style: 'audio', country: '', iso: '', _nation: c.n, body: title, tags: inferTags(title, []), score: 0, replies: 0, reposts: 0,
      time: Date.parse(i.timestamp) || env.now(), source: 'commons', _voice: true, _author: i.user || 'Wikimedia Commons',
      _handle: '@' + String(i.user || 'commons').replace(/\s+/g, '_') + '@commons', _img: '', _video: '', _audio: src, _audioDur: dur || undefined,
      _url: i.descriptionurl || '', sourceUrl: i.descriptionurl || '', _social: true, provenance: { sourceHost: 'commons.wikimedia.org' }, imgHue: 270,
    } as Post;
  }).filter(Boolean) as Post[];
}

// ── pool + format interleave ─────────────────────────────────────────────
// Sources land one at a time (a radio page is 20 audio posts), so appending each
// batch gave long runs of one format. Everything lands in a pool and is dealt out
// rotating formats: longest-unused format next, never more than 3 of one in a row
// while another waits, an audio card at most every 5th post. A lone format is held
// back for the next source unless the reader needs posts now (force).
export const nfGroup = (p: Partial<Post>) => p.style === 'carousel' ? 'image' : (p.style === 'image' || p.style === 'video' || p.style === 'audio') ? p.style as string : 'take';
export const NF_GAP: Record<string, number> = { audio: 4, video: 1, image: 0, take: 0 };
export const NF_RETRY = [3000, 8000, 20000, 45000];
// SPAM GATE, per open nation (web nfSpam). Measured on Marshall Islands: a Commons
// bot's 30 numbered ISS photos, a METAR report every few hours, the same history
// post three times. Aviation weather never lands; one post per text SHAPE (digits,
// links, tags stripped); at most NF_PER_AUTHOR per account. News is exempt from the
// account cap: its author is the outlet, and a small nation may only have one or two.
// Which pool item fills a slot of format g (web nfPick). For audio a person speaking
// (a Void voice note, a Mastodon audio post, a Commons speech or statement) always
// goes before radio, and radio gets at most one card per NF_RADIO_EVERY posts: radio
// answers first and always looks newest, so it used to take every audio slot.
// -1 = only radio is waiting and it is too soon for another station.
export const NF_RADIO_EVERY = 12;
export function nfPick(st: NationFeedState, pool: Post[], g: string, at: number, peek?: boolean): number {
  if (g !== 'audio') return pool.findIndex(p => nfGroup(p) === g);
  const v = pool.findIndex(p => nfGroup(p) === 'audio' && p.source !== 'radio');
  if (v >= 0) return v;
  if (st.lastRadio != null && at - st.lastRadio < NF_RADIO_EVERY) return -1;
  const k = pool.findIndex(p => nfGroup(p) === 'audio');
  if (k >= 0 && !peek) st.lastRadio = at;
  return k;
}
export const NF_METAR_RE = /\b(?:METAR|SPECI|TAF)\b|\b[A-Z]{4} \d{6}Z\b|\b\d{5}(?:G\d{2,3})?KT\b/;
export const NF_PER_AUTHOR = 3;
export function nfShape(s: unknown): string { return String(s || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[#@][\p{L}\p{N}_.]+/gu, ' ').replace(/[^\p{L}]+/gu, ' ').trim().slice(0, 60); }
export function nfSpam(st: NationFeedState, p: Partial<Post>): boolean {
  const body = String(p.body || '');
  if (NF_METAR_RE.test(body)) return true;
  const sh = nfShape(body), shapes: Set<string> = st.shapes || (st.shapes = new Set());
  if (sh.length >= 12) { if (shapes.has(sh)) return true; shapes.add(sh); }
  if (p.source === 'news') return false;
  // Radio and Archive handles are the stream host / archive.org — shared by many.
  const a = String(((p.source === 'radio' || p.source === 'archive') ? p._author : (p._handle || p._author)) || '').toLowerCase();
  if (!a) return false;
  const n: Record<string, number> = st.authors || (st.authors = {});
  return (n[a] = (n[a] || 0) + 1) > NF_PER_AUTHOR;
}

/** Add a landed batch to the pool: dedupe (id + same text), annotate, sort. */
export function nationFeedPoolAdd(st: NationFeedState, list: Array<Post | null> | null | undefined, src?: string): void {
  const pool = st.pool;
  for (const p of list || []) {
    if (!p || !p.id || st.ids.has(p.id)) continue;
    const t = _normText(p.body);
    if (t.length > 15 && st.texts.has(t)) continue;             // same story from two sources
    st.ids.add(p.id); if (t.length > 15) st.texts.add(t);
    if (nfSpam(st, p)) continue;
    // READ-ONLY seen check. Calling admitPost() here once MARKED nation items seen,
    // so opening Nepal first deduped its breaking stories out of the main feed.
    p._seenBefore = wasSeen(p);
    p._nrel = nationRelevance(p, st.c); p._nfsrc = src || p.source || '';
    pool.push(p);
  }
  pool.sort((a, b) => ((a._nrel as number) - (b._nrel as number)) || ((a._seenBefore as any) - (b._seenBefore as any)) || (b.time || 0) - (a.time || 0));
}

/**
 * Before the FIRST deal, wait briefly for a second format (1.5s, up to 4s while the
 * pool holds one format) so the first screen is not all radio. Returns the ms to
 * wait before calling nationFeedDeal again, or 0 to deal now.
 */
export function nationFeedHoldMs(st: NationFeedState): number {
  const age = env.now() - (st.t0 || 0), busy = Object.keys(st.inflight || {}).length;
  // The hold exists for exactly one reason: no all-radio first screen. Radio
  // answers first and a 1.5-4s blank was the price of waiting for anything
  // else. But nfPick already caps radio at one card per NF_RADIO_EVERY posts,
  // so a pool holding ANY non-radio format can deal NOW and cannot produce the
  // screen the hold was built against. Only a radio-only (or empty) pool still
  // waits, and only while sources are in flight.
  const radioOnly = !st.pool.some(p => p.source !== 'radio');
  if (!st.rendered && busy && radioOnly && age < 4000) return Math.max(250, 4050 - age);
  return 0;
}

/**
 * Deal up to `need` posts from the pool (web: ~ten screens below the fold; 16 on
 * first deal). `force` = how many of a lone format may still go out. Dealt posts are
 * registered in allPosts with _offFeed (so thread/photo/rankNation resolve them
 * without entering the main VOID timeline) and counted in st.rendered.
 */
export function nationFeedDeal(st: NationFeedState, need = 16, force = 0): Post[] {
  const pool = st.pool, hist = st.hist;
  if (!pool.length) return [];
  const since = (g: string) => { for (let k = hist.length - 1; k >= 0; k--) if (hist[k] === g) return hist.length - 1 - k; return 1e9; };
  const run = (g: string) => { let n = 0; for (let k = hist.length - 1; k >= 0 && hist[k] === g; k--) n++; return n; };
  const fresh: Post[] = []; let spare = +force || 0;
  while (pool.length && fresh.length < need) {
    let groups = [...new Set(pool.map(nfGroup))];
    if (groups.includes('audio') && nfPick(st, pool, 'audio', st.rendered + fresh.length, true) < 0) groups = groups.filter(g => g !== 'audio');   // only radio waiting, too soon
    if (!groups.length) break;
    let ok = groups.filter(g => run(g) < 3 && since(g) >= NF_GAP[g]);
    if (!ok.length) ok = groups.filter(g => run(g) < 3 && (g !== 'audio' || groups.length === 1));
    if (!ok.length) ok = groups.filter(g => run(g) < 3);
    if (!ok.length) { if (spare-- > 0) ok = groups; else break; }    // one format left, nothing else waiting
    if (ok.length === 1 && groups.length === 1 && run(ok[0]) >= 2 && !force) break;
    const g = ok.sort((a, b) => since(b) - since(a))[0];
    const k = nfPick(st, pool, g, st.rendered + fresh.length);
    fresh.push(pool.splice(k, 1)[0]); hist.push(g); if (hist.length > 40) hist.shift();
  }
  if (!fresh.length) return [];
  const known = new Set(allPosts.map(x => x.id));
  fresh.forEach(p => { if (!known.has(p.id)) { p._offFeed = true; allPosts.push(p); } });
  st.rendered += fresh.length;
  return fresh;
}

export interface NationFeedUI {
  /** How many posts the reader will reach soon (web: ten screens below the fold). */
  need?(st: NationFeedState): number;
  /** Reader needs posts now (feed short or near bottom). Default: rendered < 6. */
  wantsNow?(st: NationFeedState): boolean;
  /** Posts dealt, append them in order. */
  onPosts(posts: Post[], st: NationFeedState): void;
  /** Nothing from any tier yet: show "RE-SCANNING", retry scheduled after `ms`. */
  onEmpty?(ms: number, st: NationFeedState): void;
  /** Page is short and not dry: ask for page two soon. */
  onShort?(st: NationFeedState): void;
}

function landAndDeal(st: NationFeedState, ui: NationFeedUI, list: Post[] | null, key: string, force: number): number {
  if (st.token !== _currentToken) return 0;
  delete st.inflight[key];
  nationFeedPoolAdd(st, list, key);
  const hold = nationFeedHoldMs(st);
  if (hold) {
    clearTimeout(st.mixT);
    const tok = st.token;
    st.mixT = setTimeout(() => {
      if (st.token !== tok || st.token !== _currentToken) return;
      const dealt = nationFeedDeal(st, ui.need ? ui.need(st) : 16, Object.keys(st.inflight).length ? 0 : 3);
      if (dealt.length) ui.onPosts(dealt, st);
    }, hold);
    return 0;
  }
  const dealt = nationFeedDeal(st, st.rendered && ui.need ? ui.need(st) : 16, force);
  if (dealt.length) { clearTimeout(st.retryT); ui.onPosts(dealt, st); }
  return dealt.length;
}

/**
 * One pull of every non-exhausted source. Each source is in flight at most once;
 * GDELT (6s gate), PeerTube, Archive and Commons video run DETACHED — they land
 * whenever they land while paging carries on (the "second scroll adds nothing" bug).
 * A source with a >=20 backlog in the pool is not paged again yet.
 */
export async function nationFeedPull(st: NationFeedState, first: boolean, ui: NationFeedUI): Promise<void> {
  const c = st.c, token = st.token;
  if (!c || st.busy) return;
  _currentToken = token;
  st.busy = true;
  let added = 0;
  const needNow = () => {
    const want = ui.wantsNow ? ui.wantsNow(st) : st.rendered < 6;
    return !want ? 0 : Object.keys(st.inflight).length ? 0 : 3;
  };
  const detach = (key: string, fn: () => Promise<Post[] | null>) => {
    if (st.inflight[key]) return null;
    st.inflight[key] = true;
    return Promise.resolve().then(fn).then(l => { added += landAndDeal(st, ui, l || [], key, needNow()); }, () => { /* */ })
      .finally(() => { if (token === st.token) delete st.inflight[key]; });
  };
  const backlog = (k: string) => st.pool.filter(p => p._nfsrc === k).length;
  const jobs: Array<Promise<void> | null> = [];
  if (first) {
    jobs.push(detach('supabase', () => nationFeedSupabase(c)));
    if (env.proxyBase) jobs.push(detach('proxy', () => pullSocial(c.n).then(l => (l || []).filter(Boolean).map(p => ({ ...(p as Post), _nation: c.n })))));
  }
  const awaited: Record<string, () => Promise<Post[]>> = {
    masto: () => nationFeedMastodon(c, st, false), mastoMedia: () => nationFeedMastodon(c, st, true),
    lemmy: () => nationFeedLemmy(c, st), radio: () => nationFeedRadio(c, st), commons: () => nationFeedCommons(c, st, false),
  };
  const detached: Record<string, () => Promise<Post[]>> = {
    peertube: () => nationFeedPeertube(c, st), archive: () => nationFeedArchive(c, st),
    commonsVid: () => nationFeedCommons(c, st, true), gdelt: () => nationFeedGdelt(c, st), voice: () => nationFeedVoice(c, st),
  };
  for (const k in awaited) if (!st.exhausted[k] && backlog(k) < 20) jobs.push(detach(k, awaited[k]));
  for (const k in detached) if (!st.exhausted[k] && backlog(k) < 20) detach(k, detached[k]);   // not awaited
  await Promise.all(jobs.filter(Boolean));
  st.busy = false;
  if (token !== _currentToken) return;
  if (!nationFeedHoldMs(st)) {
    const dealt = nationFeedDeal(st, st.rendered && ui.need ? ui.need(st) : 16, needNow());
    if (dealt.length) { added += dealt.length; ui.onPosts(dealt, st); }
  }
  if (!st.rendered && st.pool.length) return;                 // first deal is waiting a beat for a second source
  if (!st.rendered) {
    // Nothing yet from any tier: look again on a backoff for as long as the nation stays open.
    const wait = NF_RETRY[Math.min(st.attempt++, NF_RETRY.length - 1)];
    st.exhausted = {}; st.gdeltSpan = st.gdeltSpan || '7d';
    ui.onEmpty && ui.onEmpty(wait, st);
    st.retryT = setTimeout(() => { if (token === _currentToken) nationFeedPull(st, true, ui); }, wait);
    return;
  }
  const allDry = [...Object.keys(awaited), ...Object.keys(detached)].every(k => st.exhausted[k]) && !st.pool.length;
  st.dry = added ? 0 : (st.dry || 0) + 1;
  if (!allDry && st.dry < 3 && ui.onShort) ui.onShort(st);
}
/** Tap on "RE-SCANNING" skips the wait. */
export function nationFeedRetryNow(st: NationFeedState, ui: NationFeedUI): Promise<void> { clearTimeout(st.retryT); st.busy = false; return nationFeedPull(st, true, ui); }
/** Scroll handler logic: deal from the pool as the reader goes; pull more near the bottom. */
export function nationFeedOnScroll(st: NationFeedState, ui: NationFeedUI, nearBottom: boolean): void {
  if (!st.c || !st.rendered) return;
  if (st.pool.length) { const d = nationFeedDeal(st, ui.need ? ui.need(st) : 16, 0); if (d.length) ui.onPosts(d, st); }
  if (st.busy || ((st.dry || 0) >= 3 && !st.pool.length)) return;
  if (nearBottom) nationFeedPull(st, false, ui);
}
/** Close the nation: stale every in-flight landing. */
export function closeNationFeed(st: NationFeedState | null): void { if (!st) return; clearTimeout(st.retryT); clearTimeout(st.mixT); if (_currentToken === st.token) _currentToken = 0; }
