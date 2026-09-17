// Runtime configuration. Defaults mirror void2-final.html; app.config extra
// (VOID_SUPABASE_URL / VOID_SUPABASE_ANON_KEY / VOID_PROXY_BASE at build time) overrides.
import Constants from 'expo-constants';

/** void2-final.html SUPABASE_URL_DEFAULT — project "the void" (not a secret). */
export const SUPABASE_URL_DEFAULT = 'https://zsrpsdufwgfyfoulmazt.supabase.co';
/** void2-final.html SUPABASE_ANON_KEY_DEFAULT — public anon key; RLS protects the data. */
export const SUPABASE_ANON_KEY_DEFAULT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzcnBzZHVmd2dmeWZvdWxtYXp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MTU3ODEsImV4cCI6MjEwMTE5MTc4MX0.TbMvc7Jz_pNTLxW8CVnQvh_ATRwgfnvJnNC_eXFzJO8';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');

export const SUPABASE_URL = str(extra.supabaseUrl) || SUPABASE_URL_DEFAULT;
export const SUPABASE_ANON_KEY = str(extra.supabaseAnonKey) || SUPABASE_ANON_KEY_DEFAULT;
/** Feed/social proxy base (web VOID_PROXY_BASE); '' when not configured. */
export const VOID_PROXY_BASE = str(extra.voidProxyBase).replace(/\/$/, '');
