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
import { env } from '../env.ts';
import { iptvPool, poolCount, setLiveIptv } from '../data/sources.ts';

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
// THE FIRST FILL USED TO BE BLIND. The map started empty on every launch and the
// fetch is fire-and-forget, so the cold-launch wallSlots() ordered sources with no
// health at all: every dead stream in the lead burned a 5.5s lane and the grid took
// 6-7s to fill (iPhone, 2026-10-16) when the user wants 2-3. The last fetched map is
// kept in storage and read back synchronously before the first build, like the pool.
const HEALTH_KEY = 'void_stream_health_v1';
let healthLoaded = false;
function loadKeptHealth(): void {
  if (healthLoaded) return;
  healthLoaded = true;
  try {
    const kept = env.storage.getItem(HEALTH_KEY);
    if (kept) {
      const d = JSON.parse(kept);
      if (d && d.h && typeof d.h === 'object') map = d.h;
    }
  } catch {}
}

// THE STREAM LIST ITSELF, LIVE. It used to exist only as iptv.generated.ts inside each
// release, so a fix or a new stream needed a rebuild, and on 2026-10-14 an empty list made
// on an offline PC shipped and every wall tile read NO SIGNAL. Now the proxy serves the
// current list (GET /streams/pool), each launch fetches it, and the last good copy is kept.
// A list under half of the one in force is refused: an outage upstream must not blank
// everyone's wall.
const POOL_KEY = 'void_iptv_pool_v1';
let poolTried = false;
/** Take a pool from the network or storage; returns whether it was accepted. */
export function acceptPool(sources: unknown): boolean {
  if (!sources || typeof sources !== 'object') return false;
  const pool = sources as Record<string, StreamSource[]>;
  const n = poolCount(pool);
  if (!n || n < poolCount(iptvPool()) * 0.5) return false;
  setLiveIptv(pool);
  return true;
}
function ensurePool(base: string): void {
  if (poolTried) return;
  poolTried = true;
  try {
    const kept = env.storage.getItem(POOL_KEY);
    if (kept) acceptPool(JSON.parse(kept).sources);
  } catch {}
  fetch(base + '/streams/pool')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d && acceptPool(d.sources)) {
        try { env.storage.setItem(POOL_KEY, JSON.stringify({ generated: d.generated, sources: d.sources })); } catch {}
      }
    })
    .catch(() => {});
}

export function ensureHealth(): void {
  loadKeptHealth();
  const base = proxyBase();
  if (base) ensurePool(base);
  if (!base || inflight || Date.now() - fetchedAt < 10 * 60_000) return;
  inflight = true;
  fetch(base + '/streams/health')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d && d.h) {
        map = d.h;
        fetchedAt = Date.now();
        try { env.storage.setItem(HEALTH_KEY, JSON.stringify({ h: d.h })); } catch {}
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
