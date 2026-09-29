// Cascade driver: walk a source chain in ONE tile sequentially, first success wins.
// Native port of connectWallCell()/connectTile() + the instant refusals at the top of
// attemptSource(). Reusable by any surface (globe wall, nation grid, search).
//
//   const c = useStreamCascade(onResult)
//   c.start(chain)            → mounts <StreamTile key={c.attempt.key} source={c.attempt.src} …/>
//   c.attempt                 → current attempt or null (nothing mounted)
//   c.settle(key, ok)         → StreamTile.onSettled={ok => c.settle(c.attempt.key, ok)}
//   c.cancel()                → dispose (web disposeCell): unmounts + releases the claim
import { useCallback, useEffect, useRef, useState } from 'react';
import { claimLiveKey, iframeAllowed, releaseLiveKey } from './constants';
import { isBadStream, liveVidFor, type StreamSource } from './core';

export interface CascadeAttempt {
  key: string;
  src: StreamSource;
  index: number;
  /** '● CONNECTING'. How many sources have been tried is not the viewer's business. */
  label: string;
}

export interface CascadeResult {
  ok: boolean;
  src?: StreamSource;
}

let attemptSeq = 0;

/** attemptSource's synchronous refusals (resolve(false) before anything mounts). */
export function refuseInstantly(src: StreamSource): boolean {
  if (!src) return true;
  // Not confirmed live → refuse in 0ms so dead channels never occupy a lane.
  if (src.type === 'youtube' && liveVidFor(src) === undefined) return true;
  if (isBadStream(src)) return true;
  if (src.type === 'iframe' && !iframeAllowed(src)) return true;
  if (!['youtube', 'hls', 'mjpeg', 'iframe'].includes(src.type)) return true;
  return false;
}

export function useStreamCascade(onResult: (r: CascadeResult) => void) {
  const [attempt, setAttempt] = useState<CascadeAttempt | null>(null);
  const chain = useRef<StreamSource[]>([]);
  const idx = useRef(0);
  const claimed = useRef<StreamSource | null>(null);
  const curKey = useRef<string | null>(null);
  const run = useRef(0);
  const cbRef = useRef(onResult);
  cbRef.current = onResult;

  const release = useCallback(() => {
    if (claimed.current) releaseLiveKey(claimed.current);
    claimed.current = null;
  }, []);

  const next = useCallback(
    (runId: number) => {
      if (runId !== run.current) return;
      while (idx.current < chain.current.length) {
        const i = idx.current++;
        const src = chain.current[i];
        if (refuseInstantly(src)) continue;
        if (!claimLiveKey(src)) continue; // already on screen elsewhere
        claimed.current = src;
        const key = `a${++attemptSeq}`;
        curKey.current = key;
        // RETRYING was in the original port and nobody asked for it. A tile that is
        // working through its sources is still loading, and the sparkle already says
        // so; announcing the attempt number only tells the viewer the app is
        // struggling. One label, until it plays or gives up.
        setAttempt({ key, src, index: i, label: '● CONNECTING' });
        return;
      }
      curKey.current = null;
      setAttempt(null);
      cbRef.current({ ok: false });
    },
    [],
  );

  const start = useCallback(
    (list: StreamSource[]) => {
      release();
      run.current++;
      chain.current = list || [];
      idx.current = 0;
      setAttempt(null);
      next(run.current);
    },
    [next, release],
  );

  const settle = useCallback(
    (key: string, ok: boolean) => {
      if (key !== curKey.current) return; // a disposed/stale attempt
      const runId = run.current;
      const src = claimed.current;
      if (ok && src) {
        cbRef.current({ ok: true, src });
        return;
      }
      // A failed attempt hands the key back, otherwise a stream that merely timed out
      // here becomes permanently unavailable to every other tile.
      release();
      curKey.current = null;
      setAttempt(null);
      // next tick so the failed player unmounts before the next one mounts
      setTimeout(() => next(runId), 0);
    },
    [next, release],
  );

  const cancel = useCallback(() => {
    run.current++;
    release();
    curKey.current = null;
    setAttempt(null);
  }, [release]);

  useEffect(() => () => cancel(), [cancel]);

  return { attempt, start, settle, cancel };
}
