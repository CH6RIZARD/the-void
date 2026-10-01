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
interface CreateJob {
  run: () => void;
  cancelled: boolean;
}
const createQueue: CreateJob[] = [];
let createTimer: ReturnType<typeof setTimeout> | null = null;
function stepCreate() {
  createTimer = null;
  let job: CreateJob | undefined;
  while ((job = createQueue.shift()) && job.cancelled) {
    /* skipped: its tile unmounted or changed source before its turn */
  }
  if (job) {
    try {
      job.run();
    } catch {
      /* a failed build must not stop the queue */
    }
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
