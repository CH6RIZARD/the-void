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
import { createVideoPlayer, type VideoPlayer } from 'expo-video';

interface Entry {
  player: VideoPlayer;
  uri: string;
  refs: number;
  releaseT: ReturnType<typeof setTimeout> | null;
}
const entries = new Map<string, Entry>();

function acquire(postId: string, uri: string): Entry {
  let e = entries.get(postId);
  if (e && e.uri !== uri) {
    release(postId, true);
    e = undefined;
  }
  if (!e) {
    const player = createVideoPlayer({ uri });
    player.muted = true; // muted + loop, like the feed <video muted loop playsinline>
    player.loop = true;
    const entry: Entry = { player, uri, refs: 0, releaseT: null };
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
    entries.delete(postId);
    try {
      e.player.pause();
    } catch {}
    try {
      e.player.release();
    } catch {}
  };
  if (now) return kill();
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
    return () => release(postId);
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
    return !!e && e.player.playing;
  } catch {
    return false;
  }
}
export function hasSharedPlayer(postId: string): boolean {
  return entries.has(postId);
}
