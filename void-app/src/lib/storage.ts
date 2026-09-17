// Thin AsyncStorage wrapper. Keys mirror the web app's localStorage keys so the
// native port keeps the same names (void_theme, void_user, void_signed_in, ...).
import AsyncStorage from '@react-native-async-storage/async-storage';

export const KEYS = {
  theme: 'void_theme',
  themeMatchSystem: 'void_theme_match_system',
  user: 'void_user',
  signedIn: 'void_signed_in',
  supabaseUrl: 'void_supabase_url',
  supabaseKey: 'void_supabase_key',
  proxy: 'void_proxy',
} as const;

/** Keys a "delete account / sign out wipe" must keep (web DA_KEEP_KEYS). */
export const DEVICE_KEYS: string[] = [KEYS.theme, KEYS.themeMatchSystem, KEYS.supabaseUrl, KEYS.supabaseKey, KEYS.proxy];

export async function getString(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setString(key: string, value: string | null): Promise<void> {
  try {
    if (value == null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, value);
  } catch {}
}

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await getString(key);
  if (raw == null) return fallback;
  try {
    const v = JSON.parse(raw);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export async function setJSON(key: string, value: unknown): Promise<void> {
  await setString(key, JSON.stringify(value));
}

export async function remove(key: string): Promise<void> {
  await setString(key, null);
}

/** Wipe everything except device configuration (theme, backend overrides, proxy). */
export async function clearUserData(): Promise<void> {
  try {
    const all = await AsyncStorage.getAllKeys();
    const drop = all.filter((k) => !DEVICE_KEYS.includes(k));
    if (drop.length) await AsyncStorage.multiRemove(drop);
  } catch {}
}

export { AsyncStorage };
