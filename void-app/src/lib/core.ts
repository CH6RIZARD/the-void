// Boots Agent B's logic core (src/core) for React Native.
//
//   await bootCore()   // once, before any screen renders (app/_layout.tsx gates on it)
//
// 1. Storage: the core needs a SYNCHRONOUS localStorage-shaped KV. We hydrate an
//    in-memory map from AsyncStorage once, then write through asynchronously.
//    Session storage (web sessionStorage) is a fresh memory map per cold start.
// 2. configureCore({ storage, session, fetch, now, random, proxyBase, oauthRedirect }).
//    Supabase URL/key and proxy are only passed when set at build time, so the web's
//    storage overrides (void_supabase_url / void_supabase_key / void_proxy) still win.
// 3. moderation.loadModeration(), the auth session bridge (coreBridge.ensureCore), initAuth().
// 4. First launch (void_signed_in never written): continueAnonymously() in the background.
// 5. AppState-driven timers: BIO.decay 5s; BIO.save + persistSeen 15s and on
//    background; moderation.syncModeration 30s.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { mark } from '../core/slow';
import Constants from 'expo-constants';
import { AppState, type AppStateStatus } from 'react-native';
import { configureCore, createMemoryStorage, initAuth, moderation, BIO, persistSeen, SIGNED_IN_KEY, type KVStorage } from '../core/index.ts';
import { ensureCore } from '../features/auth/coreBridge';
import { continueAnonymously } from '../features/auth/authActions';
import { AUTH_REDIRECT_URL } from '../nav/routes';
import { fetchWithDeadline } from './net';

let booted: Promise<void> | null = null;
let storageRef: KVStorage | null = null;

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');

// THE WHOLE STORE, READ BEFORE ANYTHING CAN DRAW - SO SAY HOW LONG IT TOOK.
//
// Nothing renders until bootCore resolves (_layout returns a blank view until
// `ready`), and the first thing bootCore awaits is this: every key in
// AsyncStorage, in one multiGet. On Android that storage is one serial
// executor, so every getItem anyone issues meanwhile - the globe tab's mode,
// which it will not mount without - queues behind it as well.
//
// Two cold launches today showed the wall and the globe texture waking at
// +70s and +74s, with nothing else to explain the gap. If this read is the
// gap, the line below says so with the number, the key count, the size, and
// the five keys that account for it.
async function hydrate(): Promise<Record<string, string>> {
  const t0 = Date.now();
  mark('boot:hydrate');
  let n = 0;
  let chars = 0;
  const big: Array<[string, number]> = [];
  try {
    const keys = await AsyncStorage.getAllKeys();
    if (!keys.length) return {};
    const pairs = await AsyncStorage.multiGet(keys);
    const out: Record<string, string> = {};
    for (const [k, v] of pairs) {
      if (v == null) continue;
      out[k] = v;
      n++;
      chars += v.length;
      big.push([k, v.length]);
    }
    return out;
  } catch {
    return {};
  } finally {
    try {
      big.sort((a, b) => b[1] - a[1]);
      const top = big.slice(0, 5).map(([k, l]) => k + '=' + l).join(' ');
      console.warn('[boot] hydrate ' + (Date.now() - t0) + 'ms · ' + n + ' keys · ' + chars + ' chars · biggest: ' + top);
    } catch {}
    mark('idle');
  }
}

/** Write-through queue: coalesces rapid writes of the same key. */
const pending = new Map<string, string | null>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function queueWrite(k: string, v: string | null) {
  pending.set(k, v);
  if (!flushTimer) flushTimer = setTimeout(flushWrites, 250);
}
export async function flushWrites(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!pending.size) return;
  const batch = [...pending.entries()];
  pending.clear();
  const sets = batch.filter(([, v]) => v != null) as [string, string][];
  const dels = batch.filter(([, v]) => v == null).map(([k]) => k);
  try {
    if (sets.length) await AsyncStorage.multiSet(sets);
    if (dels.length) await AsyncStorage.multiRemove(dels);
  } catch {}
}

function startTimers() {
  let decay: ReturnType<typeof setInterval> | null = null;
  let save: ReturnType<typeof setInterval> | null = null;
  let mod: ReturnType<typeof setInterval> | null = null;
  const persist = () => {
    try {
      BIO.save();
      persistSeen();
    } catch {}
    flushWrites();
  };
  const start = () => {
    if (decay) return;
    decay = setInterval(() => {
      try {
        BIO.decay();
      } catch {}
    }, 5000);
    save = setInterval(persist, 15000);
    mod = setInterval(() => {
      moderation.syncModeration().catch(() => {});
    }, 30000);
  };
  const stop = () => {
    if (decay) clearInterval(decay);
    if (save) clearInterval(save);
    if (mod) clearInterval(mod);
    decay = save = mod = null;
  };
  const onChange = (s: AppStateStatus) => {
    if (s === 'active') start();
    else {
      stop();
      persist();
    }
  };
  if (AppState.currentState === 'active' || AppState.currentState == null) start();
  AppState.addEventListener('change', onChange);
}

export function bootCore(): Promise<void> {
  if (booted) return booted;
  booted = (async () => {
    const bootT0 = Date.now();
    const initial = await hydrate();
    const storage = createMemoryStorage({ initial, onWrite: queueWrite });
    storageRef = storage;
    const url = str(extra.supabaseUrl);
    const key = str(extra.supabaseAnonKey);
    const proxy = str(extra.voidProxyBase).replace(/\/$/, '');
    configureCore({
      storage,
      session: createMemoryStorage(),
      // Every core request (proxy, Bluesky, Reddit, PeerTube, Supabase REST, uploads)
      // gets a deadline: a stalled connection must never hold a surface's lock for the
      // rest of the session. See lib/net.ts.
      fetch: (u, i) => fetchWithDeadline(u, i),
      now: () => Date.now(),
      random: () => Math.random(),
      oauthRedirect: AUTH_REDIRECT_URL,
      log: __DEV__ ? (...a: any[]) => console.log(...a) : () => {},
      ...(url ? { supabaseUrl: url } : null),
      ...(key ? { supabaseAnonKey: key } : null),
      ...(proxy ? { proxyBase: proxy } : null),
    });
    // Tell the auth bridge the core is configured; it then only installs the
    // core <-> supabase-js session bridge (supabase-js is the single refresher).
    (globalThis as any).__VOID_CORE_CONFIGURED__ = true;
    try {
      moderation.loadModeration();
    } catch {}
    // Never hold the splash on the network (getSession may refresh an expired token).
    await Promise.race([ensureCore().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    initAuth(); // loads void_sb_session; its refresh() is bridged to supabase-js
    // Anonymous-first: a brand-new install gets a real anonymous account (DB-valid
    // void_xxxxxx handle) in the background, without a gate.
    if (storage.getItem(SIGNED_IN_KEY) == null) {
      continueAnonymously().catch(() => {});
    }
    startTimers();
    try {
      console.warn('[boot] core ready ' + (Date.now() - bootT0) + 'ms after bootCore()');
    } catch {}
  })();
  return booted;
}

/** The hydrated synchronous storage (null before bootCore resolves). */
export function coreStorage(): KVStorage | null {
  return storageRef;
}
