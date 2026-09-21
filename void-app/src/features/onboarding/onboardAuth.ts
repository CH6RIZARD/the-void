// The Signal Card's auth. NEW USER and LOGIN stay strictly apart (HANDOFF.md):
//   • NEW never logs into, or renames, an existing card — it reports CARD EXISTS.
//   • LOGIN never creates one — an unknown identity is NO CARD FOUND, and the session
//     that was on the device before the attempt is put back.
// Every function resolves to { err } or { via, handle }; the card plays its success
// state only on the latter, i.e. only after the server has approved the credential.
import { env, VoidAPI, VoidAuth } from '../../core';
import {
  appleSignIn,
  applyPendingProfile,
  continueAnonymously,
  handleTaken,
  oauthSignIn,
  rememberPending,
  upsertProfile,
} from '../auth/authActions';
import { ensureCore, getIdentity, pushSessionToSupabase, saveIdentity, setSignedInFlag } from '../auth/coreBridge';
import { handleError, stripHandle } from '../auth/handles';
import { t } from './copy';

export type Via = 'anon' | 'apple' | 'google' | 'email' | 'login';
export type AuthResult = { err: string } | { err: ''; via: Via; handle: string };
type Provider = 'apple' | 'google';

const fail = (err: string): AuthResult => ({ err });
/** Set while an email sign-up waits on its confirmation link (see auth-callback). */
export const RESUME_KEY = 'void_onboard_resume';
const ok = (via: Via, handle: string): AuthResult => ({ err: '', via, handle });

// Random anonymous handles (anonHandle) are not a card someone chose.
const ANON_HANDLE = /^void_[a-z0-9]{6}$/;

/** Client-side handle rules, with the card's copy. '' when fine. */
export function handleProblem(raw: string, mode: 'create' | 'login'): string {
  const h = stripHandle(raw);
  if (!h) return t(mode === 'login' ? 'err.handle.missing.login' : 'err.handle.missing.new');
  return handleError(h) ? t('err.handle.format') : '';
}

/** Server-side uniqueness, checked BEFORE any provider popup (HANDOFF.md). */
export async function claimCheck(raw: string): Promise<string> {
  const p = handleProblem(raw, 'create');
  if (p) return p;
  await ensureCore();
  return (await handleTaken(stripHandle(raw))) ? t('err.server.handleTaken') : '';
}

// ── provider availability ──────────────────────────────────────────────────
// Google/Apple are switched off in the project's auth settings today. Asking the
// server first turns a dead redirect into a plain sentence on the card.
let providerCache: { at: number; on: Record<string, boolean> } | null = null;
async function providerOn(p: Provider): Promise<boolean> {
  if (!providerCache || Date.now() - providerCache.at > 5 * 60_000) {
    try {
      const r = await env.fetch(env.supabaseUrl + '/auth/v1/settings', { headers: { apikey: env.supabaseAnonKey } });
      const d = r.ok ? await r.json() : null;
      providerCache = { at: Date.now(), on: (d && d.external) || {} };
    } catch {
      return true; // can't tell: let the real attempt report
    }
  }
  return !!providerCache.on[p];
}

async function myCard(): Promise<string | null> {
  const uid = VoidAPI._uid();
  if (!uid) return null;
  try {
    const rows = await VoidAPI._sb('/rest/v1/profiles?id=eq.' + encodeURIComponent(uid) + '&select=handle', 'GET');
    return (rows && rows[0] && rows[0].handle) || null;
  } catch {
    return null;
  }
}

async function adoptCard(handle: string): Promise<void> {
  const u = getIdentity();
  await saveIdentity({ handle: '@' + stripHandle(handle), name: u.name && u.name !== 'Anonymous' ? u.name : stripHandle(handle) });
  setSignedInFlag(true);
}

/** Put back whatever session the device had before a failed LOGIN attempt. */
async function restore(prev: typeof VoidAuth.session): Promise<void> {
  VoidAuth.save(prev || null);
  await pushSessionToSupabase().catch(() => {});
}

// ── NEW USER ───────────────────────────────────────────────────────────────

/** ENTER BLANK: the anonymous device account (usually already made at boot). */
export async function enterBlank(): Promise<AuthResult> {
  await continueAnonymously();
  return ok('anon', '');
}

export async function createWithProvider(p: Provider, rawHandle: string): Promise<AuthResult> {
  const handle = stripHandle(rawHandle);
  const taken = await claimCheck(handle);
  if (taken) return fail(taken);
  if (!(await providerOn(p))) return fail(t('err.server.providerOff', { PROVIDER: p.toUpperCase() }));
  const e = await (p === 'apple' ? appleSignIn(handle, handle, { applyProfile: false }) : oauthSignIn(p, handle, handle, { applyProfile: false }));
  if (e) return fail(e);
  // This provider identity may already hold a card: that's a login, not a rename —
  // the typed handle is dropped and the card they already own comes back.
  const existing = await myCard();
  if (existing && !ANON_HANDLE.test(existing)) {
    await adoptCard(existing);
    return ok('login', stripHandle(existing));
  }
  await rememberPending(handle, handle);
  await applyPendingProfile();
  return ok(p, handle);
}

export async function createWithEmail(rawHandle: string, emailRaw: string, pass: string): Promise<AuthResult> {
  const handle = stripHandle(rawHandle);
  const taken = await claimCheck(handle);
  if (taken) return fail(taken);
  if (!VoidAuth.configured()) return fail(t('err.server.offline'));
  const email = emailRaw.trim();
  try {
    const d = await VoidAuth.signUpWithEmail(email, pass, { handle, display_name: handle });
    // No session back = the project requires the confirmation email first. The link
    // reopens the app at auth-callback, which writes this handle and resumes at Ignite.
    if (!d || !d.access_token) {
      await rememberPending(handle, handle);
      try {
        env.storage.setItem(RESUME_KEY, 'ignite');
      } catch {}
      return fail(t('err.server.confirmEmail'));
    }
    if (VoidAuth.session && !VoidAuth.session.user) {
      const me = await VoidAuth.me();
      if (me) VoidAuth.save({ ...VoidAuth.session, user: me });
    }
    await pushSessionToSupabase();
    const made = await upsertProfile(handle, handle);
    if (!made) return fail((await handleTaken(handle)) ? t('err.server.handleTaken') : t('err.server.offline'));
    await adoptCard(handle);
    return ok('email', handle);
  } catch (e: any) {
    const m = String((e && e.message) || e);
    if (/already registered|already exists/i.test(m)) return fail(t('err.server.cardExists'));
    if (/password/i.test(m)) return fail(t('err.pass.short'));
    return fail(t('err.server.offline'));
  }
}

// ── LOGIN ──────────────────────────────────────────────────────────────────

/**
 * Handle + password. The auth server only knows emails, so the `handle-login` edge
 * function maps handle → email server-side and runs the password grant there; the
 * email never reaches the device.
 */
export async function loginWithHandle(rawHandle: string, pass: string): Promise<AuthResult> {
  await ensureCore();
  const handle = stripHandle(rawHandle);
  const prev = VoidAuth.session;
  try {
    const r = await env.fetch(env.supabaseUrl + '/functions/v1/handle-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.supabaseAnonKey, Authorization: 'Bearer ' + env.supabaseAnonKey },
      body: JSON.stringify({ handle, password: pass }),
    });
    if (r.status === 404) return fail(t('err.server.handleLoginOff'));
    if (r.status === 429) return fail(t('err.server.offline'));
    if (!r.ok) return fail(t('err.server.badLogin'));
    const d = await r.json();
    if (!d || !d.access_token) return fail(t('err.server.badLogin'));
    VoidAuth.save(d);
    await pushSessionToSupabase();
    const card = (await myCard()) || handle;
    await adoptCard(card);
    return ok('login', stripHandle(card));
  } catch {
    await restore(prev);
    return fail(t('err.server.offline'));
  }
}

export async function loginWithEmail(emailRaw: string, pass: string): Promise<AuthResult> {
  await ensureCore();
  if (!VoidAuth.configured()) return fail(t('err.server.offline'));
  const prev = VoidAuth.session;
  try {
    await VoidAuth.signInWithEmail(emailRaw.trim(), pass);
  } catch (e: any) {
    await restore(prev);
    const m = String((e && e.message) || e);
    // The auth server answers the same for "no such email" and "wrong password",
    // on purpose (no account probing), so the card can't tell them apart either.
    if (/invalid|credential|not found|400/i.test(m)) return fail(t('err.server.badEmailLogin'));
    if (/confirm/i.test(m)) return fail(t('err.server.confirmEmail'));
    return fail(t('err.server.offline'));
  }
  if (VoidAuth.session && !VoidAuth.session.user) {
    const me = await VoidAuth.me().catch(() => null);
    if (me) VoidAuth.save({ ...VoidAuth.session, user: me });
  }
  await pushSessionToSupabase();
  const card = await myCard();
  if (card) await adoptCard(card);
  else setSignedInFlag(true);
  return ok('login', card ? stripHandle(card) : '');
}

export async function loginWithProvider(p: Provider): Promise<AuthResult> {
  await ensureCore();
  if (!(await providerOn(p))) return fail(t('err.server.providerOff', { PROVIDER: p.toUpperCase() }));
  const prev = VoidAuth.session;
  const e = await (p === 'apple' ? appleSignIn('', '', { applyProfile: false }) : oauthSignIn(p, '', '', { applyProfile: false }));
  if (e) {
    if (e !== 'CANCELLED') await restore(prev);
    return fail(e);
  }
  const card = await myCard();
  if (!card) {
    // The provider made a fresh auth user; there is no card behind it.
    await restore(prev);
    return fail(t('err.server.noAccount'));
  }
  await adoptCard(card);
  return ok('login', stripHandle(card));
}
