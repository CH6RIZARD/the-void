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
import { useEffect, useRef, useState } from 'react';
import { mark } from '../../core/slow';
import { createVideoPlayer, type VideoPlayer, type VideoSource } from 'expo-video';
import { MAX_MOUNTED_PLAYERS } from './constants';

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

// ─── HOW MANY CODECS ARE ACTUALLY ALIVE ──────────────────────────────────
// Counted here because this file is where a paced player is born (enqueueCreate)
// and where one truly dies (step below - a player handed to releasePaced still
// holds its codec until its queue slot runs). Only players THIS file created are
// counted: videoStore's feed players drain through the same release queue, and
// decrementing for a player never counted would quietly open the cap back up.
// The wall reads both numbers as backpressure - stepCreate's hard cap here, and
// healVisible's pressure gate in LiveWall.
let liveCount = 0;
const counted = new WeakSet<object>();
export function livePlayerCount(): number {
  return liveCount;
}
export function releaseQueueDepth(): number {
  return queue.length;
}

function step() {
  const p = queue.shift();
  if (p) {
    try {
      p.release();
    } catch {}
    // AFTER release, success or swallowed: the codec is only truly gone once
    // release has run, and a throw here still tore the player down.
    if (counted.has(p as unknown as object)) liveCount = Math.max(0, liveCount - 1);
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
  // NOT replace(null) HERE.
  // This used to clear the source synchronously, to free the decoder without
  // waiting for the paced release - worth having when decoders are the scarce
  // resource. But pause() is asynchronous: it posts to the ExoPlayer:Playback
  // thread and returns. Clearing the source immediately afterwards tears the
  // sample queue down while that thread can still be inside it, and another
  // session measured exactly that abort on device:
  //
  //   SIGSEGV, SampleDataQueue.readData -> DirectByteBuffer.put -> memcpy
  //   to an unmapped address
  //
  // which is a decode buffer freed under a live reader. It needs 28 creates
  // racing 52 releases in a ten-second window to show up, which is what the wall
  // was doing before the mount budget, so it read as a rare crash rather than a
  // race. The paced release below goes through release(), which stops playback
  // and frees the decoder in the right order on the right thread; the only thing
  // lost is a few hundred milliseconds of decoder lifetime per tile, and the
  // mount budget means far fewer of them are alive to matter.
  queue.push(p);
  if (!timer) timer = setTimeout(step, RELEASE_GAP_MS);
}

// ─── CREATION IS PACED TOO. IT USED TO HAPPEN INSIDE RENDER. ────────────
//
// createVideoPlayer is not a cheap handle. On Android the VideoPlayer's Kotlin
// constructor runs ExoPlayer.Builder(...).build() in a property initialiser -
// renderers, track selector, load control, the playback HandlerThread - on
// whichever thread constructs the object. Called from useMemo, that thread is
// the JS thread and the moment is the middle of a React commit. Only prepare()
// is deferred to the main queue; the build itself is synchronous.
//
// A first fill commits a dozen tiles at once, and each in-ring tile built its
// player right there. Measured with the heartbeat, breadcrumb twelve
// milliseconds old: `js thread stalled 805ms · last: wall:placement`, then
// 739ms, then `370ms · last: wall:loadBatch`. loadBatch already slices six
// tiles per frame to stay responsive; six synchronous ExoPlayer builds per
// slice is why it did not.
//
// The null source made it worse. A tile passes null while its HLS variant is
// being resolved, and createVideoPlayer(null) builds a complete ExoPlayer with
// nothing to play - then the real url arrives and a second one is built. The
// "one player per tile" change had only moved the second build later.
//
// So creation goes through a queue: one build per tick, CREATE_GAP_MS apart,
// never inside a commit, and never for a null source. A tile renders its panel
// first and its player arrives a tick or two later - which is what it already
// did while waiting on the variant, so nothing about when a picture appears
// changes except that the thread stays free in between. Release was already
// paced for the mirror-image reason; see the top of this file.
//
// This also closes the leak the old sweeper existed for. A player created in
// render had no release path if React threw that render away; a player
// created by a committed effect is owned by that effect's cleanup from the
// instant it exists. There is no longer anything to sweep.
const CREATE_GAP_MS = 40;
// ─── THE HARD CAP LIVES AT THE SOURCE ────────────────────────────────────
// Whatever heals, cascade advances or fill waves ask for, the device cannot be
// marched past the hardware decoder pool (~16 AVC sessions on the MediaTek test
// phones; past it Android hands out the software decoder, which dies). So the
// builder itself refuses to run while the live count sits at the ceiling:
// the job is DEFERRED, exactly like the fling hold - never dropped - and the
// tile keeps showing its loading panel as it already does while waiting its
// turn. The per-job deadline is the same self-expiring shape as createHoldUntil:
// a counting bug can delay a build by five seconds, never starve the grid.
// ponytail: the +4 slack and 5s deadline are knobs - tune on device if the
// post-eviction convergence pass ships bursty.
const CREATE_CAP = MAX_MOUNTED_PLAYERS + 4;
const CREATE_DEFER_MAX_MS = 5000;
interface CreateJob {
  run: () => void;
  cancelled: boolean;
  /** Set when the cap first defers this job; it runs anyway once this passes. */
  deferUntil?: number;
}
const createQueue: CreateJob[] = [];
let createTimer: ReturnType<typeof setTimeout> | null = null;
// ─── THE FLING GETS A HOLIDAY FROM THE BUILDER TOO. ─────────────────────
//
// Pacing spread the builds out; it did not move them off the gesture. A fling
// still paid for one synchronous ExoPlayer.Builder().build() on the JS thread
// every 40ms - each one 0.3-1.7s under load - exactly while that thread was
// supposed to be feeding scroll events. So the wall can HOLD the queue for the
// duration of a gesture: nothing is dropped, the jobs simply wait their turn
// until the fling is over, then run 40ms apart as before.
//
// The hold is a DEADLINE, not a flag. The wall extends it while scroll events
// keep arriving and shortens it when the gesture ends; if the end event never
// comes (the latch-that-stuck lesson from the globe), the deadline simply
// passes and the builds resume by themselves. A stuck hold is structurally
// impossible, which matters because a stuck hold would starve the wall.
let createHoldUntil = 0;
/** Hold player builds for the next `ms` milliseconds. Self-expiring; call again to extend or shorten. */
export function holdCreates(ms: number) {
  createHoldUntil = Date.now() + ms;
}
function stepCreate() {
  createTimer = null;
  if (!createQueue.length) return;
  if (Date.now() < createHoldUntil) {
    // Held: a gesture owns the thread. Check back soon without building.
    createTimer = setTimeout(stepCreate, 80);
    return;
  }
  // Cancelled heads go first, so the cap below never waits on a job nobody wants.
  while (createQueue.length && createQueue[0].cancelled) createQueue.shift();
  if (!createQueue.length) return;
  if (liveCount >= CREATE_CAP) {
    const head = createQueue[0];
    if (!head.deferUntil) head.deferUntil = Date.now() + CREATE_DEFER_MAX_MS;
    if (Date.now() < head.deferUntil) {
      // At the decoder ceiling: defer, never drop. See CREATE_CAP above.
      createTimer = setTimeout(stepCreate, 80);
      return;
    }
  }
  const job = createQueue.shift()!;
  mark('player:create');
  try {
    job.run();
  } catch {
    /* a failed build must not stop the queue */
  }
  if (createQueue.length) createTimer = setTimeout(stepCreate, CREATE_GAP_MS);
}
function enqueueCreate(run: () => void): CreateJob {
  const job: CreateJob = { run, cancelled: false };
  createQueue.push(job);
  // 0, not CREATE_GAP_MS: the first build goes on the next tick, not this one.
  if (!createTimer) createTimer = setTimeout(stepCreate, 0);
  return job;
}

/**
 * Drop-in for expo-video's `useVideoPlayer(source, setup)`, except that the
 * player is created on a paced queue after commit and released on a paced queue
 * after unmount - so it is `null` until its turn comes, and callers render
 * nothing for it until then. A null source creates nothing at all.
 */
export function usePacedPlayer(source: VideoSource, setup?: (p: VideoPlayer) => void): VideoPlayer | null {
  const key = JSON.stringify(source ?? null);
  const [player, setPlayer] = useState<VideoPlayer | null>(null);
  const setupRef = useRef(setup);
  setupRef.current = setup;
  useEffect(() => {
    if (source == null) {
      setPlayer(null);
      return;
    }
    let mine: VideoPlayer | null = null;
    const job = enqueueCreate(() => {
      const p = createVideoPlayer(source);
      mine = p;
      // Count only once the build actually succeeded; step() balances it.
      liveCount++;
      counted.add(p as unknown as object);
      try {
        setupRef.current?.(p);
      } catch {}
      setPlayer(p);
    });
    return () => {
      job.cancelled = true;
      if (mine) {
        const gone = mine;
        releasePaced(gone);
        // Never hand a released player to a VideoView, even for one tick.
        setPlayer((cur) => (cur === gone ? null : cur));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return player;
}
