// .post-car — a real swipeable strip, one paging cell per image, dots + "k/N" count.
//   .post-car{margin-bottom:12px;border-radius:13px;overflow:hidden;background:var(--card2)}
//   .post-car-strip{aspect-ratio:16/9; scroll-snap x}
//   .post-car-dots{bottom:9px; gap 5; i 5x5 rgba(255,255,255,.35); on: gold, scale 1.25}
//   .post-car-count{top:9px;right:10px;padding:3px 8px;radius 14;bg rgba(4,2,12,.7);Syne Mono 7 .1em #f4f0ff}
// A slide whose image fails loses its image (and loader), the cell stays.
import React, { memo, useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { moderation, type Post } from '../../../core';
import { useTheme } from '../../../theme/ThemeProvider';
import { ImageOrbitLoader } from '../../../ui/ImageOrbitLoader';
import { VText } from '../../../ui/Text';
import { FONTS, em } from '../../../theme/palettes';
import { openPhoto } from '../navigation';
import { GraphicVeil, VeilDim } from './GraphicVeil';

const Cell = memo(function Cell({ uri, width, veiled, onPress }: { uri: string; width: number; veiled: boolean; onPress: () => void }) {
  const [shown, setShown] = useState(false);
  const [dead, setDead] = useState(false);
  return (
    <Pressable onPress={onPress} style={{ width, height: '100%' }}>
      {!dead ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          blurRadius={veiled ? 32 : 0}
          onDisplay={() => setShown(true)}
          onError={() => setDead(true)}
        />
      ) : null}
      {!shown && !dead ? <ImageOrbitLoader surface="feed" /> : null}
    </Pressable>
  );
});

export const PostCarousel = memo(function PostCarousel({ post: p, style }: { post: Post; style?: any }) {
  const { colors } = useTheme();
  const slides = p._imgs && p._imgs.length ? p._imgs : [p._img].filter(Boolean) as string[];
  const [w, setW] = useState(0);
  const [k, setK] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const kRef = useRef(0);
  const veiled = !revealed && moderation.graphicVeilOn() && moderation.isGraphic(p);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const width = e.nativeEvent.layoutMeasurement.width || 1;
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      if (next !== kRef.current) {
        kRef.current = next;
        setK(next);
      }
    },
    [],
  );

  if (!slides.length) return null;
  const n = slides.length;
  return (
    <View
      style={[styles.car, { backgroundColor: colors.card2 }, style]}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
    >
      <View style={styles.strip}>
        {w > 0 ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            nestedScrollEnabled
            scrollEnabled={!veiled}
          >
            {slides.map((u, i) => (
              <Cell key={u + i} uri={u} width={w} veiled={veiled} onPress={() => (veiled ? setRevealed(true) : openPhoto(p.id, i))} />
            ))}
          </ScrollView>
        ) : null}
      </View>
      <View pointerEvents="none" style={styles.dots}>
        {slides.map((_, i) => (
          <View key={i} style={[styles.dot, i === k ? { backgroundColor: colors.gold, transform: [{ scale: 1.25 }] } : null]} />
        ))}
      </View>
      <View pointerEvents="none" style={styles.count}>
        <VText style={styles.countT}>{`${Math.min(k + 1, n)}/${n}`}</VText>
      </View>
      {veiled ? <VeilDim /> : null}
      {veiled ? <GraphicVeil /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  car: { position: 'relative', marginBottom: 12, borderRadius: 13, overflow: 'hidden' },
  strip: { width: '100%', aspectRatio: 16 / 9 },
  dots: { position: 'absolute', left: 0, right: 0, bottom: 9, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.35)' },
  count: { position: 'absolute', top: 9, right: 10, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 14, backgroundColor: 'rgba(4,2,12,0.7)' },
  countT: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.1), color: '#f4f0ff' },
});
