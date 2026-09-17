// ─── BACKEND ADAPTER ────────────────────────────────────────────────────
// Every bolt / reply / repost / share / follow goes through this one object. Modes:
//   1) `base` set -> REST API at that origin (custom proxy)
//   2) `base` null + VoidAuth session -> Supabase PostgREST
//   3) otherwise -> {ok:true, local:true}; local scorers stay authoritative
// Seed/demo posts use non-UUID ids and ALWAYS stay local. UI updates optimistically
// and rolls back on rejection.
import { env } from '../env.ts';
import type { ApiResult } from '../types.ts';
import { VoidAuth } from './auth.ts';

export const VoidAPI = {
  base: null as string | null, // custom REST origin; null = Supabase PostgREST when authed
  token: null as string | null, // set by VoidAuth; every write authenticates as the signed-in user
  _uuid(id: unknown): boolean { return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id); },
  _uid(): string | null { try { return (VoidAuth.session && VoidAuth.session.user && VoidAuth.session.user.id) || null; } catch { return null; } },
  _sbReady(): boolean { return !this.base && VoidAuth.configured() && !!this._uid() && !!this.token; },
  async call(method: string, path: string, body?: unknown): Promise<any> {
    if (!this.base) return { ok: true, local: true };
    const r = await env.fetch(this.base + path, {
      method, headers: Object.assign({ 'Content-Type': 'application/json' }, this.token ? { Authorization: 'Bearer ' + this.token } : {}) as Record<string, string>,
      body: body && JSON.stringify(body),
    });
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.status === 204 ? { ok: true } : r.json();
  },
  async _sb(path: string, method?: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<any> {
    const headers = Object.assign({ 'Content-Type': 'application/json', 'apikey': env.supabaseAnonKey, 'Authorization': 'Bearer ' + this.token }, extraHeaders || {});
    const r = await env.fetch(env.supabaseUrl + path, { method: method || 'GET', headers, body: body != null ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) throw new Error((data && (data.message || data.error_description || data.msg)) || (path + ' ' + r.status));
    return data;
  },
  async bolt(id: string, on: boolean): Promise<ApiResult> {
    if (this.base) return this.call(on ? 'POST' : 'DELETE', `/posts/${id}/bolt`);
    if (!this._uuid(id) || !this._sbReady()) return { ok: true, local: true };
    const uid = this._uid()!;
    if (on) {
      await this._sb('/rest/v1/reactions', 'POST', [{ post_id: id, user_id: uid, kind: 'rank' }], { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
    } else {
      await this._sb('/rest/v1/reactions?post_id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(uid), 'DELETE');
    }
    const rows = await this._sb('/rest/v1/posts?id=eq.' + encodeURIComponent(id) + '&select=rank_score');
    return { ok: true, rank_score: rows && rows[0] && rows[0].rank_score };
  },
  async reply(id: string, body: string, parentId?: string | null): Promise<ApiResult> {
    if (this.base) return this.call('POST', `/posts/${id}/replies`, { body, parentId });
    if (!this._uuid(id) || !this._sbReady()) return { ok: true, local: true };
    const row = { author_id: this._uid(), body: String(body || '').slice(0, 4000), reply_to: parentId && this._uuid(parentId) ? parentId : id };
    const data = await this._sb('/rest/v1/posts', 'POST', [row], { 'Prefer': 'return=representation' });
    return { ok: true, reply: data && data[0] };
  },
  async replies(id: string, cursor?: string): Promise<ApiResult> {
    if (this.base) return this.call('GET', `/posts/${id}/replies?cursor=${cursor || ''}`);
    if (!this._uuid(id) || !this._sbReady()) return { ok: true, local: true, items: [] };
    let q = '/rest/v1/posts?reply_to=eq.' + encodeURIComponent(id) + '&select=id,author_id,body,rank_score,created_at,profiles:author_id(handle,display_name)&order=created_at.asc&limit=50';
    if (cursor) q += '&created_at=gt.' + encodeURIComponent(cursor);
    const items = await this._sb(q, 'GET');
    return { ok: true, items: items || [], count: (items || []).length };
  },
  /**
   * A composer drop. media = [{url,kind,mime,duration_s}] — public Storage URLs only,
   * never local file URIs. create_post (migration 007) writes the post and its
   * post_media rows in one transaction; pre-007 falls back to two writes + undo.
   */
  async createPost(id: string, body: string, media?: Array<{ url: string; kind: string; mime?: string; duration_s?: number }>): Promise<ApiResult> {
    if (this.base) return this.call('POST', '/posts', { id, body, media });
    if (!this._uuid(id) || !this._sbReady()) throw new Error('NOT SIGNED IN');
    media = (media || []).filter(m => m && /^https:\/\//.test(m.url));
    const text = String(body || '').slice(0, 4000);
    try {
      await this._sb('/rest/v1/rpc/create_post', 'POST', {
        p_id: id, p_body: text,
        p_media: media.map(m => ({ url: m.url, kind: m.kind, mime: m.mime || null, duration_s: m.duration_s || null })), p_reply_to: null,
      });
    } catch (e: any) {
      if (!/create_post|PGRST202|schema cache/i.test(String(e && e.message))) throw e;
      await this._sb('/rest/v1/posts', 'POST', [{ id, author_id: this._uid(), body: text }], { 'Prefer': 'return=minimal' });
      if (media.length) {
        try { await this._sb('/rest/v1/post_media', 'POST', media.map((m, i) => ({ post_id: id, url: m.url, ordinal: i })), { 'Prefer': 'return=minimal' }); }
        catch (e2) { try { await this._sb('/rest/v1/posts?id=eq.' + encodeURIComponent(id), 'DELETE'); } catch { /* */ } throw e2; }
      }
    }
    return { ok: true, id };
  },
  /** Recent top-level Void posts with author + media. Public read (anon key works). */
  async recentPosts(limit?: number): Promise<any[]> {
    if (!env.supabaseUrl) return [];
    const full = 'id,author_id,body,rank_score,created_at,profiles:author_id(handle,display_name),post_media(url,ordinal,kind,mime,duration_s)';
    const q = (s: string) => '/rest/v1/posts?reply_to=is.null&select=' + s + '&order=created_at.desc&limit=' + (limit || 40);
    const get = (s: string, tok: string | null) => env.fetch(env.supabaseUrl + q(s), { headers: { 'apikey': env.supabaseAnonKey, 'Authorization': 'Bearer ' + (tok || env.supabaseAnonKey) } });
    let r = await get(full, this.token);
    if (r.status === 401) r = await get(full, null);
    if (r.status === 400) r = await get(full.replace(',kind,mime,duration_s', ''), null);   // pre-007 columns
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  },
  async repost(id: string, on: boolean): Promise<ApiResult> {
    if (this.base) return this.call(on ? 'POST' : 'DELETE', `/posts/${id}/repost`);
    // No dedicated reposts table yet — local until schema grows one.
    return { ok: true, local: true };
  },
  async share(id: string): Promise<ApiResult> {
    if (this.base) return this.call('POST', `/posts/${id}/share`);
    return { ok: true, local: true };
  },
  async follow(handle: string, on: boolean): Promise<ApiResult> {
    if (this.base) return this.call(on ? 'POST' : 'DELETE', `/follow/${handle}`);
    if (!this._sbReady()) return { ok: true, local: true };
    const me = this._uid()!;
    const rows = await this._sb('/rest/v1/profiles?handle=eq.' + encodeURIComponent(String(handle || '').replace(/^@/, '')) + '&select=id', 'GET');
    const other = rows && rows[0] && rows[0].id;
    if (!other || other === me) return { ok: true, local: true };
    if (on) {
      await this._sb('/rest/v1/follows', 'POST', [{ follower_id: me, followee_id: other }], { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
    } else {
      await this._sb('/rest/v1/follows?follower_id=eq.' + encodeURIComponent(me) + '&followee_id=eq.' + encodeURIComponent(other), 'DELETE');
    }
    return { ok: true };
  },
  async reels(seed?: string): Promise<ApiResult> {
    if (this.base) return this.call('GET', `/feed/reels?seed=${seed || ''}`);
    return { ok: true, local: true, items: [] };
  },
  async nationFeed(iso: string, cursor?: string): Promise<ApiResult> {
    if (this.base) return this.call('GET', `/feed/nation/${iso}?cursor=${cursor || ''}`);
    if (!iso || !(this.base || env.supabaseUrl)) return { ok: true, local: true, items: [] };
    // Public read — works with anon key even before a session.
    try {
      let q = '/rest/v1/posts?region_code=eq.' + encodeURIComponent(iso) + '&reply_to=is.null&select=id,author_id,body,rank_score,created_at,region_code&order=rank_score.desc,created_at.desc&limit=40';
      if (cursor) q += '&created_at=lt.' + encodeURIComponent(cursor);
      const headers = { 'apikey': env.supabaseAnonKey, 'Authorization': 'Bearer ' + (this.token || env.supabaseAnonKey) };
      const r = await env.fetch(env.supabaseUrl + q, { headers });
      if (!r.ok) return { ok: true, local: true, items: [] };
      return { ok: true, items: await r.json() };
    } catch { return { ok: true, local: true, items: [] }; }
  },
  async nationTop3(iso: string): Promise<ApiResult> {
    if (this.base) return this.call('GET', `/rank/nation/${iso}/top3`);
    const feed = await this.nationFeed(iso);
    return { ok: true, items: (feed.items || []).slice(0, 3) };
  },
};
