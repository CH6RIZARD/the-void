// Sign-in gate actions — native port of submitSignIn / signInAnon / submitEmailAuth /
// oauthSignIn / signOut (void2-final.html ~3776-3880). Every function returns '' on
// success or the on-screen error (si-err copy).
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import * as AppleAuthentication from 'expo-apple-authentication';
import { sessionFromOAuthRedirect, VoidAPI, VoidAuth, voidEnsureSession, signOut as coreSignOut } from '../../core';
import { AUTH_REDIRECT_URL } from '../../nav/routes';
import { ensureCore, getIdentity, pushSessionToSupabase, saveIdentity, setSignedInFlag } from './coreBridge';
import { anonHandle, handleError, stripHandle } from './handles';

WebBrowser.maybeCompleteAuthSession();

export const APPLE_AUTH_CODE_KEY = 'void_apple_authorization_code';
export const APPLE_REFRESH_TOKEN_KEY = 'void_apple_refresh_token';
const PENDING_PROFILE_KEY = 'void_pending_profile';

/** profiles upsert with the DB-form handle (no '@'). null when rejected (taken / invalid). */
export async function upsertProfile(handle: string, name: string, extra?: Record<string, unknown>) {
  return VoidAuth.upsertProfile({ handle: stripHandle(handle), display_name: name || 'Anonymous', ...(extra || {}) });
}

export async function handleTaken(handle: string): Promise<boolean> {
  try {
    const rows = await VoidAPI._sb('/rest/v1/profiles?handle=eq.' + encodeURIComponent(stripHandle(handle)) + '&select=id', 'GET');
    const id = rows && rows[0] && rows[0].id;
    return !!id && id !== VoidAPI._uid();
  } catch {
    return false;
  }
}

/** ENTER THE VOID with a claimed handle (anonymous auth user + profiles row). */
export async function enterWithHandle(rawHandle: string, rawName: string): Promise<string> {
  await ensureCore();
  const err = handleError(rawHandle);
  if (err) return err;
  const raw = stripHandle(rawHandle);
  const name = rawName.trim() || raw;
  if (VoidAuth.configured()) {
    try {
      if (!VoidAuth.session) await VoidAuth.signInAnonymously();
      await pushSessionToSupabase();
      const made = await upsertProfile(raw, name);
      if (!made) {
        if (await handleTaken(raw)) return 'HANDLE TAKEN · TRY ANOTHER';
        return 'SIGNAL LOST · RETRY';
      }
    } catch {
      return 'SIGNAL LOST · RETRY';
    }
  }
  await saveIdentity({ handle: '@' + raw, name });
  setSignedInFlag(true);
  VoidAPI.follow('@' + raw, true).catch(() => {});
  return '';
}

/**
 * CONTINUE ANONYMOUSLY. Anonymous is a real account (auth user + profiles row).
 * Fix: the local handle is DB-valid (void_xxxxxx) so the profiles upsert cannot fail
 * the ^[a-z0-9_]{3,20}$ check the way the web's '@xxxxx' did.
 */
export async function continueAnonymously(): Promise<string> {
  await ensureCore();
  let u = getIdentity();
  if (handleError(u.handle)) u = await saveIdentity({ handle: anonHandle() });
  setSignedInFlag(true);
  if (VoidAuth.configured() && !VoidAuth.session) {
    try {
      await VoidAuth.signInAnonymously();
      await pushSessionToSupabase();
      let made = await upsertProfile(u.handle, u.name || 'Anonymous');
      if (!made) {
        // Collision on the random handle: mint another once.
        u = await saveIdentity({ handle: anonHandle() });
        made = await upsertProfile(u.handle, u.name || 'Anonymous');
      }
    } catch {
      /* entry is never blocked on the network (web behaviour) */
    }
  }
  await saveIdentity({});
  return '';
}

/** SIGN IN / SIGN UP with email: sign in, fall back to sign-up only on unrecognised credentials. */
export async function emailAuth(emailRaw: string, pass: string, rawHandle: string, rawName: string): Promise<string> {
  await ensureCore();
  const email = (emailRaw || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'ENTER A VALID EMAIL';
  if ((pass || '').length < 8) return 'PASSWORD MUST BE 8+ CHARACTERS';
  if (!VoidAuth.configured()) return 'BACKEND NOT CONFIGURED';
  const handle = stripHandle(rawHandle);
  const name = (rawName || '').trim();
  if (handle) {
    const herr = handleError(handle);
    if (herr) return herr;
  }
  try {
    try {
      await VoidAuth.signInWithEmail(email, pass);
    } catch (err: any) {
      const m = String((err && err.message) || err);
      if (!/invalid|credential|not found|400/i.test(m)) throw err;
      const d = await VoidAuth.signUpWithEmail(email, pass, { handle, display_name: name });
      if (!d || !d.access_token) return 'CHECK YOUR EMAIL TO CONFIRM, THEN SIGN IN';
    }
    if (VoidAuth.session && !VoidAuth.session.user) {
      const me = await VoidAuth.me();
      if (me) VoidAuth.save({ ...VoidAuth.session, user: me });
    }
    await pushSessionToSupabase();
    const u = getIdentity();
    const next = { handle: handle ? '@' + handle : u.handle, name: name || u.name };
    await saveIdentity(next);
    await upsertProfile(next.handle, next.name);
    setSignedInFlag(true);
    return '';
  } catch (e: any) {
    return (String((e && e.message) || e).slice(0, 80) || 'SIGN-IN FAILED').toUpperCase();
  }
}

/** After any OAuth / Apple session: apply the handle/name typed on the gate (web void_pending_profile). */
export async function applyPendingProfile(): Promise<void> {
  let pending: { handle?: string; name?: string } | null = null;
  try {
    pending = JSON.parse((await AsyncStorage.getItem(PENDING_PROFILE_KEY)) || 'null');
  } catch {}
  await AsyncStorage.removeItem(PENDING_PROFILE_KEY).catch(() => {});
  const u = getIdentity();
  const handle = pending?.handle && !handleError(pending.handle) ? '@' + stripHandle(pending.handle) : u.handle;
  const name = (pending?.name || '').trim() || u.name;
  await saveIdentity({ handle, name });
  const made = await upsertProfile(handle, name).catch(() => null);
  if (!made) {
    try {
      await voidEnsureSession({ handle, name });
    } catch {}
  }
  setSignedInFlag(true);
}

export async function rememberPending(handle: string, name: string) {
  await AsyncStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify({ handle: stripHandle(handle), name: name.trim() })).catch(() => {});
}

/**
 * GOOGLE (and APPLE off iOS): system auth session, never a WebView.
 * Web behaviour: a plain /authorize redirect (the OAuth identity becomes the session;
 * the anonymous account is not merged). Returns '' | error | 'CANCELLED'.
 */
export async function oauthSignIn(provider: 'google' | 'apple', handle: string, name: string, opts?: { applyProfile?: boolean }): Promise<string> {
  await ensureCore();
  if (!VoidAuth.configured()) return 'BACKEND NOT CONFIGURED';
  try {
    await rememberPending(handle, name);
    const res = await WebBrowser.openAuthSessionAsync(VoidAuth.oauthUrl(provider, AUTH_REDIRECT_URL), AUTH_REDIRECT_URL);
    if (res.type !== 'success' || !res.url) return 'CANCELLED';
    const s = await sessionFromOAuthRedirect(res.url);
    if (!s) {
      const q = res.url.split('#')[1] || res.url.split('?')[1] || '';
      const m = /error_description=([^&]+)/.exec(q);
      return ('OAUTH FAILED' + (m ? ': ' + decodeURIComponent(m[1].replace(/\+/g, ' ')) : '')).slice(0, 80).toUpperCase();
    }
    await pushSessionToSupabase();
    // Onboarding decides itself whether the typed handle may be written (a LOGIN
    // must never create or rename a card), so it can defer this step.
    if (opts?.applyProfile !== false) await applyPendingProfile();
    return '';
  } catch (e: any) {
    return ('OAUTH FAILED: ' + ((e && e.message) || '')).slice(0, 80).toUpperCase();
  }
}

/**
 * APPLE on iOS: native sheet -> id_token grant with a SHA-256 nonce.
 * The authorizationCode is kept (APPLE_AUTH_CODE_KEY) for the account-deletion revoke.
 */
export async function appleSignIn(handle: string, name: string, opts?: { applyProfile?: boolean }): Promise<string> {
  await ensureCore();
  if (Platform.OS !== 'ios' || !(await AppleAuthentication.isAvailableAsync().catch(() => false))) {
    return oauthSignIn('apple', handle, name, opts);
  }
  if (!VoidAuth.configured()) return 'BACKEND NOT CONFIGURED';
  try {
    const rawNonce = Crypto.randomUUID();
    const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
    if (!cred.identityToken) return 'APPLE SIGN-IN FAILED';
    const d = await VoidAuth.call('/auth/v1/token?grant_type=id_token', 'POST', { provider: 'apple', id_token: cred.identityToken, nonce: rawNonce });
    if (!d || !d.access_token) return 'APPLE SIGN-IN FAILED';
    VoidAuth.save(d);
    if (cred.authorizationCode) await AsyncStorage.setItem(APPLE_AUTH_CODE_KEY, cred.authorizationCode).catch(() => {});
    if (d.provider_refresh_token) await AsyncStorage.setItem(APPLE_REFRESH_TOKEN_KEY, d.provider_refresh_token).catch(() => {});
    await pushSessionToSupabase();
    const full = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(' ');
    await rememberPending(handle, name.trim() || full);
    if (opts?.applyProfile !== false) await applyPendingProfile();
    return '';
  } catch (e: any) {
    if (e?.code === 'ERR_REQUEST_CANCELED') return 'CANCELLED';
    return ('APPLE SIGN-IN FAILED: ' + ((e && e.message) || '')).slice(0, 80).toUpperCase();
  }
}

/** Settings → SIGN OUT: mark signed out, drop the session (core + supabase-js). */
export async function signOutEverywhere(): Promise<void> {
  await ensureCore();
  setSignedInFlag(false);
  await coreSignOut();
}
