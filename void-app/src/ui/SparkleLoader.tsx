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
import React, { memo, useMemo } from 'react';
import Reanimated, { type CSSAnimationKeyframes } from 'react-native-reanimated';
import { mark } from '../core/slow';
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

// EACH PARTICLE IS THE WEB'S @keyframes pfloat, RUN BY REANIMATED'S CSS ENGINE.
//
// This was fourteen RN Animated.Views per loader, each building an
// Animated.Value, three interpolations and an attached props node in render,
// then starting a native-driver timing in an effect - roughly ten
// NativeAnimatedModule calls per dot, every one a synchronous hop out of JS.
// A wall batch mounts six tiles, so one commit paid for that about ninety
// times over. Measured on the phone with breadcrumbs on each step, in the 75
// seconds after opening the globe tab: ~24 seconds of blocked JS thread
// attributed to loader:render, loader:dot and loader:loop - 845ms with the
// breadcrumb 2ms old, 2651ms with it 117ms old. The single largest cost in
// the app, and it sat on the one thread that everything else waits for.
//
// The look is locked, so the cost had to come out of HOW fourteen particles
// are driven. This is the exact animation the lock is written against -
//
//   @keyframes pfloat{0%{opacity:.4;transform:translateY(0) translateX(0)}
//                     100%{opacity:0;transform:translateY(-70px) translateX(15px)}}
//   animation: pfloat <2.5-6.5s> linear -<0-6s> infinite
//
// - expressed as a CSS animation that Reanimated 4 runs natively: one style
// prop per dot, registered once at mount in C++, stepped on the UI thread
// with no JS node graph, no effect, and no per-dot bridge traffic. A negative
// animationDelay starts mid-flight exactly as the CSS does (Reanimated's
// AnimationProgressProvider handles it explicitly). translateX/translateY are
// top-level interpolators in its registry, so no transform matrix is built.
//
// Pausing is animationPlayState - the web's own mechanism for a parked tile
// (`animation-play-state: paused`), and the one the web file chose over
// freezing or thinning the particles. A paused dot holds its place and resumes
// from it; a loader that comes back after a long absence resumes where it was
// rather than re-syncing to the wall clock, which is what the reference does.
const PFLOAT: CSSAnimationKeyframes = {
  from: { opacity: 0.4, translateX: 0, translateY: 0 },
  to: { opacity: 0, translateX: 15, translateY: -70 },
};
const Dot = memo(function Dot({ p, running, color }: { p: Particle; running: boolean; color: string }) {
  mark('loader:dot');
  return (
    <Reanimated.View
      pointerEvents="none"
      style={[
        styles.particle,
        { left: p.left, bottom: p.bottom, backgroundColor: color },
        {
          animationName: PFLOAT,
          animationDuration: p.duration,
          animationDelay: -p.lead,
          animationIterationCount: 'infinite',
          animationTimingFunction: 'linear',
          animationPlayState: running ? 'running' : 'paused',
        },
      ]}
    />
  );
});
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
  style?: StyleProp<ViewStyle>;
}

export const SparkleLoader = memo(function SparkleLoader({ label, onPress, radius, surface = 'media', absolute = true, animate = true, style }: SparkleLoaderProps) {
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
  const particles = useMemo(() => makeParticles(), []);
  const lightFeed = surface === 'feed' && theme.isLight;
  const bg = lightFeed ? '#f7f3ea' : 'rgba(3,1,10,0.97)';
  const labelColor = lightFeed ? theme.colors.dim : theme.colors.muted;
  const body = (
    <>
      {particles.map((p, i) => (
        <Dot key={i} p={p} running={running} color={theme.colors.gold} />
      ))}
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
