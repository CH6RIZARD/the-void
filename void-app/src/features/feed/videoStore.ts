// One expo-video player per post id, shared by every view of that post.
//
// Media continuity (patch3 §4.C.3): the web REPARENTED the feed card's <video> into the
// thread so the clip kept playing. Native views can't be reparented, but a player can be
// re-attached: the feed card and the thread OP both call useSharedPlayer(post.id) and get
// the SAME instance, so playback position and play state carry over. Only one VideoView
// is mounted per player at a time (the card drops its view while lifted).
//
// Players are ref-counted and released a beat after the last user lets go, so the
// card -> thread hand-off (unmount + mount in the same frame) never recreates one.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { mark } from '../../core/slow';
import { enqueueCreate, releasePaced } from '../live/pacedPlayer';

// SHORT CLIPS START ON A QUARTER SECOND, NOT TWO.
// expo-video's Android defaults are a 20s target buffer and 2s before the first
// frame may play; the reverse-engineered apps run a 5s target and 250ms start
// (report A.4 #2, bufferForPlaybackMs=250 / afterRebuffer=250), and raise the
// after-rebuffer figure only when stutter telemetry says so. iOS: don't wait to
// minimise stalling on a clip that is already cached or 8s buffered.
// ponytail: one profile for feed and reels; split them if rebuffer counts differ.
export const CLIP_BUFFER = { preferredForwardBufferDuration: 8, minBufferForPlayback: 0.25, waitsToMinimizeStalling: false } as const;
/** One disk cache serves prefetch and playback (report A.4 #4); size set at boot in app/_layout. */
export const CLIP_CACHE_BYTES = 150 * 1024 * 1024;
/**
 * Disk-cache this clip? Android only: Media3's SimpleCache sits under the player.
 * iOS caching goes through expo-video's AVAssetResourceLoaderDelegate proxy, which
 * bypasses AVFoundation's native loader and made reels stutter on the iPhone (2026-10-16).
 * Never HLS (iOS cannot cache it at all).
 */
export const clipCaching = (uri: string): boolean => Platform.OS === 'android' && !/\.m3u8(\?|$)/i.test(uri);

interface Entry {
  /** null until the paced builder has run its job. */
  player: VideoPlayer | null;
  uri: string;
  refs: number;
  releaseT: ReturnType<typeof setTimeout> | null;
  job: ReturnType<typeof enqueueCreate> | null;
  /** Hooks waiting for the player to exist. */
  waiters: Set<(p: VideoPlayer) => void>;
}
const entries = new Map<string, Entry>();

function acquire(postId: string, uri: string): Entry {
  let e = entries.get(postId);
  if (e && e.uri !== uri) {
    release(postId, true);
    e = undefined;
  }
  if (!e) {
    // Built on the paced queue, never here. This used to call createVideoPlayer
    // synchronously from the card's effect the first time it was >=60% in view -
    // an ExoPlayer.Builder().build() of 0.3-1.7s (see pacedPlayer.ts) landing on a
    // fling frame, and on tab focus one per visible clip in the same frame.
    // Measured 10-08 feed_scroll: stalls 606/697/1222ms with no mark of their own.
    // The queue holds during gestures and spaces builds out; the card shows its
    // loader until its turn, as it already did while the first frame decoded.
    const entry: Entry = { player: null, uri, refs: 0, releaseT: null, job: null, waiters: new Set() };
    entry.job = enqueueCreate(() => {
      mark('feed:player');
      const player = createVideoPlayer({ uri, useCaching: clipCaching(uri) });
      try {
        player.bufferOptions = CLIP_BUFFER;
      } catch {}
      player.muted = true; // muted + loop, like the feed <video muted loop playsinline>
      player.loop = true;
      entry.player = player;
      entry.job = null;
      entry.waiters.forEach((w) => w(player));
      entry.waiters.clear();
    });
    entries.set(postId, entry);
    e = entry;
  }
  if (e.releaseT) {
    clearTimeout(e.releaseT);
    e.releaseT = null;
  }
  e.refs++;
  return e;
}

function release(postId: string, now = false): void {
  const e = entries.get(postId);
  if (!e) return;
  const kill = () => {
    // Only ever remove THIS entry. kill() closes over the entry that existed when
    // release() was called, and a timer from an older entry can still be pending
    // when a newer one has taken its place in the map (same post, new uri). The
    // unconditional delete removed the newer entry while leaving its player alive,
    // so nothing ever released it - one permanently open ExoPlayer, with all its
    // sockets, per occurrence.
    if (entries.get(postId) === e) entries.delete(postId);
    // Stopped now, released on the paced queue: the feed trims cards in batches, and a
    // burst of synchronous ExoPlayer releases blocks the main thread (ANR 2026-09-21).
    // A player still waiting to be built is simply never built.
    if (e.job) e.job.cancelled = true;
    e.waiters.clear();
    if (e.player) releasePaced(e.player);
  };
  if (now) {
    // The immediate path skipped this, leaving the timer armed on an entry that is
    // already gone. That timer is what did the damage above.
    if (e.releaseT) {
      clearTimeout(e.releaseT);
      e.releaseT = null;
    }
    return kill();
  }
  e.refs = Math.max(0, e.refs - 1);
  if (e.refs > 0) return;
  if (e.releaseT) clearTimeout(e.releaseT);
  e.releaseT = setTimeout(() => {
    if (e.refs === 0) kill();
  }, 400);
}

/** The shared player for a post, or null while `enabled` is false (web preload="none"). */
export function useSharedPlayer(postId: string, uri: string | undefined, enabled: boolean): VideoPlayer | null {
  const [player, setPlayer] = useState<VideoPlayer | null>(() => (enabled && uri ? peek(postId, uri) : null));
  useEffect(() => {
    if (!enabled || !uri) {
      setPlayer(null);
      return;
    }
    const e = acquire(postId, uri);
    setPlayer(e.player);
    if (!e.player) e.waiters.add(setPlayer);
    return () => {
      e.waiters.delete(setPlayer);
      release(postId);
    };
  }, [postId, uri, enabled]);
  return player;
}

function peek(postId: string, uri: string): VideoPlayer | null {
  const e = entries.get(postId);
  return e && e.uri === uri ? e.player : null;
}

/** Is a shared player for this post currently playing? (thread: keep it going) */
export function isSharedPlaying(postId: string): boolean {
  const e = entries.get(postId);
  try {
    return !!e?.player && e.player.playing;
  } catch {
    return false;
  }
}
export function hasSharedPlayer(postId: string): boolean {
  return entries.has(postId);
}
