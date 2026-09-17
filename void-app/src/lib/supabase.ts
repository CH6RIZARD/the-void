// supabase-js client for React Native.
//
// ONE session, ONE refresher (see src/features/auth/coreBridge.ts):
//   - this client persists the session in AsyncStorage and is the ONLY token refresher
//     (autoRefreshToken, only while the app is foreground);
//   - the logic core's VoidAuth.refresh is re-pointed at this client by the bridge,
//     and every auth event here is mirrored into VoidAuth.save(), so core REST calls
//     always carry the current access token.
// Never create a second GoTrue client: two refreshers rotating one refresh token trip
// GoTrue's reuse detection and revoke the session.
import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import { createClient, type Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'implicit', // GoTrue returns #access_token (core sessionFromOAuthRedirect parses it)
  },
});

export const isSupabaseConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
/** Alias kept for callers that prefer a getter. */
export const getSupabase = () => supabase;

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
  if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();
}

export async function getSession(): Promise<Session | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session ?? null;
  } catch {
    return null;
  }
}

export type { Session };
