// How long a tab switch actually took, measured where it happens.
//
// Tab switching reads as "catastrophically slow" on the test phone, and timing it
// from outside with adb cannot separate the app from the ~1.1 s that `input tap`
// itself costs. This records the press, and each screen reports how long it was
// before it had focus. console.warn, not log: release builds strip console.log.
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { holdCreates } from '../features/live/pacedPlayer';

const SLOW_MS = 250;
// How long the switch owns the JS thread before ExoPlayer builds may land on it.
// Measured 10-08 (void->globe, S22): the globe's tiles enqueue builds on the next
// tick after focus and a synchronous createVideoPlayer stalled the thread 637ms
// mid-switch. Self-expiring, nothing dropped: the wall fills the same, 700ms later.
const HOLD_BUILDS_MS = 700;

/** Called by the nav pill the moment a tab is pressed. */
export function noteTabPress(): void {
  (globalThis as any).__voidTabPressAt = Date.now();
  holdCreates(HOLD_BUILDS_MS);
}

/** In a tab screen: report how long after the press this screen got focus. */
export function useSwitchTiming(label: string): void {
  useFocusEffect(
    useCallback(() => {
      const g = globalThis as any;
      const at = g.__voidTabPressAt;
      if (!at) return;
      g.__voidTabPressAt = 0;
      const ms = Date.now() - at;
      if (ms >= SLOW_MS) {
        try {
          console.warn('[switch] ' + label + ' ' + ms + 'ms after press');
        } catch {}
      }
    }, [label]),
  );
}
