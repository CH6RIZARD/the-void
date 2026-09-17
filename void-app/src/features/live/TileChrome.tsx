// Small pieces of tile chrome ported from the web CSS:
//   .strip-live-dot, .gl-tile-label / tileLabel(), .audio-on ring + ::after speaker
//   badge, and the sparkleTile()/yt-hold loader surfaces.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as SparkleModule from '../../ui/SparkleLoader';
import { em, useLiveTheme } from './liveTheme';

const SparkleLoader: React.ComponentType<{ label?: string; style?: ViewStyle }> =
  (SparkleModule as any).SparkleLoader ?? (SparkleModule as any).default;

/** .strip-live-dot{width:5px;height:5px;border-radius:50%;background:var(--red);animation:blink 1.3s infinite} */
export function LiveDot({ style }: { style?: ViewStyle }) {
  const t = useLiveTheme();
  const o = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    // @keyframes blink{0%,100%{opacity:1}50%{opacity:.1}} — CSS default timing is `ease`.
    const ease = Easing.bezier(0.25, 0.1, 0.25, 1);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 0.1, duration: 650, easing: ease, useNativeDriver: true }),
        Animated.timing(o, { toValue: 1, duration: 650, easing: ease, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [o]);
  return <Animated.View style={[{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.red, opacity: o }, style]} />;
}

/**
 * tileLabel(): `<div class="csg-tile-label"><span class="strip-live-dot"></span> TEXT</div>`
 * .gl-tile-label{bottom:0;left:0;right:0;z-index:4;background:linear-gradient(transparent,rgba(0,0,0,.9));
 *   padding:4px 6px 5px;font:'Syne Mono' 7px;color:var(--gold);letter-spacing:.1em;pointer-events:none}
 */
export function TileLabel({ text }: { text: string }) {
  const t = useLiveTheme();
  return (
    <View pointerEvents="none" style={[styles.label, labelGradient]}>
      <Text numberOfLines={1} style={{ fontFamily: t.mono, fontSize: 7, color: t.gold, letterSpacing: em(7, 0.1) }}>
        <LiveDotInline /> {text}
      </Text>
    </View>
  );
}
// The dot sits inline with the text in the web (a span in the label's text flow).
function LiveDotInline() {
  return (
    <View style={{ width: 5, height: 5, paddingRight: 0 }}>
      <LiveDot style={{ marginBottom: 0.5 }} />
    </View>
  );
}

// RN 0.86 renders CSS gradients through `experimental_backgroundImage` (New Arch).
// If a platform ignores it the label still reads (gold on the video).
const labelGradient: any = { experimental_backgroundImage: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.9))' };

/**
 * .gl-tile.audio-on{box-shadow:inset 0 0 0 1.5px rgba(201,168,76,.75)}
 * .gl-tile.audio-on::after — 18px circle rgba(4,2,12,.72), top/right 7px, gold speaker 11px.
 * An inset zero-blur box-shadow is exactly a 1.5px inner border, drawn as an overlay so
 * it never shifts the media.
 */
export function AudioRing({ radius = 6 }: { radius?: number }) {
  return (
    <>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1.5, borderColor: 'rgba(201,168,76,0.75)', zIndex: 5 }]} />
      <View pointerEvents="none" style={styles.badge}>
        <Svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M11 5 6 9H3v6h3l5 4z" />
          <Path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        </Svg>
      </View>
    </>
  );
}

/**
 * sparkleTile(cell,label) — .sparkle-fallback{inset:0;z-index:3;background:rgba(3,1,10,.97)}
 * The hard-locked SparkleLoader from src/ui owns the particles; this only positions it
 * and fades it out (.45s) once the tile is PLAYING, like finish(true) does.
 */
export function TileLoader({ label, visible, zIndex = 3 }: { label?: string; visible: boolean; zIndex?: number }) {
  const o = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [mounted, setMounted] = React.useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      o.setValue(1);
      return;
    }
    Animated.timing(o, { toValue: 0, duration: 450, easing: Easing.bezier(0.25, 0.1, 0.25, 1), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [visible, o]);
  if (!mounted) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex, opacity: o, backgroundColor: 'rgba(3,1,10,0.97)', overflow: 'hidden' }]}>
      {SparkleLoader ? <SparkleLoader label={label} style={StyleSheet.absoluteFill as ViewStyle} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  label: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4, paddingTop: 4, paddingHorizontal: 6, paddingBottom: 5 },
  badge: {
    position: 'absolute',
    top: 7,
    right: 7,
    zIndex: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(4,2,12,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
