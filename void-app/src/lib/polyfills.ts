// Runtime guards for APIs the logic core relies on (imported first in app/_layout.tsx).
// Hermes on RN 0.86 ships String.prototype.normalize and RegExp Unicode property
// escapes (\p{L}); these guards only matter on an engine that lacks them.
/* eslint-disable no-extend-native */
if (typeof (String.prototype as any).normalize !== 'function') {
  (String.prototype as any).normalize = function normalize(this: string) {
    return String(this);
  };
}

let unicodeProps = true;
try {
  // eslint-disable-next-line no-new
  new RegExp('\p{L}', 'u');
} catch {
  unicodeProps = false;
}
if (!unicodeProps && __DEV__) console.warn('[polyfills] RegExp Unicode property escapes unsupported on this engine');

export const RUNTIME_SUPPORT = { normalize: typeof ''.normalize === 'function', unicodeProps };
