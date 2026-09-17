// ─── SUPABASE AUTH (GoTrue over REST) ───────────────────────────────────
// Anonymous-first, because "Anonymous by default" is the product. Supabase anonymous
// sign-in issues a REAL auth user (and a real profiles row), so every foreign key
// works for an anonymous account, and an OAuth identity can be LINKED to that same
// user later without orphaning history. Called over REST, not supabase-js.
import { env, onConfigure } from '../env.ts';
import { VoidAPI } from './voidApi.ts';

export const SB_SESSION_KEY = 'void_sb_session';
export const SIGNED_IN_KEY = 'void_signed_in';

export interface SbSession {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  provider_token?: string;
  provider_refresh_token?: string;
  user?: { id: string; email?: string; is_anonymous?: boolean; [k: string]: any };
  [k: string]: any;
}

export const VoidAuth = {
  configured(): boolean { return !!(env.supabaseUrl && env.supabaseAnonKey); },
  session: null as SbSession | null,
  load(): SbSession | null {
    try { this.session = JSON.parse(env.storage.getItem(SB_SESSION_KEY) || 'null'); } catch { this.session = null; }
    return this.session;
  },
  save(s: SbSession | null) {
    this.session = s || null;
    try { s ? env.storage.setItem(SB_SESSION_KEY, JSON.stringify(s)) : env.storage.removeItem(SB_SESSION_KEY); } catch { /* */ }
    // One place decides what the write API authenticates as.
    VoidAPI.token = (s && s.access_token) || null;
  },
  headers(extra?: Record<string, string>): Record<string, string> {
    return Object.assign({ 'Content-Type': 'application/json', 'apikey': env.supabaseAnonKey },
      this.session && this.session.access_token ? { Authorization: 'Bearer ' + this.session.access_token } : {}, extra || {});
  },
  async call(path: string, method?: string, body?: unknown): Promise<any> {
    const r = await env.fetch(env.supabaseUrl + path, { method: method || 'POST', headers: this.headers(), body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((d && (d.msg || d.error_description || d.message)) || ('auth ' + r.status));
    return d;
  },
  /** A real user with no credentials. Requires "Anonymous sign-ins" enabled in the dashboard (422 otherwise). */
  async signInAnonymously(): Promise<any> {
    try {
      const d = await this.call('/auth/v1/signup', 'POST', { data: { anonymous: true } });
      if (d.access_token) this.save(d);
      return d;
    } catch (e: any) {
      env.log('[auth] anonymous sign-in unavailable — enable it in Supabase Auth settings.', e && e.message);
      throw e;
    }
  },
  async signUpWithEmail(email: string, password: string, meta?: Record<string, unknown>): Promise<any> {
    const d = await this.call('/auth/v1/signup', 'POST', { email, password, data: meta || {} });
    if (d.access_token) this.save(d);
    return d;
  },
  async signInWithEmail(email: string, password: string): Promise<any> {
    const d = await this.call('/auth/v1/token?grant_type=password', 'POST', { email, password });
    if (d.access_token) this.save(d);
    return d;
  },
  /**
   * Links an identity to the CURRENT (possibly anonymous) user. Natively open this in
   * an auth session (expo-web-browser openAuthSessionAsync) with env.oauthRedirect
   * registered in Supabase's redirect allow-list, then pass the return URL to
   * sessionFromOAuthRedirect().
   */
  oauthUrl(provider: string, redirectTo?: string): string {
    return env.supabaseUrl + '/auth/v1/authorize?provider=' + encodeURIComponent(provider) +
      '&redirect_to=' + encodeURIComponent(redirectTo || env.oauthRedirect);
  },
  async refresh(): Promise<any> {
    if (!this.session || !this.session.refresh_token) return null;
    try {
      const d = await this.call('/auth/v1/token?grant_type=refresh_token', 'POST', { refresh_token: this.session.refresh_token });
      if (d.access_token) this.save(d);
      return d;
    } catch { this.save(null); return null; }
  },
  async me(): Promise<any> {
    if (!this.session) return null;
    try { return await this.call('/auth/v1/user', 'GET'); } catch { return null; }
  },
  async signOut(): Promise<void> {
    try { if (this.session) await this.call('/auth/v1/logout', 'POST', {}); } catch { /* */ }
    this.save(null);
  },
  /** profiles is the app-facing identity, written through PostgREST so RLS applies. */
  async upsertProfile(fields: Record<string, unknown>): Promise<any> {
    if (!this.session) return null;
    const r = await env.fetch(env.supabaseUrl + '/rest/v1/profiles', {
      method: 'POST',
      headers: this.headers({ 'Prefer': 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify([Object.assign({ id: this.session.user && this.session.user.id }, fields)]),
    });
    if (!r.ok) return null;
    return r.json().catch(() => null);
  },
};

/**
 * GoTrue returns the session in the redirect URL FRAGMENT
 * (#access_token=..&refresh_token=..&expires_at=..). Parse it, fetch the user, save.
 */
export async function sessionFromOAuthRedirect(url: string): Promise<SbSession | null> {
  const frag = String(url || '').split('#')[1] || String(url || '').split('?')[1] || '';
  const q: Record<string, string> = {};
  frag.split('&').forEach(kv => { const i = kv.indexOf('='); if (i > 0) q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); });
  if (!q.access_token) return null;
  const s: SbSession = { access_token: q.access_token, refresh_token: q.refresh_token, expires_at: q.expires_at ? +q.expires_at : undefined, provider_token: q.provider_token, provider_refresh_token: q.provider_refresh_token };
  VoidAuth.save(s);
  const user = await VoidAuth.me();
  if (user) VoidAuth.save({ ...s, user });
  return VoidAuth.session;
}

/** Restore a session before anything reads it, and refresh in the background. */
export function initAuth(): void {
  try {
    VoidAuth.load();
    if (VoidAuth.session) {
      VoidAPI.token = VoidAuth.session.access_token || null;
      VoidAuth.refresh();
    }
  } catch (e) { env.log('[auth] init failed', e); }
}
onConfigure(() => { VoidAuth.session = null; VoidAPI.token = null; const s = VoidAuth.load(); if (s) VoidAPI.token = s.access_token || null; });

// Local identity gate: "signed in" = this device claimed a handle (or went anon).
export function isSignedIn(): boolean {
  // If storage is unavailable, do NOT trap the user behind a gate we cannot clear.
  try { return env.storage.getItem(SIGNED_IN_KEY) === 'true'; } catch { return true; }
}

export interface LocalUser { name: string; handle: string; bio: string; posts: number; following: number; followers: number; }
export function loadUser(): LocalUser {
  try { const u = JSON.parse(env.storage.getItem('void_user') || 'null'); if (u) return u; } catch { /* */ }
  return { name: 'Anonymous', handle: '@' + env.random().toString(36).slice(2, 7), bio: 'signal in the noise', posts: 0, following: 0, followers: 0 };
}
export function saveUser(u: LocalUser): void { try { env.storage.setItem('void_user', JSON.stringify(u)); } catch { /* */ } }

/**
 * ENTER THE VOID anonymously. Anonymous is a real account (auth user + profiles row)
 * so it can post, react and be replied to. Resolves once the background sign-in
 * settles (errors are logged, never thrown — entry is never blocked on network).
 */
export async function signInAnon(user: LocalUser): Promise<void> {
  try { env.storage.setItem(SIGNED_IN_KEY, 'true'); } catch { /* */ }
  saveUser(user);
  if (VoidAuth.configured() && !VoidAuth.session) {
    try {
      await VoidAuth.signInAnonymously();
      await VoidAuth.upsertProfile({ handle: user.handle, display_name: user.name || 'Anonymous' });
    } catch (e) { env.log('[auth] anonymous sign-in failed', e); }
  }
}

/** Validation for the claim-a-handle form. '' when valid, else the on-screen error. */
export function validateHandle(raw: string): string {
  const h = String(raw || '').trim().replace(/^@/, '');
  if (!h) return 'HANDLE REQUIRED';
  if (h.length < 2) return 'HANDLE TOO SHORT';
  if (!/^[a-zA-Z0-9_.]+$/.test(h)) return 'LETTERS, NUMBERS, _ AND . ONLY';
  return '';
}
/** Claim a handle on this device, then (background) anonymous auth user + profile row. */
export async function submitSignIn(user: LocalUser, rawHandle: string, name: string): Promise<string> {
  const err = validateHandle(rawHandle); if (err) return err;
  const raw = rawHandle.trim().replace(/^@/, '');
  user.handle = '@' + raw.toLowerCase();
  user.name = name.trim() || raw;
  saveUser(user);
  try { env.storage.setItem(SIGNED_IN_KEY, 'true'); } catch { /* */ }
  if (VoidAuth.configured()) {
    (VoidAuth.session ? Promise.resolve() : VoidAuth.signInAnonymously())
      .then(() => VoidAuth.upsertProfile({ handle: user.handle, display_name: user.name }))
      .catch(e => env.log('[auth] sign-in failed', e));
  }
  VoidAPI.follow(user.handle, true).catch(() => { /* */ });
  return '';
}
/**
 * One button for sign-in and sign-up: try sign-in, and only fall back to sign-up
 * when the credentials are genuinely unrecognised. Returns '' or the error text.
 */
export async function submitEmailAuth(user: LocalUser, email: string, pass: string, handle: string, name: string): Promise<string> {
  email = (email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'ENTER A VALID EMAIL';
  if ((pass || '').length < 8) return 'PASSWORD MUST BE 8+ CHARACTERS';
  if (!VoidAuth.configured()) return 'BACKEND NOT CONFIGURED';
  handle = (handle || '').trim().toLowerCase(); name = (name || '').trim();
  try {
    try { await VoidAuth.signInWithEmail(email, pass); }
    catch (err: any) {
      const m = String((err && err.message) || err);
      if (!/invalid|credential|not found|400/i.test(m)) throw err;
      await VoidAuth.signUpWithEmail(email, pass, { handle, display_name: name });
    }
    if (handle) user.handle = handle.startsWith('@') ? handle : '@' + handle;
    if (name) user.name = name;
    saveUser(user);
    await VoidAuth.upsertProfile({ handle: user.handle, display_name: user.name });
    try { env.storage.setItem(SIGNED_IN_KEY, 'true'); } catch { /* */ }
    return '';
  } catch (e: any) {
    return (String((e && e.message) || e).slice(0, 80) || 'SIGN-IN FAILED').toUpperCase();
  }
}
export async function signOut(): Promise<void> {
  try { env.storage.setItem(SIGNED_IN_KEY, 'false'); } catch { /* */ }
  if (VoidAuth.configured()) await VoidAuth.signOut(); else VoidAuth.save(null);
}
