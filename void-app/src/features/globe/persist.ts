// localStorage('void_globe_mode') / localStorage('v_grid3') → AsyncStorage.
// Requires @react-native-async-storage/async-storage (Agent A's dependency list).
import AsyncStorage from '@react-native-async-storage/async-storage';

export type GlobeMode = 'reels' | 'globe';
export const GLOBE_MODE_KEY = 'void_globe_mode';
export const GRID3_KEY = 'v_grid3';

let modeCache: GlobeMode | null = null;

export async function loadGlobeMode(): Promise<GlobeMode> {
  if (modeCache) return modeCache;
  try {
    const v = await AsyncStorage.getItem(GLOBE_MODE_KEY);
    modeCache = v === 'reels' ? 'reels' : 'globe'; // GLOBE is the default: the tab opens on the globe
  } catch {
    modeCache = 'globe';
  }
  return modeCache;
}
export function cachedGlobeMode(): GlobeMode | null {
  return modeCache;
}
export function saveGlobeMode(m: GlobeMode) {
  modeCache = m;
  AsyncStorage.setItem(GLOBE_MODE_KEY, m).catch(() => {});
}
export async function loadGrid3(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(GRID3_KEY);
    return v === 'true' || v === '1';
  } catch {
    return false;
  }
}
