// VIDEO / live-stream loader — exact port of sparkleTile() / sparkleMarkup() and
// the web CSS (hard-locked by the user; do not restyle):
//
//   .sparkle-fallback{position:absolute;inset:0;z-index:3;background:rgba(3,1,10,.97);display:flex;
//     align-items:center;justify-content:center;flex-direction:column;gap:6px;overflow:hidden;border-radius:inherit}
//   .sparkle-fallback-particle{position:absolute;width:2px;height:2px;border-radius:50%;background:var(--gold);
//     animation:pfloat linear infinite}
//   .sparkle-fallback-label{font-family:'Syne Mono';font-size:7px;color:var(--muted);letter-spacing:.18em}
//   @keyframes pfloat{0%{opacity:.4;transform:translateY(0) translateX(0)}
//                     100%{opacity:0;transform:translateY(-70px) translateX(15px)}}
//   14 particles: left random 0-100%, bottom random 0-40px, duration 2.5-6.5s,
//   delay -(0-6)s (always mid-flight), animation ignores prefers-reduced-motion.
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { runOnUI, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { Atlas, Canvas, Circle, rect, useColorBuffer, useRSXformBuffer, useTexture } from '@shopify/react-native-skia';
import { mark } from '../core/slow';
import { wallScrollAtSV } from '../features/live/wallScrollSignal';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, em } from '../theme/palettes';
import { VText } from './Text';
import { useLoaderShown } from './loaders/useLoaderClock';

/**
 * FOURTEEN, EVERYWHERE, ALWAYS. THIS IS A DESIGN LOCK.
 *
 * I reduced this to five on wall tiles to buy frames - a dozen tiles mounted at
 * once means around a hundred and seventy native animations, and on this device
 * that is a real cost. It was still the wrong call: the loader is locked, and
 * spending the look to buy the speed is not a trade that was on offer.
 *
 * The cost is real and still has to go. It goes by rendering the SAME fourteen
 * particles more cheaply - one baked loop, or one canvas - never by drawing
 * fewer of them. If a future change makes the wall stutter again, the answer is
 * not in this number.
 */
const COUNT = 14;

interface Particle {
  left: `${number}%`;
  bottom: number;
  /** ms */
  duration: number;
  /** ms, positive magnitude of the negative CSS delay */
  lead: number;
}

function makeParticles(): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < COUNT; i++) {
    out.push({
      left: `${Math.random() * 100}%` as `${number}%`,
      bottom: Math.random() * 40,
      duration: Number((2.5 + Math.random() * 4).toFixed(2)) * 1000,
      lead: Number((Math.random() * 6).toFixed(2)) * 1000,
    });
  }
  return out;
}

// Engine history lives in docs/sparkle-loader-engines.md (the user asked for
// the previous implementations to stay on record; extract them from git, do
// not retype). Current engine below: one Skia Atlas draw per loader.
// ONE DRAW CALL FOR ALL FOURTEEN. The CSS engine stepped each dot as its own
// native view - under a loaded UI thread the steps landed in visible jerks and
// the user called it, correctly. Skia's Atlas draws every particle of a loader
// in a single GPU operation: one worklet reads one accumulated clock and writes
// position + alpha for all fourteen, whatever the JS thread is doing. The math
// is pfloat verbatim - phase = ((t + lead) % duration) / duration, translate
// (+15, -70) * phase, opacity 0.4 -> 0, per-dot durations and leads, all dots
// mid-flight from the first frame. The clock ACCUMULATES frame deltas rather
// than reading the wall clock, so pausing holds every dot exactly where it is
// and resuming continues from there - the CSS play-state semantics the lock is
// written against.
const DOT = 2;    // px on screen, the web's 2x2 particle
const TEX = 12;   // px the sprite is DRAWN at - a 2x2 texture is a square blob
                  // (the user: "little blocks... not round, rigid"); at 12px the
                  // circle antialiases properly and the atlas scales it to 2px.

// ─── ONE CLOCK HAND FOR EVERY LOADER ────────────────────────────────────
//
// Each field used to carry its own useFrameCallback, so twenty loaders meant
// twenty separate Reanimated frame-callback dispatches per UI frame, mid-fling,
// just to add the same dt to twenty clocks. One UI-thread loop now walks a
// registry and advances every running clock; the per-loader t, the random birth
// offset and the accumulate-on-pause semantics are untouched, so every dot's
// position and alpha per frame is bit-identical. The loop stops itself when
// nothing is registered-and-running (the rest of the app must not be woken
// every frame by paused loaders behind a hidden tab) and is kicked back awake
// when a clock turns on. Each tick guards per entry: an unmount racing a tick
// must drop one dt, never throw on the UI thread.
type SparkleClock = { t: SharedValue<number>; on: SharedValue<number> };
function ensureSparkleLoop() {
  'worklet';
  const g = globalThis as any;
  if (g.__sparkleLoop) return;
  const reg = g.__sparkleClocks as SparkleClock[] | undefined;
  if (!reg || !reg.length) return;
  g.__sparkleLoop = true;
  let last = 0;
  let skip = false;
  let inScroll = false;
  // Plain closure, no nested 'worklet' directive - the recursive rAF lesson
  // globeWorklet.ts documents.
  const tick = (ts: number) => {
    // HALF RATE UNDER A WALL SCROLL. Every t advance re-runs each visible
    // field's RSXform+color buffer worklets (14 dots each, and a fling
    // reveals 10-20 loaders by design) - the remaining owner of the scroll's
    // animation window after mounts, creates and the globe left it. A skipped
    // tick does NOT touch `last`, so the next advance carries the full
    // elapsed dt: total motion is bit-identical, merely sampled at 30fps
    // while the display presents ~10. Never frozen - the sparkle mandate
    // holds - and full rate again the instant the scroll stamps stop.
    if (Date.now() - (wallScrollAtSV.value || 0) < 450) {
      skip = !skip;
      if (skip) {
        g.requestAnimationFrame(tick);
        return;
      }
      if (!inScroll) {
        inScroll = true;
        // Attribution, once per scroll episode: how many fields this scroll
        // pays for. console.warn survives release builds.
        try {
          let c = 0;
          const rr = g.__sparkleClocks as SparkleClock[];
          for (let i = 0; i < rr.length; i++) if (rr[i].on.value) c++;
          console.warn('[sparkle] fields during scroll: ' + c);
        } catch {}
      }
    } else {
      inScroll = false;
    }
    const r = g.__sparkleClocks as SparkleClock[];
    let any = false;
    const dt = last ? ts - last : 16.7;
    last = ts;
    for (let i = 0; i < r.length; i++) {
      try {
        if (r[i].on.value) {
          r[i].t.value += dt;
          any = true;
        }
      } catch {}
    }
    if (!any) {
      g.__sparkleLoop = false; // everything paused or gone; a kick restarts us
      return;
    }
    g.requestAnimationFrame(tick);
  };
  g.requestAnimationFrame(tick);
}
function registerSparkleClock(t: SharedValue<number>, on: SharedValue<number>) {
  runOnUI((tSV: SharedValue<number>, onSV: SharedValue<number>) => {
    'worklet';
    const g = globalThis as any;
    if (!g.__sparkleClocks) g.__sparkleClocks = [];
    (g.__sparkleClocks as SparkleClock[]).push({ t: tSV, on: onSV });
    ensureSparkleLoop();
  })(t, on);
}
function unregisterSparkleClock(t: SharedValue<number>) {
  runOnUI((tSV: SharedValue<number>) => {
    'worklet';
    const g = globalThis as any;
    const reg = g.__sparkleClocks as SparkleClock[] | undefined;
    if (!reg) return;
    for (let i = reg.length - 1; i >= 0; i--) if (reg[i].t === tSV) reg.splice(i, 1);
  })(t);
}
function kickSparkleLoop() {
  runOnUI(ensureSparkleLoop)();
}

function SparkleField({ particles, running, color }: { particles: Particle[]; running: boolean; color: string }) {
  const n = particles.length;
  const boxW = useSharedValue(0);
  const boxH = useSharedValue(0);
  const t = useSharedValue(Math.random() * 6000); // a fresh loader is already mid-flight
  const on = useSharedValue(running ? 1 : 0);
  useEffect(() => {
    on.value = running ? 1 : 0;
    if (running) kickSparkleLoop(); // the shared loop may have gone to sleep
  }, [on, running]);
  useEffect(() => {
    registerSparkleClock(t, on);
    return () => unregisterSparkleClock(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // plain arrays capture cleanly into worklets
  const fx = useMemo(() => particles.map((pp) => parseFloat(pp.left) / 100), [particles]);
  const fb = useMemo(() => particles.map((pp) => pp.bottom), [particles]);
  const fd = useMemo(() => particles.map((pp) => pp.duration), [particles]);
  const fl = useMemo(() => particles.map((pp) => pp.lead), [particles]);
  const sprites = useMemo(() => particles.map(() => rect(0, 0, TEX, TEX)), [particles]);
  const texture = useTexture(<Circle cx={TEX / 2} cy={TEX / 2} r={TEX / 2 - 1} color={color} />, { width: TEX, height: TEX });
  const transforms = useRSXformBuffer(n, (val, idx) => {
    'worklet';
    const w = boxW.value, h = boxH.value;
    if (!w || !h) { val.set(1, 0, -10, -10); return; }
    const ph = ((t.value + fl[idx]) % fd[idx]) / fd[idx];
    val.set(DOT / TEX, 0, fx[idx] * w + 15 * ph, h - fb[idx] - DOT - 70 * ph);
  });
  const colors = useColorBuffer(n, (c, idx) => {
    'worklet';
    const ph = ((t.value + fl[idx]) % fd[idx]) / fd[idx];
    const a = 0.4 * (1 - ph);
    c[0] = 1; c[1] = 1; c[2] = 1; c[3] = a;
  });
  // THE BOX IS MEASURED ON A VIEW, NOT ON THE CANVAS.
  //
  // onLayout on a Skia <Canvas> does nothing under Fabric - it logs "<Canvas
  // onLayout={onLayout} /> is not supported on the new architecture" and never
  // fires. boxW/boxH therefore stayed 0, and the worklet above parks every
  // particle off-screen at (-10,-10) while the box is unknown. So the sparkle was
  // EMPTY until some unrelated re-layout happened to set it: the few seconds of
  // "glitching" before the loaders settle, everywhere they are used - onboarding,
  // the globe's first paint, the wall and search.
  //
  // A plain View does support onLayout. It wraps the Canvas at the same
  // absoluteFill box, so the Canvas is laid out exactly where it was and not one
  // pixel of the look changes.
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        boxW.value = e.nativeEvent.layout.width;
        boxH.value = e.nativeEvent.layout.height;
      }}
    >
      <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Atlas image={texture} sprites={sprites} transforms={transforms} colors={colors} />
      </Canvas>
    </View>
  );
}
export interface SparkleLoaderProps {
  /** Mono label, e.g. '● NO SIGNAL'. Omit for none (sparkleMarkup without label). */
  label?: string;
  /** Tap handler (sparkleTile onRetry). */
  onPress?: () => void;
  /** Corner radius of the host (CSS border-radius:inherit). */
  radius?: number;
  /**
   * 'media' (default): globe wall, reels, viewers — always the dark panel.
   * 'feed': post media / carousel — LIGHT theme swaps to the milky #f7f3ea panel.
   */
  surface?: 'media' | 'feed';
  /** Fill the parent absolutely (default true, like position:absolute;inset:0). */
  absolute?: boolean;
  /**
   * false holds the particles still (default true). The loader also stops by itself
   * whenever it can't be seen (blurred screen, hidden surface, app in background).
   */
  animate?: boolean;
  /**
   * false defers BUILDING the 14 dot views until the first render where this is
   * true (then they stay forever). The wall passes its own geometry here - a tile
   * off the viewport or parked has no visible pixels, so skipping its dots is
   * pixel-identical to the user while cutting the batch-mount commit that was
   * measured stalling the JS thread 1.1-1.4s. Keyed on geometry/terminal state
   * ONLY - never a JS clock - so the no-freeze mandate holds: anything visible
   * has mounted, running dots. Default true (every other surface born-running).
   */
  mountDots?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const SparkleLoader = memo(function SparkleLoader({ label, onPress, radius, surface = 'media', absolute = true, animate = true, mountDots = true, style }: SparkleLoaderProps) {
  mark('loader:render');
  const theme = useTheme();
  // BORN RUNNING. The particles exist from the very first mounted frame and the
  // animation starts with them - the loader never waits for the JS thread to
  // prove it visible. The old shape ("build on first sight, run while shown")
  // had the failure direction backwards: visibility signals travel through the
  // JS thread, and on this phone that thread blocks for seconds at a time, so a
  // VISIBLE loader sat as an empty panel until JS breathed, then froze whenever
  // a signal arrived late or wrong - the user watched dots stand still more
  // than they moved. It is now logically impossible for a visible loader to be
  // still: the only pause inputs are `animate={false}` (the caller's terminal
  // state - a tile that gave up shows still particles under '● NO SIGNAL',
  // which is a look, not a spare frame) and a POSITIVE invisibility signal
  // (screen blurred / surface hidden / app backgrounded), whose initial value
  // is "shown". A late signal now merely delays pausing something nobody can
  // see; it can never freeze something someone is looking at. The dots step on
  // the UI thread (Reanimated CSS), so a blocked JS thread cannot stop them
  // mid-flight either.
  //
  // The layout is still built once and kept: a loader keeps the arrangement it
  // was born with across blur/focus, exactly as before - the memo just no
  // longer waits for anyone's permission to build it.
  const onScreen = useLoaderShown(true);
  const running = animate && onScreen;
  const everWanted = useRef(mountDots);
  if (mountDots) everWanted.current = true;
  const particles = useMemo(() => (everWanted.current ? makeParticles() : []), [everWanted.current]);
  const lightFeed = surface === 'feed' && theme.isLight;
  const bg = lightFeed ? '#f7f3ea' : 'rgba(3,1,10,0.97)';
  const labelColor = lightFeed ? theme.colors.dim : theme.colors.muted;
  const body = (
    <>
      {particles.length ? <SparkleField particles={particles} running={running} color={theme.colors.gold} /> : null}
      {label ? (
        <VText style={[styles.label, { color: labelColor }]} numberOfLines={1}>
          {label}
        </VText>
      ) : null}
    </>
  );
  const boxStyle = [absolute ? StyleSheet.absoluteFill : null, styles.box, { backgroundColor: bg }, radius != null ? { borderRadius: radius } : null, style];
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={boxStyle}>
        {body}
      </Pressable>
    );
  }
  return (
    <View pointerEvents="box-none" style={boxStyle}>
      {body}
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    zIndex: 3,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: 6,
    overflow: 'hidden',
  },
  particle: { position: 'absolute', width: 2, height: 2, borderRadius: 1 },
  label: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.18), zIndex: 1 },
});

export default SparkleLoader;
