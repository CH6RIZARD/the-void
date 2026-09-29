// Name the thing that blocked the JS thread.
//
// Tab switches on the test phone are mostly 250-900 ms with occasional 3-11 s stalls.
// A stall means one long synchronous block on the thread everything else waits on, and
// guessing which one has cost several build cycles. These wrappers report any block
// over SLOW_MS with its own name, so the device says it outright.
//
// console.warn, not log: release builds strip console.log and keep warn.
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
