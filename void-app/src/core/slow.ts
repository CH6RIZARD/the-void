// Name the thing that blocked the JS thread.
//
// Tab switches on the test phone are mostly 250-900 ms with occasional 3-11 s stalls.
// A stall means one long synchronous block on the thread everything else waits on, and
// guessing which one has cost several build cycles. These wrappers report any block
// over SLOW_MS with its own name, so the device says it outright.
//
// console.warn, not log: release builds strip console.log and keep warn.
import { AppState } from 'react-native';

const SLOW_MS = 250;

/** Run fn, and say so if it took long enough to be felt. */
export function timed<T>(label: string, fn: () => T): T {
  const t0 = Date.now();
  try {
    return fn();
  } finally {
    const ms = Date.now() - t0;
    if (ms >= SLOW_MS) {
      try {
        console.warn('[slow] ' + label + ' ' + ms + 'ms');
      } catch {
        /* */
      }
    }
  }
}

/** Same, for work that awaits. Reports total wall time, network included. */
export async function timedAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - t0;
    if (ms >= SLOW_MS) {
      try {
        console.warn('[slow] ' + label + ' ' + ms + 'ms');
      } catch {
        /* */
      }
    }
  }
}

// ─── IS THE JS THREAD BLOCKED, OR IS IT THE VIEWS? ───────────────────────
// The wrappers above reported NOTHING while tab switches still took up to 4 s, so the
// cost is not in our data work. This tells the two remaining suspects apart: a timer
// that should tick every HEARTBEAT_MS. If it comes back late, the JS thread was busy
// (rendering, reconciliation); if it stays on time while the screen still takes
// seconds, the work is on the native side (view creation, layout, images) and no JS
// fix will touch it.
/**
 * WHAT WAS RUNNING WHEN IT STALLED.
 *
 * The heartbeat proves the JS thread was blocked but says nothing about by
 * what, so every stall has been diagnosed by reading code and guessing - which
 * cost most of a day and several wrong answers. Heavy operations leave a
 * breadcrumb; the stall report names the last one and how long ago it started.
 *
 * Deliberately a single module-level string: no allocation, no stack capture,
 * nothing that could itself become the stall.
 */
let lastMark = 'idle';
let lastMarkAt = 0;
export function mark(label: string): void {
  lastMark = label;
  lastMarkAt = Date.now();
}

const HEARTBEAT_MS = 100;
const LATE_MS = 300;

/**
 * A BACKGROUNDED APP IS NOT A STALLED ONE.
 *
 * Android suspends JS timers when the app loses the foreground, so the first tick
 * after coming back finds the whole absence sitting in now - last and reports it
 * as one block. The phone is the user's daily driver, so this happens constantly:
 * today it produced `js thread stalled 19599ms`, with the breadcrumb honestly
 * admitting it was 51 seconds stale - twenty seconds of nothing, in the signal
 * that is meant to be the most trustworthy one in the app, naming no cause
 * because there was no cause.
 *
 * That is worse than no signal. Three measurements today already had to be
 * thrown away for the same reason - a wall scored 6/6 against the launcher
 * wallpaper, a globe scored NOT DRAWN after being scrolled off screen - and each
 * one cost a round of chasing something that was not there.
 *
 * So the heartbeat only measures while the app is active, and crossing a
 * background boundary rearms it instead of reporting it. A real stall while the
 * user is actually looking at the app is unaffected, which is the only kind worth
 * knowing about.
 */
let appActive = AppState.currentState === 'active';
let rearm = false;
AppState.addEventListener('change', (st) => {
  const now = st === 'active';
  if (now && !appActive) rearm = true; // skip the gap we were asleep for
  appActive = now;
});

export function startHeartbeat(): () => void {
  let last = Date.now();
  const id = setInterval(() => {
    const now = Date.now();
    const late = now - last - HEARTBEAT_MS;
    last = now;
    // Not active, or the first tick back: there is nothing here to measure.
    if (!appActive || rearm) {
      rearm = false;
      return;
    }
    if (late >= LATE_MS) {
      try {
        console.warn('[block] js thread stalled ' + late + 'ms · last: ' + lastMark + ' (' + (lastMarkAt ? now - lastMarkAt : -1) + 'ms ago)');
      } catch {
        /* */
      }
    }
  }, HEARTBEAT_MS);
  return () => clearInterval(id);
}
