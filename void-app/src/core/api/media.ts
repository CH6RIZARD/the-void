// ─── REAL MEDIA UPLOADS + PERSISTED POSTS + ACCOUNT DELETION ─────────────
// Supabase Storage bucket `post-media` (migration 007). Every photo, video and voice
// take is uploaded to `<auth uid>/<uuid>.<ext>` BEFORE the post is written; the post
// stores only public URLs. A local file URI never reaches the database: if any
// upload or the insert fails, uploaded objects are removed, the pending card is
// withdrawn and the draft stays in the composer.
import { env } from '../env.ts';
import { VoidAuth } from './auth.ts';
import { VoidAPI } from './voidApi.ts';

export const POST_MEDIA_BUCKET = 'post-media';
export const MEDIA_CAPS: Record<string, number> = { image: 10 * 1048576, video: 100 * 1048576, audio: 20 * 1048576 };
// Audio webm is named .weba so the server applies the 20 MB audio cap to it.
export const MEDIA_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/webm': 'weba', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3',
};
export const COMPOSER_MAX_CHARS = 280;
export function mediaMime(t: unknown): string { return String(t || '').split(';')[0].trim().toLowerCase(); }
export function voidUuid(): string {
  const c: any = (globalThis as any).crypto;
  try { if (c && c.randomUUID) return c.randomUUID(); } catch { /* */ }
  const b = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(env.random() * 256);
  b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
// profiles.handle must match ^[a-z0-9_]{3,20}$; the local handle is '@xxxxx'.
export function voidSafeHandle(h: unknown): string {
  let s = String(h || '').replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 20);
  while (s.length < 3) s += '_';
  return s;
}

let _profiled: string | null = null;
/** A post needs an auth user AND a profiles row (posts.author_id -> profiles). */
export async function voidEnsureSession(user: { handle?: string; name?: string }): Promise<string> {
  if (!VoidAuth.configured()) throw new Error('BACKEND UNAVAILABLE');
  if (!VoidAPI._sbReady()) {
    if (!VoidAuth.session) await VoidAuth.signInAnonymously();
    else await VoidAuth.refresh();
  }
  if (!VoidAPI._sbReady()) throw new Error('NOT SIGNED IN');
  const uid = VoidAPI._uid()!;
  if (_profiled !== uid) {
    let rows: any = null;
    try { rows = await VoidAPI._sb('/rest/v1/profiles?id=eq.' + encodeURIComponent(uid) + '&select=id,handle', 'GET'); } catch { /* */ }
    if (!rows || !rows.length) {
      const base = voidSafeHandle(user.handle || 'void');
      let made = await VoidAuth.upsertProfile({ handle: base, display_name: user.name || 'Anonymous' });
      if (!made) made = await VoidAuth.upsertProfile({ handle: (base.slice(0, 14) + '_' + env.random().toString(36).slice(2, 7)).slice(0, 20), display_name: user.name || 'Anonymous' });
      if (!made) throw new Error('PROFILE NOT CREATED');
    }
    _profiled = uid;
  }
  return uid;
}

/**
 * Storage REST upload with the session bearer. `body` is whatever the platform
 * fetch accepts as a raw body (RN: a Blob from `await (await fetch(fileUri)).blob()`).
 * Retries once after a token refresh on 400/401/403. Returns the public URL.
 */
export async function voidUploadMedia(body: any, size: number, mime: string, kind: 'image' | 'video' | 'audio', user: { handle?: string; name?: string }) {
  const ext = MEDIA_EXT[mime];
  if (!ext || !mime.startsWith(kind)) throw new Error('UNSUPPORTED ' + kind.toUpperCase() + ' FORMAT');
  if (size > MEDIA_CAPS[kind]) throw new Error(kind.toUpperCase() + ' TOO LARGE · ' + Math.round(MEDIA_CAPS[kind] / 1048576) + 'MB MAX');
  const uid = await voidEnsureSession(user);
  const path = uid + '/' + voidUuid() + '.' + ext;
  const put = () => env.fetch(`${env.supabaseUrl}/storage/v1/object/${POST_MEDIA_BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + VoidAPI.token, 'apikey': env.supabaseAnonKey, 'Content-Type': mime, 'x-upsert': 'false', 'cache-control': '31536000' }, body,
  });
  let r = await put();
  if (!r.ok && (r.status === 400 || r.status === 401 || r.status === 403)) {
    const t = VoidAPI.token; await VoidAuth.refresh();
    if (VoidAPI.token && VoidAPI.token !== t) r = await put();
  }
  if (!r.ok) {
    let m = ''; try { const d = await r.json(); m = d.message || d.error || ''; } catch { /* */ }
    throw new Error(r.status === 413 || /size|large/i.test(m) ? kind.toUpperCase() + ' TOO LARGE' : /bucket not found/i.test(m) ? 'MEDIA STORAGE NOT READY' : 'UPLOAD FAILED (' + r.status + (m ? ' · ' + m : '') + ')');
  }
  return { url: `${env.supabaseUrl}/storage/v1/object/public/${POST_MEDIA_BUCKET}/${path}`, path, mime, kind };
}
/** Best effort: objects from a drop that did not make it into a post. */
export function voidDeleteMedia(paths: string[]): void {
  if (!paths || !paths.length || !VoidAPI.token) return;
  env.fetch(`${env.supabaseUrl}/storage/v1/object/${POST_MEDIA_BUCKET}`, {
    method: 'DELETE', headers: { 'Authorization': 'Bearer ' + VoidAPI.token, 'apikey': env.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  }).catch(() => { /* */ });
}

// ─── ACCOUNT DELETION (Apple 5.1.1(v), Google Play) ─────────────────────
// Server: Edge Function delete-account (preferred), falling back to the
// delete_my_account() RPC. Local: every per-user key wiped; device config kept.
export const DA_KEEP_KEYS = new Set(['void_theme', 'void_theme_match_system', 'void_supabase_url', 'void_supabase_key', 'void_proxy']);
export function wipeLocalAccountData(): void {
  try {
    const ks = env.storage.keys ? env.storage.keys() : [];
    ks.forEach(k => { if (!DA_KEEP_KEYS.has(k) && /^(void_|v_|vc_|vcb_|vm_|vd_|sb-)/.test(k)) env.storage.removeItem(k); });
    env.storage.removeItem('void_sb_session'); env.storage.removeItem('void_signed_in');
  } catch { /* */ }
  try { const sk = env.session.keys ? env.session.keys() : []; sk.forEach(k => env.session.removeItem(k)); } catch { /* */ }
}
/** Returns {ok, message}. ok=false means NOTHING was deleted and message says why. */
export async function deleteAccount(): Promise<{ ok: boolean; message: string }> {
  if (!VoidAuth.configured() || !VoidAuth.session || !VoidAuth.session.access_token) {
    VoidAuth.save(null); wipeLocalAccountData();
    return { ok: true, message: 'There was no server account on this device. All local data has been erased.' };
  }
  const exp = VoidAuth.session.expires_at || 0;
  if (exp && exp * 1000 < env.now() + 60000) await VoidAuth.refresh();
  if (!VoidAuth.session) return { ok: false, message: 'YOUR SESSION EXPIRED. SIGN IN AGAIN, THEN DELETE. NOTHING WAS DELETED.' };
  const s = VoidAuth.session!;
  const hdr = { 'Content-Type': 'application/json', 'apikey': env.supabaseAnonKey, 'Authorization': 'Bearer ' + s.access_token };
  let result: any = null, note = '';
  try {
    const r = await env.fetch(env.supabaseUrl + '/functions/v1/delete-account', {
      method: 'POST', headers: hdr,
      body: JSON.stringify({ apple_refresh_token: s.provider_refresh_token || undefined, apple_access_token: s.provider_token || undefined }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d && d.ok) result = d;
    else if (r.status === 500 && d && d.data_deleted) { result = d; note = ' Your login record is queued for removal on the server.'; }
    else if (r.status === 401) return { ok: false, message: 'THE SERVER REJECTED YOUR SESSION. SIGN IN AGAIN, THEN DELETE. NOTHING WAS DELETED.' };
  } catch { /* edge unreachable: RPC fallback */ }
  if (!result) {
    try {
      const r = await env.fetch(env.supabaseUrl + '/rest/v1/rpc/delete_my_account', { method: 'POST', headers: hdr, body: '{}' });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d) { result = d; if (!d.auth_user_deleted) note = ' Your data is gone; your login record is queued for removal on the server.'; }
      else if (r.status === 404 || (d && d.code === 'PGRST202'))
        return { ok: false, message: 'ACCOUNT DELETION IS NOT AVAILABLE ON THE SERVER YET. NOTHING WAS DELETED. TRY AGAIN LATER.' };
      else return { ok: false, message: ('DELETION FAILED: ' + ((d && (d.message || d.error)) || ('HTTP ' + r.status)) + '. NOTHING WAS DELETED ON THIS DEVICE.').toUpperCase().slice(0, 180) };
    } catch {
      return { ok: false, message: 'COULD NOT REACH THE SERVER. CHECK YOUR CONNECTION. NOTHING WAS DELETED.' };
    }
  }
  if (note) { try { await VoidAuth.signOut(); } catch { /* */ } }
  VoidAuth.save(null); wipeLocalAccountData();
  return { ok: true, message: 'Your account and its data have been deleted.' + note };
}
