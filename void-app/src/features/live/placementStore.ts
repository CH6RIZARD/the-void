// WHO IS PARKED AND WHO IS EVICTED, WITHOUT RE-RENDERING THE WHOLE WALL.
//
// Placement used to live in React state: `setPlacement({ parked, evicted })`
// handed two new Sets to the wall, so `tiles.map(...)` rebuilt every mounted
// WallTile element and React reconciled all of them. That happened on every
// placement pass - twice a second while a finger is down - over a list that only
// ever grows, because tiles are added by the batch and cleared only on rebuild.
// After a minute of scrolling that is hundreds of elements reconciled per pass,
// on the thread handling the gesture.
//
// Measured on the phone before this existed: 117 frames in a scripted scroll,
// ALL of them over the 16.7ms budget, 66 of them over 100ms, median 104ms.
//
// A placement pass changes the state of a handful of tiles - the ones that just
// crossed a boundary - and usually none at all. So each tile subscribes to its
// own id and nothing else re-renders. The pass became O(changed) instead of
// O(every tile ever loaded).
import { useCallback, useSyncExternalStore } from 'react';

export interface TilePlacement {
  parked: boolean;
  evicted: boolean;
}

const NEITHER: TilePlacement = { parked: false, evicted: false };

/**
 * The current value per tile.
 *
 * These objects are handed straight to useSyncExternalStore, which compares them
 * by identity - so a tile's object is replaced only when its value actually
 * changes, and an unchanged tile re-renders never.
 */
const current = new Map<number, TilePlacement>();
const listeners = new Map<number, Set<() => void>>();

function emit(id: number): void {
  const set = listeners.get(id);
  if (!set) return;
  set.forEach((fn) => {
    try {
      fn();
    } catch {
      /* one bad subscriber must not stop the rest */
    }
  });
}

/**
 * Apply a whole pass. Only the tiles whose parked/evicted actually flipped are
 * told, and the Sets themselves are never handed to React.
 */
export function applyPlacement(parked: Set<number>, evicted: Set<number>): number {
  let changed = 0;
  const ids = new Set<number>([...listeners.keys(), ...current.keys(), ...parked, ...evicted]);
  for (const id of ids) {
    const was = current.get(id) || NEITHER;
    const isParked = parked.has(id);
    const isEvicted = evicted.has(id);
    if (was.parked === isParked && was.evicted === isEvicted) continue;
    if (!isParked && !isEvicted) current.delete(id);
    else current.set(id, { parked: isParked, evicted: isEvicted });
    emit(id);
    changed++;
  }
  return changed;
}

/** Forget a tile entirely - it has been unmounted and will not come back as itself. */
export function dropPlacement(id: number): void {
  current.delete(id);
  listeners.delete(id);
}

export function clearPlacement(): void {
  const ids = [...current.keys()];
  current.clear();
  ids.forEach(emit);
}

/** What the eviction pass needs to read back without going through React. */
export const placementOf = (id: number): TilePlacement => current.get(id) || NEITHER;

/** Every id currently evicted - the eviction pass needs this to start from. */
export function evictedIds(): Set<number> {
  const out = new Set<number>();
  for (const [id, p] of current) if (p.evicted) out.add(id);
  return out;
}

/** Every id currently parked - a pass that only wants to evict passes this
 *  back unchanged, so applyPlacement's diff cannot silently un-park anyone. */
export function parkedIds(): Set<number> {
  const out = new Set<number>();
  for (const [id, p] of current) if (p.parked) out.add(id);
  return out;
}

/** One tile's own placement. Re-renders that tile and no other. */
export function usePlacement(id: number): TilePlacement {
  const subscribe = useCallback(
    (fn: () => void) => {
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(fn);
      return () => {
        const s = listeners.get(id);
        if (!s) return;
        s.delete(fn);
        if (!s.size) listeners.delete(id);
      };
    },
    [id],
  );
  const snapshot = useCallback(() => current.get(id) || NEITHER, [id]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
