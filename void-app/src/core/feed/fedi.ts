// Fediverse mappers: Mastodon statuses, Lemmy posts, PeerTube videos. All keyless
// and CORS-open on the web; plain HTTPS natively.
import { env } from '../env.ts';
import type { Post } from '../types.ts';
import { inferTags } from '../rank/tags.ts';
import { htmlText, lemmyHost, nfFetchJson, nfHost, parseUrl, urlKey } from '../util.ts';

type NationRef = { n: string };

export function mastoToPost(st0: any, c: NationRef): Post | null {
  const x = st0.reblog || st0;
  const body = htmlText(x.content), media = x.media_attachments || [];
  const imgs = media.filter((m: any) => m.type === 'image').map((m: any) => m.url || m.preview_url).filter(Boolean);
  const vm = media.find((m: any) => m.type === 'video' || m.type === 'gifv');
  const am = media.find((m: any) => m.type === 'audio' && m.url);
  let style = 'take', img = '', vid = '', aud = '', audDur = 0;
  if (vm && vm.url) { vid = vm.url; img = vm.preview_url || ''; style = 'video'; }
  else if (imgs.length) { img = imgs[0]; style = imgs.length > 1 ? 'carousel' : 'image'; }
  else if (am) { aud = am.url; audDur = Math.round(((am.meta || {}).original || {}).duration || 0); style = 'audio'; }
  if (!body && !img && !vid && !aud) return null;
  const acct = x.account || {};
  let host = 'mastodon.social'; try { host = parseUrl(x.url || x.uri).host; } catch { /* */ }
  return {
    id: 'md_' + urlKey(String(x.uri || x.url || x.id)), style, country: '', iso: '', _nation: c.n,
    tags: inferTags(body, x.sensitive ? ['graphic'] : []), _graphic: !!x.sensitive,
    body, score: x.favourites_count || 0, replies: x.replies_count || 0, reposts: x.reblogs_count || 0,
    time: Date.parse(x.created_at) || env.now(), source: 'mastodon',
    _author: acct.display_name || acct.username || 'mastodon', _handle: '@' + (acct.acct || acct.username || 'mastodon'),
    _img: img, _imgs: imgs, _video: vid, _url: x.url || '', sourceUrl: x.url || '', _social: true,
    ...(aud ? { _audio: aud, _audioDur: audDur || undefined } : {}),
    provenance: { sourceHost: host }, imgHue: 270,
    _mastoId: String(x.id || ''), _mastoHost: 'mastodon.social',   // where replies are asked for (loadFediReplies)
  };
}

export function lemmyToPost(v: any, c: NationRef): Post | null {
  const p = (v && v.post) || {}, k = (v && v.counts) || {}, com = (v && v.community) || {};
  if (!p.name || p.nsfw || p.removed || p.deleted) return null;
  const img = p.thumbnail_url || (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(p.url || '') ? p.url : '');
  return {
    id: 'lm_' + urlKey(String(p.ap_id || p.id)), style: img ? 'image' : 'take', country: '', iso: '', _nation: c.n,
    tags: inferTags(p.name + ' ' + (p.body || ''), []), body: p.name, _desc: String(p.body || '').slice(0, 400),
    score: k.score || 0, replies: k.comments || 0, time: Date.parse(p.published) || env.now(), source: 'lemmy',
    _author: 'c/' + (com.name || 'lemmy'), _handle: '@' + (com.name || 'lemmy') + '@' + lemmyHost(com.actor_id || p.ap_id), _img: img, _video: '', _link: p.url || '',
    _url: p.ap_id || '', sourceUrl: p.ap_id || '', _social: true, provenance: { sourceHost: lemmyHost(p.ap_id) }, imgHue: 270,
    _lemmyId: p.id || 0, _lemmyHost: 'lemmy.world',               // where replies are asked for (loadFediReplies)
  };
}

// VIDEO — a real file from the video's own instance: a web-video mp4 near 480p,
// else the HLS fragmented mp4, else the HLS master. No file -> no post (never an iframe).
export function peertubeSrc(j: any): string {
  if (!j || j.isLive || (j.privacy && j.privacy.id !== 1)) return '';
  const near = (fs: any[]) => (fs || []).filter(f => f && f.fileUrl && f.hasVideo !== false && f.resolution && f.resolution.id > 0 && f.resolution.id <= 1080)
    .sort((a, b) => Math.abs(a.resolution.id - 480) - Math.abs(b.resolution.id - 480))[0];
  const w = near(j.files); if (w) return w.fileUrl;
  const sp = (j.streamingPlaylists || [])[0]; if (!sp) return '';
  const h = near(sp.files); return h ? h.fileUrl : (sp.playlistUrl || '');
}

/** SepiaSearch rows -> posts (N+1 detail lookup, capped). Used by search discovery. */
export async function ptRows(list: any[], cap: number): Promise<Post[]> {
  const hits = list.filter(x => x && x.uuid && x.url && !x.nsfw && !x.isLive && (x.duration || 0) > 0 && x.duration <= 5400).slice(0, cap);
  const out = await Promise.all(hits.map(async x => {
    const host = nfHost(x.url); if (!host) return null;
    const src = peertubeSrc(await nfFetchJson(`https://${host}/api/v1/videos/${x.uuid}`, 7000));
    if (!src) return null;
    const ch = x.channel || x.account || {}, desc = String(x.truncatedDescription || x.description || '');
    // style 'image' so the search card shows its cover; the thread still plays _video.
    return {
      id: 'pt_' + x.uuid, style: x.thumbnailUrl || x.previewUrl ? 'image' : 'take', country: '', iso: '', tags: inferTags(x.name + ' ' + desc, []),
      body: x.name, _desc: desc.slice(0, 400), score: x.likes || 0, replies: x.comments || 0, reposts: 0, views: x.views || 0,
      time: Date.parse(x.publishedAt || x.createdAt) || env.now(), source: 'peertube',
      _author: ch.displayName || ch.name || host, _handle: '@' + (ch.name || 'peertube') + '@' + (ch.host || host),
      _img: x.thumbnailUrl || x.previewUrl || '', _video: src, _dur: x.duration, _url: x.url, sourceUrl: x.url, _social: true,
      provenance: { sourceHost: host }, imgHue: 270,
    } as Post;
  }));
  return out.filter(Boolean) as Post[];
}
