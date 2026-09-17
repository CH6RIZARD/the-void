// Auth state for screens. Auth ACTIONS (enter with handle, continue anonymously,
// email, Apple, Google, sign out) live in src/features/auth/authActions.ts, and the
// core <-> supabase-js session bridge in src/features/auth/coreBridge.ts.
// This file must not import src/features (coreBridge imports it).
//
//   const { ready, session, user, signedIn, isAnonymous, refreshSignedIn, refresh } = useAuth();
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { env, loadUser as coreLoadUser, SIGNED_IN_KEY, VoidAuth, type LocalUser, type SbSession } from '../core/index.ts';
import { supabase } from './supabase';

export type VoidUser = LocalUser;

let cachedUser: LocalUser | null = null;
const listeners = new Set<() => void>();

/** Notify useAuth() consumers that session / identity changed. */
export function notifyAuthChanged(): void {
  listeners.forEach((l) => l());
}

/** Current local identity (web USER). Handles are stored as '@handle'. */
export function loadUser(): LocalUser {
  if (cachedUser) return cachedUser;
  try {
    const raw = env.storage.getItem('void_user');
    if (raw) return (cachedUser = JSON.parse(raw));
  } catch {}
  return coreLoadUser();
}

/** In-memory mirror used by coreBridge.saveIdentity (which already wrote core storage). */
export async function saveUser(u: Partial<LocalUser>): Promise<LocalUser> {
  const next = { ...loadUser(), ...u } as LocalUser;
  cachedUser = next;
  notifyAuthChanged();
  return next;
}

export function isSignedIn(): boolean {
  try {
    return env.storage.getItem(SIGNED_IN_KEY) === 'true';
  } catch {
    return true;
  }
}

export interface AuthState {
  ready: boolean;
  session: SbSession | null;
  user: LocalUser;
  signedIn: boolean;
  isAnonymous: boolean;
  /** Re-read the signed-in flag / identity / session (async for older callers). */
  refreshSignedIn: () => Promise<void>;
  refresh: () => void;
}

const read = () => {
  cachedUser = null;
  return { session: VoidAuth.session, user: loadUser(), signedIn: isSignedIn() };
};

const AuthContext = createContext<AuthState | null>(null);

/** Mount after bootCore() resolved (app/_layout.tsx does). */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [snap, setSnap] = useState(read);
  const refresh = useCallback(() => setSnap(read()), []);
  const refreshSignedIn = useCallback(async () => refresh(), [refresh]);

  useEffect(() => {
    listeners.add(refresh);
    // Token refreshes / sign-outs arrive through supabase-js (mirrored into VoidAuth by the bridge).
    const { data } = supabase.auth.onAuthStateChange(() => setTimeout(refresh, 0));
    return () => {
      listeners.delete(refresh);
      data.subscription.unsubscribe();
    };
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({ ...snap, ready: true, isAnonymous: !!snap.session?.user?.is_anonymous, refreshSignedIn, refresh }),
    [snap, refresh, refreshSignedIn],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
