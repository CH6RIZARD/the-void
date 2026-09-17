// Bridge between the logic core (src/core: VoidAuth over GoTrue REST, sync storage)
// and the app shell (src/lib: supabase-js + AsyncStorage).
//
// ONE session, ONE refresher:
//   - supabase-js (src/lib/supabase) owns token refresh (autoRefreshToken). Two clients
//     rotating the same refresh token would trip GoTrue's reuse detection and revoke
//     the session, so VoidAuth.refresh is re-pointed at supabase-js here.
//   - Every supabase-js auth event is mirrored into VoidAuth.save(), so VoidAPI.token
//     (and every core write) always carries the current access token.
//   - Sessions created by core REST calls (email, id_token, OAuth fragment) are pushed
//     into supabase-js with setSession().
//
// ensureCore() is idempotent and safe to call from every screen. If Agent A configures
// the core at boot, set globalThis.__VOID_CORE_CONFIGURED__ = true first and this will
// only install the session bridge.
import { useEffect, useState, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import {
  configureCore,
  createMemoryStorage,
  env,
  initAuth,
  loadUser as coreLoadUser,
  saveUser as coreSaveUser,
  moderation,
  SIGNED_IN_KEY,
  VoidAuth,
  type LocalUser,
  type SbSession,
} from '../../core';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { saveUser as libSaveUser } from '../../lib/auth';
import { dbSafeLocalHandle, handleError } from './handles';

const G = globalThis as any;
const CORE_KEY_RE = /^(void_|v_|vc_|vcb_|vm_|vd_)/;

export function toSbSession(s: Session | null): SbSession | null {
  if (!s || !s.access_token) return null;
  return {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at,
    provider_token: s.provider_token ?? undefined,
    provider_refresh_token: s.provider_refresh_token ?? undefined,
    user: s.user ? { ...(s.user as any), id: s.user.id, email: s.user.email, is_anonymous: (s.user as any).is_anonymous } : undefined,
  };
}

/** Push a session the core created (REST) into supabase-js so both agree. */
export async function pushSessionToSupabase(): Promise<void> {
  const s = VoidAuth.session;
  if (!s || !s.access_token || !s.refresh_token || !isSupabaseConfigured()) return;
  try {
    const cur = await supabase.auth.getSession();
    if (cur.data.session?.access_token === s.access_token) return;
    G.__VOID_BRIDGE_PUSHING__ = true;
    await supabase.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
  } catch {
    /* core session stays authoritative for this run */
  } finally {
    G.__VOID_BRIDGE_PUSHING__ = false;
  }
}

function installSessionBridge() {
  if (G.__VOID_SESSION_BRIDGE__) return;
  G.__VOID_SESSION_BRIDGE__ = true;
  // supabase-js is the refresher (see header).
  (VoidAuth as any).refresh = async function refresh() {
    if (!isSupabaseConfigured()) return null;
    try {
      if (VoidAuth.session?.refresh_token) {
        const cur = await supabase.auth.getSession();
        if (!cur.data.session) await pushSessionToSupabase();
      }
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        VoidAuth.save(null);
        return null;
      }
      const s = toSbSession(data.session);
      VoidAuth.save(s);
      return s;
    } catch {
      return null;
    }
  };
  const origSignOut = VoidAuth.signOut.bind(VoidAuth);
  (VoidAuth as any).signOut = async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch {}
    await origSignOut();
  };
  supabase.auth.onAuthStateChange((evt, session) => {
    if (evt === 'SIGNED_OUT') {
      if (!G.__VOID_BRIDGE_PUSHING__) VoidAuth.save(null);
      return;
    }
    const s = toSbSession(session);
    if (s) VoidAuth.save({ ...(VoidAuth.session || {}), ...s, user: s.user || VoidAuth.session?.user });
  });
}

async function hydrateStorage(): Promise<Record<string, string>> {
  const initial: Record<string, string> = {};
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => CORE_KEY_RE.test(k));
    const pairs = await AsyncStorage.multiGet(keys);
    pairs.forEach(([k, v]) => {
      if (v != null) initial[k] = v;
    });
  } catch {}
  return initial;
}

/** Configure the core (once), mirror sessions both ways. Await before any core call that needs auth. */
export function ensureCore(): Promise<void> {
  if (G.__VOID_CORE_READY__) return G.__VOID_CORE_READY__;
  G.__VOID_CORE_READY__ = (async () => {
    if (!G.__VOID_CORE_CONFIGURED__) {
      const initial = await hydrateStorage();
      configureCore({
        storage: createMemoryStorage({
          initial,
          onWrite: (k, v) => {
            (v == null ? AsyncStorage.removeItem(k) : AsyncStorage.setItem(k, v)).catch(() => {});
          },
        }),
        oauthRedirect: 'thevoid://auth-callback',
      });
      G.__VOID_CORE_CONFIGURED__ = true;
      try {
        moderation.loadModeration();
      } catch {}
      installSessionBridge();
      initAuth();
    } else {
      installSessionBridge();
    }
    // Adopt a supabase-js session the core does not know about (first-launch anon user from AuthProvider).
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session && VoidAuth.session?.access_token !== data.session.access_token) {
        VoidAuth.save(toSbSession(data.session));
      } else if (!data.session && VoidAuth.session) {
        await pushSessionToSupabase();
      }
    } catch {}
  })();
  return G.__VOID_CORE_READY__;
}

// ── Local identity (web USER) ─────────────────────────────────────────────
const identitySubs = new Set<() => void>();
let identityVersion = 0;
export function subscribeIdentity(cb: () => void): () => void {
  identitySubs.add(cb);
  return () => identitySubs.delete(cb);
}
export function identityRevision(): number {
  return identityVersion;
}
/**
 * web loadUser(), but stable: core loadUser() mints a new random '@xxxxx' on every
 * call until something is saved, and that handle fails the profiles check. The
 * first read persists a DB-valid anonymous handle instead.
 */
export function getIdentity(): LocalUser {
  const u = coreLoadUser();
  let stored = false;
  try {
    stored = !!env.storage.getItem('void_user');
  } catch {}
  if (G.__VOID_CORE_CONFIGURED__ && (!stored || handleError(u.handle))) {
    const fixed = { ...u, handle: dbSafeLocalHandle(u.handle) };
    coreSaveUser(fixed);
    libSaveUser(fixed).catch(() => {});
    return fixed;
  }
  return u;
}
/** web saveUser(): core storage (write-through to AsyncStorage) + lib/auth's in-memory user. */
export async function saveIdentity(patch: Partial<LocalUser>): Promise<LocalUser> {
  const u = { ...coreLoadUser(), ...patch };
  coreSaveUser(u);
  try {
    await libSaveUser(u);
  } catch {}
  identityVersion++;
  identitySubs.forEach((s) => s());
  return u;
}

export function setSignedInFlag(on: boolean): void {
  try {
    env.storage.setItem(SIGNED_IN_KEY, on ? 'true' : 'false');
  } catch {}
  AsyncStorage.setItem(SIGNED_IN_KEY, on ? 'true' : 'false').catch(() => {});
}

export function myUid(): string | null {
  return VoidAuth.session?.user?.id ?? null;
}

/** Re-renders on saveIdentity() and once the core has hydrated from AsyncStorage. */
export function useIdentity(): { user: LocalUser; ready: boolean } {
  const [ready, setReady] = useState<boolean>(!!G.__VOID_CORE_CONFIGURED__);
  useSyncExternalStore(subscribeIdentity, identityRevision, identityRevision);
  useEffect(() => {
    let alive = true;
    ensureCore().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  return { user: getIdentity(), ready };
}
