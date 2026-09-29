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
import { Animated, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, em } from '../theme/palettes';
import { VText } from './Text';
import { useLoaderLoop, useLoaderShown } from './loaders/useLoaderClock';

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

// Each particle is its own linear ramp on the native driver (see useLoaderLoop):
// t = ((now + lead) % duration) / duration; opacity .4 -> 0, translate (0,0) -> (15,-70).
const Dot = memo(function Dot({ p, running, color }: { p: Particle; running: boolean; color: string }) {
  const t = useLoaderLoop(p.duration, p.lead, running);
  const style = useMemo(
    () => ({
      opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] }),
      transform: [
        { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -70] }) },
        { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, 15] }) },
      ],
    }),
    [t],
  );
  return <Animated.View pointerEvents="none" style={[styles.particle, { left: p.left, bottom: p.bottom, backgroundColor: color }, style]} />;
});

export interface SparkleLoaderProps {
  /** Mono label, e.g. '● CONNECTING'. Omit for none (sparkleMarkup without label). */
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
  const theme = useTheme();
  // OFF-SCREEN LOADERS BUILD NOTHING; ON-SCREEN ONES ARE UNTOUCHED.
  // Every instance mounted its full set of Animated.Views regardless, each one
  // carrying an Animated.Value and three interpolations, and the globe wall mounts
  // a loader per tile that is not yet playing - two dozen at once.
  //
  // The two conditions are kept apart deliberately. `onScreen` is whether anyone
  // could see this loader at all: its screen focused, its surface shown, the app
  // foregrounded. `running` additionally asks whether it should be moving. A tile
  // that has given up shows the same still particles under '● NO SIGNAL' as it
  // always did - that is a look, not a spare frame - so particles are built
  // whenever the loader is on screen, animating or not, at full count.
  // Only a loader nobody can see builds none, and by definition that changes
  // nothing anyone sees.
  const onScreen = useLoaderShown(true);
  const running = onScreen && animate;
  const particles = useMemo(() => (onScreen ? makeParticles() : []), [onScreen]);
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
