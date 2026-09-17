// Platform seam for the logic core. The web app reached straight for
// localStorage / sessionStorage / fetch / Date.now / Math.random; every one of
// those goes through here so the same code runs in React Native, in Node tests
// (with a seeded RNG and a frozen clock), and anywhere else.
//
// Storage is SYNCHRONOUS on purpose: the web code reads storage inline during
// ranking and dedupe (localStorage is sync). On native, back it with a sync KV
// (react-native-mmkv) or hydrate an in-memory map from AsyncStorage at boot and
// write through asynchronously — see createMemoryStorage({onWrite}).

export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Optional: enumerate keys (used by wipeLocalAccountData). */
  keys?(): string[];
}

export type FetchLike = (input: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  signal?: any;
  cache?: string;
}) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
}>;

export interface CoreEnv {
  /** Persistent storage (web: localStorage). */
  storage: KVStorage;
  /** Per-session storage (web: sessionStorage) — cleared on each cold start. */
  session: KVStorage;
  fetch: FetchLike;
  now(): number;
  random(): number;
  /** Social proxy origin (web: ?proxy= / localStorage void_proxy). '' = none. */
  proxyBase: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** OAuth return URL (web: location.href without hash). */
  oauthRedirect: string;
  log(...a: any[]): void;
}

export function createMemoryStorage(opts: { initial?: Record<string, string>; onWrite?: (k: string, v: string | null) => void } = {}): KVStorage {
  const m = new Map<string, string>(Object.entries(opts.initial || {}));
  return {
    getItem: k => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => { m.set(k, String(v)); opts.onWrite && opts.onWrite(k, String(v)); },
    removeItem: k => { m.delete(k); opts.onWrite && opts.onWrite(k, null); },
    keys: () => [...m.keys()],
  };
}

export const SUPABASE_URL_DEFAULT = 'https://zsrpsdufwgfyfoulmazt.supabase.co';
// The anon key is public by design — it ships inside every Supabase client — and
// RLS on every table is what actually protects the data.
export const SUPABASE_ANON_KEY_DEFAULT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzcnBzZHVmd2dmeWZvdWxtYXp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MTU3ODEsImV4cCI6MjEwMTE5MTc4MX0.TbMvc7Jz_pNTLxW8CVnQvh_ATRwgfnvJnNC_eXFzJO8';

const g: any = globalThis as any;

export const env: CoreEnv = {
  storage: createMemoryStorage(),
  session: createMemoryStorage(),
  fetch: (u, i) => g.fetch(u, i),
  now: () => Date.now(),
  random: () => Math.random(),
  proxyBase: '',
  supabaseUrl: SUPABASE_URL_DEFAULT,
  supabaseAnonKey: SUPABASE_ANON_KEY_DEFAULT,
  oauthRedirect: 'thevoid://auth-callback',
  log: () => {},
};

type ResetHook = () => void;
const _hooks: ResetHook[] = [];
/** Modules with storage-backed state register a reload hook here. */
export function onConfigure(fn: ResetHook): void { _hooks.push(fn); }

/**
 * Wire the platform in. Call once at app boot, BEFORE any feed/rank call.
 * Storage-backed state (seen sets, BIO, cursors, muted terms, session) reloads
 * from the new storage. Like the web, `void_supabase_url` / `void_supabase_key` /
 * `void_proxy` in storage override the defaults.
 */
export function configureCore(partial: Partial<CoreEnv>): CoreEnv {
  Object.assign(env, partial);
  try {
    const u = env.storage.getItem('void_supabase_url'); if (u && !partial.supabaseUrl) env.supabaseUrl = u;
    const k = env.storage.getItem('void_supabase_key'); if (k && !partial.supabaseAnonKey) env.supabaseAnonKey = k;
    const p = env.storage.getItem('void_proxy'); if (p && partial.proxyBase === undefined) env.proxyBase = p;
  } catch { /* storage unavailable: defaults stand */ }
  for (const h of _hooks) { try { h(); } catch (e) { env.log('[core] reload hook failed', e); } }
  return env;
}

/** Promise-based sleep that respects nothing but real time (GDELT gate etc.). */
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
