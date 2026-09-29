// LIVE FEEDS WALL — native port of #globe-live-grid / #gl-grid.
//
// web → native:
//   buildGlobeGrid()   → mount effect (slots = wallSlots(), initial fill = wallFillCount())
//   loadWallBatch()    → loadBatch(): boxes placed first (sliced 6/frame), then connected
//                        through WALL_LANES lanes; one batch in flight at a time
//   #gl-sentinel + IO  → onScroll: bottom of grid within 400px of the viewport
//   CSS `order`        → connOrder: connected tiles rise to the top (absolute layout, so a
//                        reorder only moves a tile — it never remounts or rebuffers)
//   wallHealVisible()  → watchdog: dead tiles within ±40px heal (WALL_HEAL_MAX, cooldown)
//   watchdog nudge     → tiles within ±200px not PLAYING get nudged every 2.5s
//   visibilitychange   → AppState 'active': force-nudge at 0/400/1200/2800ms, heal at 900
//
// NOT virtualized on purpose: a FlatList recycles/unmounts rows, which is exactly the
// "tiles remount and rebuffer on scroll" bug. A manual absolute grid keeps every tile
// mounted; the only exception is the documented far-offscreen memory guard.
import React, { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import { AppState, Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { LiveDot, TileLabel, TileLoader } from './TileChrome';
import { StreamTile, type StreamTileHandle } from './StreamTile';
import { useStreamCascade, type CascadeResult } from './useStreamCascade';
import { liveVidFor, rememberStream, wallCascadeFor, wallSlots, streamKey, type StreamSource, type StreamType, type WallSlot } from './core';
import {
  EVICT_MARGIN_SCREENS,
  EVICT_SCREENS,
  FIRST_BATCH_DELAY_MS,
  playerBudgetNow,
  MAX_MOUNTED_WEBVIEWS,
  PARK_SCREENS,
  SLEEP_AFTER_MS,
  WALL_BATCH,
  WALL_HEAL_COOLDOWN,
  WALL_HEAL_MAX,
  WALL_LANES,
  WATCHDOG_MS,
} from './constants';
import { em, useLiveTheme } from './liveTheme';

type Phase = 'queued' | 'connecting' | 'playing' | 'offline' | 'evicted';

interface WallEntry {
  id: number;
  phase: Phase;
  kind?: StreamType;
  needsHeal: boolean;
  healing: boolean;
  healAt: number;
  heal(): Promise<boolean>;
  nudge(force: boolean): void;
}

interface TileRec {
  id: number;
  name: string;
  src: StreamSource;
  batch: number;
}

// ─── connection lanes ────────────────────────────────────────────────────────
class Lanes {
  private busy = 0;
  private q: Array<() => void> = [];
  constructor(private max: number) {}
  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        this.busy++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.busy--;
          const n = this.q.shift();
          if (n) n();
        });
      };
      if (this.busy < this.max) grant();
      else this.q.push(grant);
    });
  }
}

export interface LiveWallProps {
  /** Globe tab focused AND mode === 'globe' AND nothing covering it. */
  active: boolean;
  /** v_grid3 dense layout (3-wide). Mobile build default: 2-wide. */
  grid3?: boolean;
  /** Extra bottom space so the floating nav pill never covers the last row. */
  bottomInset?: number;
}

export interface LiveWallHandle {
  rebuild(): void;
}

const GAP = 6;
const PAD = 10;

export const LiveWall = forwardRef<LiveWallHandle, LiveWallProps>(function LiveWall({ active, grid3 = false, bottomInset = 0 }, ref) {
  const t = useLiveTheme();
  const win = useWindowDimensions();
  const cols = grid3 ? 3 : 2;
  const [width, setWidth] = useState(win.width);
  const [viewportH, setViewportH] = useState(win.height * 0.5);
  const [gridY, setGridY] = useState(0);
  const [tiles, setTiles] = useState<TileRec[]>([]);
  const [order, setOrder] = useState<Record<number, number>>({});
  const [done, setDone] = useState(false);
  const [gen, setGen] = useState(0);
  const [placement, setPlacement] = useState<{ parked: Set<number>; evicted: Set<number> }>({ parked: new Set(), evicted: new Set() });

  const w = useRef({
    slots: [] as WallSlot[],
    slotIdx: 0,
    wallConn: 0,
    busy: false,
    nextId: 1,
    batchSeq: 0,
    batchPending: new Map<number, number>(),
    registry: new Map<number, WallEntry>(),
    healBusy: 0,
    scrollY: 0,
    lanes: new Lanes(WALL_LANES),
    activeRef: active,
    asleepRef: false,
    gen: 0,
  }).current;
  w.activeRef = active;

  // SLEEP: out of sight for SLEEP_AFTER_MS (REELS mode, another tab, background), the
  // wall lets go of every player - WebViews and decoders unmount through the paced
  // release queue. Tiles, their order and each tile's last good source are kept, so
  // on return only the tiles in view reconnect, last good source first. A quick flip
  // away and back never tears anything down. Parking alone (pauseVideo / pause) left
  // every WebView renderer alive: ~107% CPU in WebView processes with the wall hidden.
  const [asleep, setAsleep] = useState(false);
  w.asleepRef = asleep;
  useEffect(() => {
    if (active) {
      setAsleep(false);
      return;
    }
    const id = setTimeout(() => setAsleep(true), SLEEP_AFTER_MS);
    return () => clearTimeout(id);
  }, [active]);

  const tileW = (width - PAD * 2 - GAP * (cols - 1)) / cols;
  const tileH = (tileW * 9) / 16;
  const rowH = tileH + GAP;

  // Sorted positions: connected by connection order, then the rest in spawn order.
  const positions = useMemo(() => {
    const sorted = [...tiles].sort((a, b) => {
      const oa = order[a.id] ?? 999999 + a.id;
      const ob = order[b.id] ?? 999999 + b.id;
      return oa - ob;
    });
    const pos = new Map<number, { left: number; top: number }>();
    sorted.forEach((r, i) => pos.set(r.id, { left: (i % cols) * (tileW + GAP), top: Math.floor(i / cols) * rowH }));
    return pos;
  }, [tiles, order, cols, tileW, rowH]);
  const gridH = Math.max(0, Math.ceil(tiles.length / cols) * rowH - GAP);
  const posRef = useRef(positions);
  posRef.current = positions;
  const geo = useRef({ gridY, gridH, viewportH, tileH });
  geo.current = { gridY, gridH, viewportH, tileH };

  const sentinelNear = useCallback(() => {
    if (!w.activeRef) return false;
    const g = geo.current;
    return g.gridY + g.gridH <= w.scrollY + g.viewportH + 400;
  }, [w]);

  // web wallFillCount(): a screen-and-a-bit, 12..24 on mobile.
  const fillCount = useCallback(() => {
    const rows = Math.ceil((win.height * 1.25) / Math.max(60, tileH + GAP));
    return Math.max(12, Math.min(24, cols * rows));
  }, [win.height, tileH, cols]);

  const loadBatch = useCallback(
    async (want: number) => {
      if (w.busy) return;
      if (w.slotIdx >= w.slots.length) return;
      w.busy = true;
      const batch = ++w.batchSeq;
      const myGen = w.gen;
      const SLICE = 6;
      let placed = 0;
      // Reserve the whole batch up front so an instant refusal settling during the
      // sliced placement cannot mark the batch finished early.
      const planned = Math.min(want, w.slots.length - w.slotIdx);
      w.batchPending.set(batch, planned);
      while (placed < want && w.slotIdx < w.slots.length) {
        const slice: TileRec[] = [];
        for (let i = 0; i < SLICE && placed < want && w.slotIdx < w.slots.length; i++, placed++) {
          const { name, src } = w.slots[w.slotIdx++];
          slice.push({ id: w.nextId++, name, src, batch });
        }
        setTiles((prev) => prev.concat(slice));
        // Yield a frame between slices so scroll / mode transition stay responsive.
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        if (myGen !== w.gen) return;
      }
      if (planned <= 0) w.busy = false;
    },
    [w],
  );
  const loadBatchRef = useRef(loadBatch);
  loadBatchRef.current = loadBatch;

  const healVisible = useCallback(() => {
    if (!w.activeRef || AppState.currentState !== 'active') return;
    const g = geo.current;
    for (const e of w.registry.values()) {
      if (w.healBusy >= WALL_HEAL_MAX) break;
      const p = posRef.current.get(e.id);
      if (!p) continue;
      const top = g.gridY + p.top - w.scrollY;
      if (top + g.tileH < -40 || top > g.viewportH + 40) continue;
      const dead = e.phase === 'offline' || e.needsHeal;
      if (!dead || e.healing) continue;
      const now = Date.now();
      if (e.healAt && now - e.healAt < WALL_HEAL_COOLDOWN) continue;
      w.healBusy++;
      e.heal().finally(() => {
        w.healBusy = Math.max(0, w.healBusy - 1);
      });
    }
  }, [w]);

  const onFirstSettled = useCallback(
    (rec: TileRec, res: CascadeResult) => {
      if (res.ok) {
        const o = w.wallConn++;
        setOrder((prev) => ({ ...prev, [rec.id]: o })); // connected tiles rise
      }
      const left = (w.batchPending.get(rec.batch) || 1) - 1;
      if (left > 0) {
        w.batchPending.set(rec.batch, left);
        return;
      }
      w.batchPending.delete(rec.batch);
      if (rec.batch !== w.batchSeq) return;
      w.busy = false;
      if (w.slotIdx >= w.slots.length) setDone(true);
      // The sentinel may still be on screen while the wall is short: keep pulling.
      if (w.slotIdx < w.slots.length && sentinelNear()) setTimeout(() => loadBatchRef.current(WALL_BATCH), 0);
      setTimeout(healVisible, 1500);
    },
    [w, sentinelNear, healVisible],
  );

  // buildGlobeGrid(): once, deferred a frame so the mode switch paints first.
  const build = useCallback(() => {
    w.registry.clear();
    w.slots = wallSlots();
    w.slotIdx = 0;
    w.wallConn = 0;
    w.busy = false;
    w.batchPending.clear();
    w.gen++;
    setTiles([]);
    setOrder({});
    setDone(false);
    setGen((g) => g + 1);
  }, [w]);
  const built = useRef(false);
  useEffect(() => {
    if (!active || built.current || width <= 0) return;
    built.current = true;
    build();
  }, [active, width, build]);
  useEffect(() => {
    if (gen === 0) return;
    // Let the globe draw its first frames before the first tiles start connecting.
    const id = setTimeout(() => loadBatchRef.current(fillCount()), FIRST_BATCH_DELAY_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen]);

  useImperativeHandle(ref, () => ({ rebuild: build }), [build]);

  // Watchdog (web setInterval 2500): nudge near tiles that are not PLAYING, then heal.
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      const g = geo.current;
      for (const e of w.registry.values()) {
        const p = posRef.current.get(e.id);
        if (!p || e.phase !== 'playing') continue;
        const top = g.gridY + p.top - w.scrollY;
        if (top + g.tileH < -200 || top > g.viewportH + 200) continue;
        if (e.needsHeal) continue;
        e.nudge(false);
      }
      healVisible();
    }, WATCHDOG_MS);
    return () => clearInterval(iv);
  }, [active, w, healVisible]);

  // Return to the wall: wake everything, re-kick the sentinel (web setGlobeMode else-branch).
  const wakeAll = useCallback(() => {
    for (const e of w.registry.values()) if (e.phase === 'playing') e.nudge(true);
  }, [w]);
  useEffect(() => {
    if (!active || !built.current) return;
    wakeAll();
    if (sentinelNear()) loadBatchRef.current(WALL_BATCH);
    const h = setTimeout(healVisible, 600);
    return () => clearTimeout(h);
  }, [active, wakeAll, sentinelNear, healVisible]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' || !w.activeRef) return;
      const ts = [0, 400, 1200, 2800].map((ms) => setTimeout(wakeAll, ms));
      ts.push(setTimeout(healVisible, 900));
    });
    return () => sub.remove();
  }, [w, wakeAll, healVisible]);

  // Park / evict (native memory guard, see constants.ts).
  const recomputePlacement = useCallback(() => {
    const g = geo.current;
    const vh = Math.max(1, g.viewportH);
    const dist = new Map<number, number>();
    for (const [id, p] of posRef.current) {
      const top = g.gridY + p.top - w.scrollY;
      const d = top > vh ? (top - vh) / vh : top + g.tileH < 0 ? -(top + g.tileH) / vh : 0;
      dist.set(id, d);
    }
    const parked = new Set<number>();
    for (const [id, d] of dist) if (d > PARK_SCREENS || !w.activeRef) parked.add(id);
    const live = [...w.registry.values()].filter((e) => e.phase === 'playing' || e.phase === 'connecting');
    const web = live.filter((e) => e.kind === 'youtube' || e.kind === 'iframe');
    const evicted = new Set<number>(placementRef.current.evicted);
    if (w.asleepRef) {
      // Asleep: every player goes (the tile effect only acts on PLAYING tiles; a tile
      // still connecting is evicted once it connects, via the order change).
      for (const e of w.registry.values()) evicted.add(e.id);
    } else {
      // restore evicted tiles that came back near
      for (const id of [...evicted]) if ((dist.get(id) ?? 0) <= PARK_SCREENS) evicted.delete(id);
    }
    // Two budgets, farthest first. A PAUSED player is not a free player: an off-screen
    // HLS tile still holds its ExoPlayer and decoder, which is how the wall reached
    // 933 MB and got the app killed (test phone, 2026-09-22). So the cap counts EVERY
    // mounted player, not only WebViews, and off-screen tiles (beyond PARK_SCREENS)
    // are the ones let go. Tiles in view always keep playing.
    const evictFarthest = (pool: WallEntry[], max: number, beyond: number) => {
      let over = pool.length - max;
      if (over <= 0) return;
      const far = pool
        .filter((e) => (dist.get(e.id) ?? 0) > beyond && !evicted.has(e.id))
        .sort((a, b) => (dist.get(b.id) ?? 0) - (dist.get(a.id) ?? 0));
      for (const e of far) {
        if (over-- <= 0) break;
        evicted.add(e.id);
      }
    };
    evictFarthest(web, MAX_MOUNTED_WEBVIEWS, EVICT_SCREENS);
    evictFarthest(live, playerBudgetNow(), EVICT_MARGIN_SCREENS);   // shrinks if this device fails decoders
    const same = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((x) => b.has(x));
    if (!same(parked, placementRef.current.parked) || !same(evicted, placementRef.current.evicted)) setPlacement({ parked, evicted });
  }, [w]);
  const placementRef = useRef(placement);
  placementRef.current = placement;
  useEffect(() => {
    recomputePlacement();
  }, [active, asleep, tiles, order, recomputePlacement]);

  const lastPlaceAt = useRef(0);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      w.scrollY = e.nativeEvent.contentOffset.y;
      if (sentinelNear()) loadBatchRef.current(WALL_BATCH);
      const now = Date.now();
      if (now - lastPlaceAt.current > 300) {
        lastPlaceAt.current = now;
        recomputePlacement();
      }
    },
    [w, sentinelNear, recomputePlacement],
  );

  const registry = w.registry;
  const lanes = w.lanes;

  return (
    // A VIDEO SURFACE DOES NOT SLIDE WITH ITS PARENT, BUT IT DOES OBEY GONE.
    // These tiles render into a SurfaceView: a separate Android window layer
    // composited by the system rather than drawn into the app's view hierarchy.
    // That is the point of it, and why it is cheaper than a TextureView. The cost
    // is that it does not inherit its parent's transform - and the globe/reels
    // slide moves the inactive side away with translateX, while every tab screen
    // stays mounted for the session (detachInactiveScreens={false}). So a wall
    // that had slid away, or been tabbed away from, went on punching its video
    // through on top of whatever the user was actually looking at.
    //
    // display:'none' is View.GONE on Android, and a GONE SurfaceView releases its
    // surface and stops compositing. Only the surface goes: the player, its
    // buffers and its socket all survive, so coming back re-attaches a surface and
    // resumes at the live edge instead of reconnecting the stream. Unmounting the
    // tiles would also have stopped the overlay, and would have cost a full
    // reconnect on every return - the surface is the thing that misbehaves, so the
    // surface is the thing to take away.
    <ScrollView
      style={[styles.scroll, active ? null : styles.gone]}
      contentContainerStyle={{ paddingTop: PAD, paddingHorizontal: PAD, paddingBottom: 8 + bottomInset }}
      onLayout={(e: LayoutChangeEvent) => {
        setWidth(e.nativeEvent.layout.width);
        setViewportH(e.nativeEvent.layout.height);
      }}
      onScroll={onScroll}
      onMomentumScrollEnd={recomputePlacement}
      scrollEventThrottle={16}
      overScrollMode="never"
      bounces={false}
      showsVerticalScrollIndicator={false}
      removeClippedSubviews={false}
    >
      {/* .gl-grid-label: red dot + mono label + hairline */}
      <View style={styles.header}>
        <LiveDot />
        <Text style={{ fontFamily: t.mono, fontSize: 8, letterSpacing: em(8, 0.25), color: t.muted }}>LIVE FEEDS</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
      </View>
      <View style={{ height: gridH }} onLayout={(e) => setGridY(e.nativeEvent.layout.y)}>
        {tiles.map((rec) => {
          const p = positions.get(rec.id);
          if (!p) return null;
          return (
            <WallTile
              key={`${gen}:${rec.id}`}
              rec={rec}
              left={p.left}
              top={p.top}
              width={tileW}
              height={tileH}
              borderColor={t.border}
              parked={placement.parked.has(rec.id)}
              evicted={placement.evicted.has(rec.id)}
              registry={registry}
              lanes={lanes}
              onFirstSettled={onFirstSettled}
            />
          );
        })}
      </View>
      {done ? (
        <Text style={{ textAlign: 'center', paddingTop: 24, paddingBottom: 8, fontFamily: t.mono, fontSize: 8, letterSpacing: em(8, 0.2), color: t.muted }}>
          — END OF SIGNAL —
        </Text>
      ) : null}
    </ScrollView>
  );
});

// ─── one wall tile (.gl-tile) ────────────────────────────────────────────────
interface WallTileProps {
  rec: TileRec;
  left: number;
  top: number;
  width: number;
  height: number;
  borderColor: string;
  parked: boolean;
  evicted: boolean;
  registry: Map<number, WallEntry>;
  lanes: Lanes;
  onFirstSettled(rec: TileRec, res: CascadeResult): void;
}

const WallTile = memo(function WallTile({ rec, left, top, width, height, borderColor, parked, evicted, registry, lanes, onFirstSettled }: WallTileProps) {
  const tileId = `wall:${rec.id}`;
  const [phase, setPhase] = useState<Phase>('queued');
  const [label, setLabel] = useState<string | null>(null);
  const player = useRef<StreamTileHandle>(null);
  const s = useRef({
    first: true,
    lastSrc: rec.src as StreamSource,
    laneRelease: null as null | (() => void),
    healResolve: null as null | ((ok: boolean) => void),
    alive: true,
  }).current;

  const entry = useRef<WallEntry>({
    id: rec.id,
    phase: 'queued',
    kind: rec.src.type,
    needsHeal: false,
    healing: false,
    healAt: 0,
    heal: async () => false,
    nudge: () => {},
  }).current;
  const setPhaseBoth = (p: Phase) => {
    entry.phase = p;
    setPhase(p);
  };

  const onResult = useCallback((res: CascadeResult) => {
    if (!s.alive) return;
    if (res.ok && res.src) {
      s.lastSrc = res.src;
      entry.kind = res.src.type;
      entry.needsHeal = false;
      setPhaseBoth('playing');
      // Country only: stream titles (channel names, video titles) read as noise on a wall.
      setLabel(rec.name.toUpperCase());
      rememberStream(res.src); // so the next launch varies
    } else {
      // Never remove the box — the wall stays full; the healer retries it in view.
      setPhaseBoth('offline');
      setLabel(null);
    }
    if (s.laneRelease) {
      s.laneRelease();
      s.laneRelease = null;
    }
    if (s.first) {
      s.first = false;
      onFirstSettled(rec, res);
    }
    if (s.healResolve) {
      const r = s.healResolve;
      s.healResolve = null;
      r(res.ok);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cascade = useStreamCascade(onResult);

  // connectWallCell(): on heal, try a different source first — the previous one just died.
  const connect = useCallback(
    (rotate: boolean) => {
      let chain = wallCascadeFor(rec.name, s.lastSrc) || [];
      if (rotate && s.lastSrc && chain.length > 1) {
        const k = streamKey(s.lastSrc);
        chain = chain.filter((x) => streamKey(x) !== k).concat(chain.filter((x) => streamKey(x) === k));
      }
      entry.needsHeal = false;
      setPhaseBoth('connecting');
      setLabel(null);
      cascade.start(chain);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cascade.start],
  );

  useEffect(() => {
    s.alive = true;
    registry.set(rec.id, entry);
    let cancelled = false;
    lanes.acquire().then((release) => {
      if (cancelled) {
        release();
        return;
      }
      s.laneRelease = release;
      connect(false);
    });
    entry.nudge = (force) => player.current?.nudge(force);
    entry.heal = () => {
      if (entry.healing) return Promise.resolve(false);
      entry.healing = true;
      entry.healAt = Date.now();
      cascade.cancel(); // disposeCell
      return new Promise<boolean>((resolve) => {
        s.healResolve = (ok) => {
          entry.healing = false;
          resolve(ok);
        };
        connect(true);
      });
    };
    return () => {
      cancelled = true;
      s.alive = false;
      registry.delete(rec.id);
      if (s.laneRelease) s.laneRelease();
      s.laneRelease = null;
      if (s.healResolve) s.healResolve(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Memory guard: far-away YouTube/iframe tiles unmount, and reconnect (same source
  // first) once they come back within PARK_SCREENS.
  useEffect(() => {
    if (evicted && phase === 'playing') {
      cascade.cancel();
      setPhaseBoth('evicted');
    } else if (!evicted && phase === 'evicted') {
      connect(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evicted, phase]);

  const a = cascade.attempt;
  const loaderLabel = phase === 'offline' ? '● NO SIGNAL' : a ? a.label : '● CONNECTING';
  // POSTER FIRST: a YouTube tile shows the stream's thumbnail at once, under the loader,
  // while its player connects - and again whenever it sleeps or is evicted - instead of
  // a black box. The live picture replaces it the moment it plays.
  const posterSrc = a ? a.src : s.lastSrc;
  const vid = phase !== 'playing' && phase !== 'offline' && posterSrc?.type === 'youtube' ? liveVidFor(posterSrc) : null;
  const poster = vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : null;

  return (
    <Pressable
      onPress={() => {
        player.current?.tap();
      }}
      style={({ pressed }) => [styles.tile, { left, top, width, height, borderColor, opacity: pressed ? 0.72 : 1 }]}
    >
      {/* Only for a tile someone can actually see. Each of these is a decoded
          bitmap, and on Android a hardware bitmap is itself a file descriptor -
          so a wall that has been scrolled through holds one per tile it passed,
          for the whole session, having never unmounted. parked covers the whole
          wall the moment the globe tab loses focus, which is where most of them
          were accumulating. */}
      {poster && !parked && !evicted ? (
        <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={0} recyclingKey={poster} />
      ) : null}
      {/* Kept mounted even when the wall is off screen - see the display:'none'
          on the ScrollView. Unmounting here would destroy the player and force
          the whole stream to reconnect on every return to the tab. */}
      {a ? (
        <StreamTile
          key={a.key}
          ref={player}
          tileId={tileId}
          source={a.src}
          loaderLabel={a.label}
          parked={parked}
          showLoader={false}
          tileWidth={width}
          surface="surface"
          onSettled={(ok) => cascade.settle(a.key, ok)}
          onNeedsHeal={() => {
            entry.needsHeal = true;
          }}
        />
      ) : null}
      {/* Still while off screen or settled on NO SIGNAL: nothing to watch, nothing to wait for. */}
      <TileLoader label={loaderLabel} visible={phase !== 'playing'} animate={!parked && phase !== 'offline'} over={!!poster} />
      {phase === 'playing' && label ? <TileLabel text={label} /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  // View.GONE: no layout, no compositing, and no video punched through whatever
  // screen is really in front. The tiles stay mounted behind it.
  gone: { display: 'none' },
  scroll: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  tile: { position: 'absolute', backgroundColor: '#000', borderRadius: 6, overflow: 'hidden', borderWidth: 1 },
});
