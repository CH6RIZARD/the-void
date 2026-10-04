// Cross-component state the web kept in the DOM:
//   - moderation "sweep" (a block/report/mute re-filters every surface)
//   - in-view sets per surface (observeVideos: play at >=60% visible)
//   - the thread FLIP hand-off (source card rect, lifted card, card re-measure)
import { useEffect, useState, useSyncExternalStore } from 'react';
import { moderation, isMuted, type Post } from '../../core';

type Fn = () => void;
function channel() {
  const s = new Set<Fn>();
  return {
    sub(fn: Fn) {
      s.add(fn);
      return () => {
        s.delete(fn);
      };
    },
    emit() {
      s.forEach((f) => {
        try {
          f();
        } catch {}
      });
    },
  };
}

// ─── moderation sweep ─────────────────────────────────────────────────────
const mod = channel();
let modVersion = 0;
/** Call after any block / unblock / report / mute: every surface re-filters. */
export function sweepModeration(): void {
  modVersion++;
  mod.emit();
}
export function useModerationVersion(): number {
  return useSyncExternalStore(mod.sub, () => modVersion, () => modVersion);
}
/** The web's hidden() wrapper on renderPost + surfaceFree, plus muted subjects. */
export function isPostHidden(p: Post | null | undefined): boolean {
  if (!p) return true;
  try {
    return moderation.hidden(p) || isMuted(p);
  } catch {
    return false;
  }
}

// ─── in-view (video play-on-view) ─────────────────────────────────────────
const inView: Record<string, Set<string>> = {};
const view = channel();
export function setInView(surface: string, ids: Iterable<string>): void {
  inView[surface] = new Set(ids);
  view.emit();
}
/** true while the post is >=60% visible on that surface. */
export function useInView(id: string, surface: string): boolean {
  return useSyncExternalStore(
    view.sub,
    () => !!inView[surface]?.has(id),
    () => false,
  );
}

// ─── per-surface focus (tab blur gives the codecs back) ──────────────────
// Blur used to only PAUSE a surface's clips (empty in-view set), which keeps
// every ExoPlayer and its MediaCodec alive behind the globe - and the wall's
// one VPU pays for all of them. The flag below lets PostMedia drop the player
// entirely on blur (Search's pattern) and re-acquire on focus, when the
// restored in-view ids re-latch the visible cards.
const surfaceFocus: Record<string, boolean> = {};
export function setSurfaceFocused(surface: string, focused: boolean): void {
  surfaceFocus[surface] = focused;
  view.emit();
}
/** false only while the surface's tab is blurred (default true). */
export function useSurfaceFocused(surface: string): boolean {
  return useSyncExternalStore(view.sub, () => surfaceFocus[surface] !== false, () => true);
}

// ─── thread FLIP hand-off ─────────────────────────────────────────────────
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Flip {
  postId: string;
  rect: Rect | null;
  at: number;
  /** re-measure the source card (close = reverse onto its current rect) */
  measure: ((cb: (r: Rect | null) => void) => void) | null;
}
let flip: Flip | null = null;
let lifted: string | null = null;
const lift = channel();

export function beginFlip(postId: string, rect: Rect | null, measure: Flip['measure']): void {
  flip = { postId, rect, at: Date.now(), measure };
}
/** The flip for this thread, if it was started by a tap in the last second. */
export function takeFlip(postId: string): Flip | null {
  if (!flip || flip.postId !== postId || Date.now() - flip.at > 1500) return null;
  return flip;
}
export function currentFlip(postId: string): Flip | null {
  return flip && flip.postId === postId ? flip : null;
}
export function setLifted(postId: string | null): void {
  lifted = postId;
  lift.emit();
}
export function endFlip(): void {
  flip = null;
  setLifted(null);
}
/** The source card hides (visibility:hidden) while its OP copy is in the thread. */
export function useLifted(postId: string): boolean {
  return useSyncExternalStore(lift.sub, () => lifted === postId, () => false);
}

/** Re-render on an interval (ago() labels). */
export function useTick(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}
