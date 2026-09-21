// Jump In, screen 1: three tilted marquees of the app's own live city windows,
// the promise, and the two ways forward.
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONTS, em } from '../../theme/palettes';
import { VText } from '../../ui/Text';
import { t } from './copy';
import { PLACES, WINDOW_COUNT, type LivePlace } from './places';
import { BlinkDot, CTA, Enter, GOLD, Logo, Mono, RED, Serif, WHITE } from './parts';

const TILE_W = 164,
  TILE_H = 96,
  GAP = 9;

function Tile({ p }: { p: LivePlace }) {
  return (
    <View style={s.tile}>
      <Image source={{ uri: p.thumb }} style={[StyleSheet.absoluteFill, { opacity: 0.85 }]} contentFit="cover" cachePolicy="memory-disk" recyclingKey={p.thumb} transition={200} />
      <View style={s.liveChip}>
        <View style={s.liveDot} />
        <VText style={{ fontFamily: FONTS.mono, fontSize: 6.5, letterSpacing: em(6.5, 0.12), color: RED }}>{t('s1.tile.live')}</VText>
      </View>
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.92)']} style={s.tileFoot}>
        <VText numberOfLines={1} style={{ fontFamily: FONTS.sansBold, fontSize: 11, color: WHITE, flexShrink: 1 }}>
          {p.city}
        </VText>
        <VText style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.1), color: GOLD }}>{p.iso}</VText>
      </LinearGradient>
    </View>
  );
}

/** One row, doubled, sliding one set-width per `seconds` (marqL / marqR). */
function Row({ places, seconds, reverse }: { places: LivePlace[]; seconds: number; reverse?: boolean }) {
  const setW = places.length * (TILE_W + GAP);
  const x = useSharedValue(reverse ? -setW : 0);
  useEffect(() => {
    x.value = withRepeat(withTiming(reverse ? 0 : -setW, { duration: seconds * 1000, easing: Easing.linear }), -1, false);
  }, [x, setW, seconds, reverse]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  if (!places.length) return null;
  return (
    <Animated.View style={[s.row, a]}>
      {[...places, ...places].map((p, i) => (
        <Tile key={p.city + i} p={p} />
      ))}
    </Animated.View>
  );
}

export function JumpIn({ onNext, onSignIn }: { onNext: () => void; onSignIn: () => void }) {
  const insets = useSafeAreaInsets();
  const rows = useMemo(() => {
    const pick = (idx: number[]) => idx.map((i) => PLACES[i]).filter(Boolean) as LivePlace[];
    return [PLACES.slice(0, 7), PLACES.slice(7, 14), pick([2, 9, 5, 0, 12, 3, 11])];
  }, []);
  return (
    <Enter style={StyleSheet.absoluteFill}>
      <View style={[s.marquee, { top: 70 + insets.top }]} pointerEvents="none">
        <Row places={rows[0]} seconds={52} />
        <Row places={rows[1]} seconds={64} reverse />
        <Row places={rows[2]} seconds={58} />
      </View>
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(4,2,12,0.55)', 'rgba(4,2,12,0)', 'rgba(4,2,12,0)', 'rgba(4,2,12,0.92)', '#04020c']}
        locations={[0, 0.18, 0.42, 0.62, 0.78]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[s.bottom, { paddingBottom: 46 + insets.bottom }]}>
        <Logo />
        <View style={s.liveLine}>
          <BlinkDot />
          <Mono tracking={0.25} color={RED}>
            {t('s1.live', { n: WINDOW_COUNT })}
          </Mono>
        </View>
        <Serif size={32} style={{ lineHeight: 32 * 1.15 }}>
          {t('s1.headline')}
        </Serif>
        <CTA label={t('s1.cta')} onPress={onNext} style={{ marginTop: 8 }} />
        <Pressable onPress={onSignIn} hitSlop={8} style={{ alignSelf: 'center', padding: 6 }}>
          <Mono tracking={0.2} color="#6a58a0">
            {t('s1.signin')}
          </Mono>
        </Pressable>
      </View>
    </Enter>
  );
}

const s = StyleSheet.create({
  marquee: { position: 'absolute', left: -60, right: -60, gap: 9, transform: [{ rotate: '-7deg' }, { scale: 1.04 }] },
  row: { flexDirection: 'row', gap: GAP },
  tile: {
    width: TILE_W,
    height: TILE_H,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#0d0820',
    boxShadow: '0px 0px 0px 1px rgba(201,168,76,0.18), 0px 12px 30px rgba(0,0,0,0.5)',
  },
  liveChip: {
    position: 'absolute',
    top: 6,
    left: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(3,1,9,0.8)',
  },
  liveDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: RED },
  tileFoot: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 18, paddingHorizontal: 8, paddingBottom: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 28, gap: 14 },
  liveLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
