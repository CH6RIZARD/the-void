// THE POOL'S VITAL SIGNS, SHARED BY EVERY CLIENT.
//
// The proxy aggregates what actually happened when anyone - web or native -
// tried a stream: ok rate, proxy-needed share, report count, median connect ms
// (GET /streams/health -> {h:{url:[okPct,viaPct,reports,medMs]}}; the web has
// reported into it since 2026-10-02 and it was seeded with a full sweep of all
// 2,611 urls). The native wall was blind to all of it: it drew from static
// generated tables, so dead streams burned a 5.5s lane timeout apiece and the
// user watched 3/8 tiles after two minutes - on a phone whose browser plays
// the same pool beautifully.
//
// The fetch is fire-and-forget and the map starts empty, so the first
// wallSlots() of a cold launch runs exactly as before and later builds (heals,
// refreshes, next launch) get the knowledge. Nothing here can block or fail a
// wall build.
import type { StreamSource } from '../types.ts';

// Lazy require, not import: lib/config pulls expo-constants (react-native),
// and this module must stay runnable under plain node - the golden parity
// tests load it through wall.ts. The base only matters when ensureHealth
// actually fetches, which a test never does.
function proxyBase(): string {
  try {
    return (require('../../lib/config') as { VOID_PROXY_BASE: string }).VOID_PROXY_BASE || '';
  } catch {
    return '';
  }
}

type H = [number, number, number, number]; // [okPct, viaPct, reports, medMs]
let map: Record<string, H> = {};
let fetchedAt = 0;
let inflight = false;

export function ensureHealth(): void {
  const base = proxyBase();
  if (!base || inflight || Date.now() - fetchedAt < 10 * 60_000) return;
  inflight = true;
  fetch(base + '/streams/health')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d && d.h) {
        map = d.h;
        fetchedAt = Date.now();
      }
    })
    .catch(() => {})
    .finally(() => {
      inflight = false;
    });
}

function of(s: StreamSource | null | undefined): H | null {
  const u = s && (s as any).url;
  return (u && map[u]) || null;
}

/** Dead for everyone: enough reports, none of them good. */
export function healthDead(s: StreamSource): boolean {
  const h = of(s);
  return !!(h && h[0] === 0 && h[2] >= 3);
}

/** Population median connect speed, bucketed to 400ms; unknown streams sort
 *  behind proven-fast ones but ahead of nothing - the shuffle still decides
 *  inside each bucket, so the wall stays varied while it leads with what
 *  connects near-instantly for everyone. */
export function healthMsBucket(s: StreamSource): number {
  const h = of(s);
  return h && h[0] > 0 ? Math.round((h[3] || 2000) / 400) : 9;
}

/** Proven flaky for everyone: enough reports, under half of them good. A
 *  cheap-but-unreliable stream in the lead costs a cascade advance per visit,
 *  so reliability outranks cost in wallSlots. Ordering signal only, never a
 *  filter - and the map is empty on a cold launch, so first fill is unchanged. */
export function healthFlaky(s: StreamSource): boolean {
  const h = of(s);
  return !!(h && h[2] >= 3 && h[0] < 50);
}
