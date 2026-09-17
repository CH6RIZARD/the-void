// The web's single audio drop player (auCur / _auEl / auTimer / auToggle / auStop /
// auPaint / auScrub) as a module store. Keyed by post id, so the feed card's pill and
// the thread OP's pill are the same player: opening a thread never restarts the audio
// and the wave keeps animating (patch3 §4.C.3).
import { useSyncExternalStore } from 'react';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

export interface PillState {
  postId: string | null;
  /** seconds */
  t: number;
  dur: number;
  playing: boolean;
  /** bar index of the play head */
  head: number;
  /** live bar heights near the head while playing (auPaint random jitter) */
  jitter: Record<number, number>;
  tick: number;
}

const BARS = 26;
let state: PillState = { postId: null, t: 0, dur: 0, playing: false, head: 0, jitter: {}, tick: 0 };
/** Per-post resting position (pill.dataset.t) so a stopped pill keeps its scrub point. */
const rest: Record<string, number> = {};
const subs = new Set<() => void>();
let player: AudioPlayer | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let onStop: (() => void) | null = null;
let modeSet = false;

function set(next: Partial<PillState>) {
  state = { ...state, ...next, tick: state.tick + 1 };
  subs.forEach((f) => f());
}
function subscribe(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

function paint(t: number, dur: number, playing: boolean) {
  const f = dur > 0 ? t / dur : 0;
  const head = Math.floor(f * BARS);
  const jitter: Record<number, number> = {};
  if (playing) for (let j = Math.max(0, head - 3); j <= Math.min(BARS - 1, head + 3); j++) jitter[j] = 8 + Math.random() * 20;
  set({ t, dur, playing, head, jitter });
}

/** web auStop() */
export function auStop(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (player) {
    const p = player;
    player = null;
    try {
      p.pause();
    } catch {}
    try {
      (p as any).remove ? (p as any).remove() : (p as any).release?.();
    } catch {}
  }
  const cb = onStop;
  onStop = null;
  if (state.postId) set({ playing: false, jitter: {} });
  cb?.();
}

/**
 * web auToggle(pill). `src` = real audio (data-src); without one the web read the post
 * aloud with speechSynthesis — there is no TTS module in this build, so the pill runs
 * its timer silently (see README deviations). `claim` takes the app's single audio slot.
 */
export function auToggle(postId: string, src: string | undefined, fallbackDur: number, claim?: (stop: () => void) => void, release?: () => void): void {
  if (state.postId === postId && state.playing) {
    auStop();
    return;
  }
  auStop();
  const startAt = rest[postId] || 0;
  state = { ...state, postId, t: startAt, dur: fallbackDur, head: 0, jitter: {} };
  onStop = release || null;
  claim?.(() => auStop());
  if (src) {
    if (!modeSet) {
      modeSet = true;
      setAudioModeAsync({ playsInSilentMode: true } as any).catch(() => {});
    }
    try {
      player = createAudioPlayer({ uri: src });
      if (startAt > 0) player.seekTo(startAt).catch?.(() => {});
      player.play();
    } catch {
      player = null;
    }
    paint(startAt, fallbackDur, true);
    timer = setInterval(() => {
      const p = player;
      if (!p) return;
      const d = p.duration && isFinite(p.duration) && p.duration > 0 ? p.duration : fallbackDur;
      const t = p.currentTime || 0;
      rest[postId] = t;
      // onended: back to 0 and stop
      if (!p.playing && t > 0 && d > 0 && t >= d - 0.25) {
        rest[postId] = 0;
        paint(0, d, false);
        auStop();
        return;
      }
      paint(t, d, true);
    }, 100);
    return;
  }
  paint(startAt, fallbackDur, true);
  timer = setInterval(() => {
    let t = (rest[postId] || 0) + 0.1;
    if (t >= fallbackDur) {
      t = 0;
      rest[postId] = 0;
      paint(0, fallbackDur, false);
      auStop();
      return;
    }
    rest[postId] = t;
    paint(t, fallbackDur, true);
  }, 100);
}

/** web auScrub: moves the head. Unlike the web (paint only) it also seeks a live player. */
export function auScrub(postId: string, fraction: number, dur: number): void {
  const f = Math.min(1, Math.max(0, fraction));
  const t = f * dur;
  rest[postId] = t;
  if (state.postId === postId && player) {
    try {
      player.seekTo(t);
    } catch {}
  }
  if (state.postId === postId) paint(t, state.dur || dur, state.playing);
  else set({});
}

export function restingTime(postId: string): number {
  return rest[postId] || 0;
}

/** Subscribe to the pill for one post; returns null when another pill is current. */
export function usePill(postId: string): PillState | null {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  return s.postId === postId ? s : null;
}
/** Re-render on any pill change (for pills showing a resting scrub point). */
export function usePillTick(): number {
  return useSyncExternalStore(subscribe, () => state.tick, () => state.tick);
}
