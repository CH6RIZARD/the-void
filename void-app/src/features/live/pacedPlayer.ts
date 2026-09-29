// A video player whose release is PACED, never burst.
//
// Why this exists (ANR, 2026-09-21, MT6762 test phone): the main thread sat 5s+ inside
//   ExoPlayerImplInternal.release  ←  ExoPlayerImpl.release  ←  expo VideoPlayer.close
// expo-video releases every player on the main thread (it has to: ExoPlayer lives on
// the main looper), and each release blocks until the playback thread finishes
// or ExoPlayer's release timeout (~500ms) runs out. On a loaded CPU it hits the
// timeout. `useVideoPlayer` releases on unmount, and the wall unmounts players in
// bursts: every failed source attempt in the cascade, every heal, every eviction,
// and a whole screen of tiles when the surface changes. Ten at once is 5s of frozen
// UI, and Android kills the input: "not responding".
//
// So a player that leaves the screen is STOPPED at once (pause + empty source: the
// playback thread starts winding down in the background, the decoder is freed) and
// only RELEASED later, one at a time, RELEASE_GAP_MS apart. By the time its turn
// comes the playback thread has nothing left to do, so the release returns quickly,
// and no single frame ever pays for more than one of them.
import { useEffect, useMemo } from 'react';
import { createVideoPlayer, type VideoPlayer, type VideoSource } from 'expo-video';

const RELEASE_GAP_MS = 350;
// TOUCHING A RELEASED PLAYER ABORTS THE PROCESS. expo's shared objects are backed by
// a Java object; once released, the next call through the bridge hits
// "JNI DETECTED ERROR IN APPLICATION: obj == null" inside expo::convertSharedObject
// and Android aborts (device log 09-28 22:42, tid mqt_v_js). A JS try/catch cannot
// save it, so the only defence is never to call one. A player is marked released as
// soon as it is handed to this queue - the actual release is up to a second later -
// and every caller asks first.
const released = new WeakSet<object>();
export function isReleasedPlayer(p: VideoPlayer | null | undefined): boolean {
  return !p || released.has(p as unknown as object);
}
const queue: VideoPlayer[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function step() {
  const p = queue.shift();
  if (p) {
    try {
      p.release();
    } catch {}
  }
  timer = queue.length ? setTimeout(step, RELEASE_GAP_MS) : null;
}

/** Stop a player now; free it on the paced queue. */
export function releasePaced(p: VideoPlayer) {
  // Idempotent here rather than at each call site. Several paths can reach the
  // same player - an effect cleanup, the sweeper, a store eviction - and queueing
  // one twice would release it twice, which is the JNI abort described above.
  // Every caller having to remember is how that eventually happens.
  if (released.has(p as unknown as object)) return;
  released.add(p as unknown as object);
  try {
    p.pause();
  } catch {}
  try {
    p.muted = true;
  } catch {}
  try {
    // An empty source stops loading and frees the decoder without a release.
    // (The iOS main-thread warning on replace() does not apply to Android.)
    (p as any).replace(null, true);
  } catch {}
  queue.push(p);
  if (!timer) timer = setTimeout(step, RELEASE_GAP_MS);
}

/**
 * Drop-in for expo-video's `useVideoPlayer(source, setup)`: same creation, same
 * re-creation when the source changes, but the old player goes through releasePaced
 * instead of being released synchronously on unmount.
 */
// ─── PLAYERS FROM RENDERS THAT NEVER COMMITTED ───────────────────────────
// createVideoPlayer runs inside useMemo, which is the render phase, while the only
// release is an effect cleanup, which is the commit phase. React is free to throw a
// render away - an interrupted or duplicated render under concurrent mode, which is
// exactly what fast tab switching and reel scrolling produce - and a player created
// by a render that never commits has no release path at all. It keeps its sockets,
// its codec handle and its playback thread for the rest of the session.
//
// That is a file-descriptor leak with no ceiling, and the process dies when any fd
// number reaches 1024: "FORTIFY: FD_SET: file descriptor 1124 >= FD_SETSIZE 1024"
// (SIGABRT on device, 2026-09-29). Reported for days as "crashes on tab switch".
//
// Restructuring creation into the commit phase would change when a player exists
// relative to first paint, which this component tree depends on. So creation stays
// where it is and a sweeper collects what React abandoned: every player is recorded
// at birth, the effect marks it adopted, and anything still unadopted well after any
// real commit would have happened is released. A player that a slow commit has not
// claimed yet is still within ADOPT_GRACE_MS, so this cannot take a live one.
const ADOPT_GRACE_MS = 15000;
const SWEEP_MS = 5000;
const unadopted = new Map<VideoPlayer, number>();
let sweeper: ReturnType<typeof setInterval> | null = null;

function sweep() {
  const cutoff = Date.now() - ADOPT_GRACE_MS;
  let freed = 0;
  for (const [p, born] of unadopted) {
    if (born > cutoff) continue;
    unadopted.delete(p);
    if (!isReleasedPlayer(p)) {
      releasePaced(p);
      freed++;
    }
  }
  if (freed) {
    try {
      console.warn('[fd] released ' + freed + ' player(s) from renders that never committed');
    } catch {}
  }
  if (!unadopted.size && sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
}

function born(p: VideoPlayer) {
  unadopted.set(p, Date.now());
  if (!sweeper) sweeper = setInterval(sweep, SWEEP_MS);
}

/**
 * Drop-in for expo-video's `useVideoPlayer(source, setup)`: same creation, same
 * re-creation when the source changes, but the old player goes through releasePaced
 * instead of being released synchronously on unmount.
 */
export function usePacedPlayer(source: VideoSource, setup?: (p: VideoPlayer) => void): VideoPlayer {
  const key = JSON.stringify(source);
  const player = useMemo(() => {
    const p = createVideoPlayer(source);
    born(p);
    try {
      setup?.(p);
    } catch {}
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    unadopted.delete(player); // this render committed; the cleanup below owns it now
    return () => releasePaced(player);
  }, [player]);
  return player;
}
