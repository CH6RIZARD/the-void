// Web SETTINGS = { lang: v_lang, autoplay: v_autoplay, notify: v_notify, grid3 }, persisted in
// AsyncStorage under the same keys. Other features read them:
//   const { autoplay, lang, grid3 } = usePrefs();
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Prefs { lang: string; autoplay: boolean; notify: boolean; grid3: boolean }
export const PREF_KEYS = { lang: 'v_lang', autoplay: 'v_autoplay', notify: 'v_notify', grid3: 'v_grid3' } as const;

export const LANGUAGES: Array<[string, string]> = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['ar', 'Arabic'], ['zh-CN', 'Chinese'], ['ru', 'Russian'],
  ['pt', 'Portuguese'], ['de', 'German'], ['ja', 'Japanese'], ['hi', 'Hindi'], ['tr', 'Turkish'], ['ko', 'Korean'],
];

// grid3 default false: the official mobile build ships the 2-wide grid (web VOID_GRID=2).
let prefs: Prefs = { lang: 'en', autoplay: true, notify: true, grid3: false };
const subs = new Set<() => void>();
let loaded = false;

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const [[, l], [, a], [, n], [, g]] = await AsyncStorage.multiGet([PREF_KEYS.lang, PREF_KEYS.autoplay, PREF_KEYS.notify, PREF_KEYS.grid3]);
    prefs = { lang: l || 'en', autoplay: a !== 'false', notify: n !== 'false', grid3: g === 'true' };
    subs.forEach((s) => s());
  } catch {}
}
load();

export function getPrefs(): Prefs {
  return prefs;
}
export function setPrefs(patch: Partial<Prefs>): void {
  prefs = { ...prefs, ...patch };
  (Object.keys(patch) as (keyof Prefs)[]).forEach((k) => {
    AsyncStorage.setItem(PREF_KEYS[k], String(prefs[k])).catch(() => {});
  });
  subs.forEach((s) => s());
}
export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => prefs,
    () => prefs,
  );
}
