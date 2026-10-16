// expo-void-media: Android-only warm-ups expo-video does not expose. Every call is a
// no-op where the module is absent (iOS, web, a build without it).
import { requireOptionalNativeModule } from 'expo';

const native = requireOptionalNativeModule<{
  prefetchHead(uri: string, bytes: number): Promise<number>;
  cancelPrefetch(uri: string): void;
  warmCodecs(mimes: string[]): Promise<void>;
}>('ExpoVoidMedia');

/** Report A.4 #5: heads of 300-800 KB for N+2..N+5. Resolves to the bytes now cached. */
export function prefetchHead(uri: string, bytes = 800 * 1024): Promise<number> {
  if (!native) return Promise.resolve(0);
  return native.prefetchHead(uri, bytes).catch(() => 0);
}
export function cancelPrefetch(uri: string): void {
  try {
    native?.cancelPrefetch(uri);
  } catch {}
}
/** Report A.4 #6: warm the decoder list (and one real decoder) at boot. */
export function warmCodecs(mimes = ['video/avc', 'video/hevc']): Promise<void> {
  if (!native) return Promise.resolve();
  return native.warmCodecs(mimes).catch(() => {});
}
