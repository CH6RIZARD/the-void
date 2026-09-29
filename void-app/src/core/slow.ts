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

// ─── IS THE JS THREAD BLOCKED, OR IS IT THE VIEWS? ───────────────────────
// The wrappers above reported NOTHING while tab switches still took up to 4 s, so the
// cost is not in our data work. This tells the two remaining suspects apart: a timer
// that should tick every HEARTBEAT_MS. If it comes back late, the JS thread was busy
// (rendering, reconciliation); if it stays on time while the screen still takes
// seconds, the work is on the native side (view creation, layout, images) and no JS
// fix will touch it.
const HEARTBEAT_MS = 100;
const LATE_MS = 300;
export function startHeartbeat(): () => void {
  let last = Date.now();
  const id = setInterval(() => {
    const now = Date.now();
    const late = now - last - HEARTBEAT_MS;
    last = now;
    if (late >= LATE_MS) {
      try {
        console.warn('[block] js thread stalled ' + late + 'ms');
      } catch {
        /* */
      }
    }
  }, HEARTBEAT_MS);
  return () => clearInterval(id);
}
