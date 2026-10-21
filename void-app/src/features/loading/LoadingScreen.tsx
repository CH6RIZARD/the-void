// THE LOADING SCREEN: the void band, the character falling through sparkles, the words "Void Archive".
// A port of the Void Loading Lab artifact; every number comes from one of LOADING_SETS in ./arrivals.ts.
//
// Owner, 2026-10-21: no live 3D here. The GL figure drew black on iPhone and its context + shaders held the screen
// on black before it could start. The band and the word are native views; he is the lab's own render, baked per
// saved set (loadingFrames.ts, scripts/fall/render.mjs --loading), sparkles included. All moved by Reanimated.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { FONTS, useTheme } from '../../theme/tokens';
import { arrive, LOADING_RUN, LOADING_SETS, LOADING_THEMES, type LoadingSet } from './arrivals';
import { LOADING_FRAMES } from './loadingFrames';

type LT = keyof typeof LOADING_THEMES;
const themeKey = (name: string): LT => (name in LOADING_THEMES ? (name as LT) : 'dark');

const OPENS_KEY = 'void.loading.opens';
/** Picks the look for this open: the same one for LOADING_RUN opens in a row, then the next. */
export function LoadingScreen(props: { fontsReady: boolean; onFirstFrame?: () => void }) {
  const theme = useTheme();
  const T = LOADING_THEMES[themeKey(theme.name)];
  const [k, setK] = useState<number | null>(null);
  useEffect(() => {
    let on = true;
    AsyncStorage.getItem(OPENS_KEY).then((v) => {
      const n = Math.max(0, parseInt(v || '0', 10) || 0);
      AsyncStorage.setItem(OPENS_KEY, String(n + 1)).catch(() => {});
      if (on) setK(Math.floor(n / LOADING_RUN) % LOADING_SETS.length);
    }, () => { if (on) setK(0); });
    return () => { on = false; };
  }, []);
  return k !== null ? <LoadingScene L={LOADING_SETS[k]} F={LOADING_FRAMES[k % LOADING_FRAMES.length]} {...props} /> : <View style={[styles.fill, { backgroundColor: T.page }]} />;
}

function LoadingScene({ L, F, fontsReady, onFirstFrame }: { L: LoadingSet; F: (typeof LOADING_FRAMES)[number]; fontsReady: boolean; onFirstFrame?: () => void }) {
  const theme = useTheme();
  const T = LOADING_THEMES[themeKey(theme.name)];
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => { const { width, height } = e.nativeEvent.layout; setSize({ w: width, h: height }); }, []);
  // His clock starts with the first frame on screen, so nothing has played before you see it.
  const clock = useSharedValue(-1);
  const t0 = useSharedValue(0);
  useFrameCallback((info) => {
    'worklet';
    if (clock.value < 0) t0.value = info.timestamp;
    clock.value = (info.timestamp - t0.value) / 1000;
  });
  const firstFrame = useRef(onFirstFrame); firstFrame.current = onFirstFrame;
  useEffect(() => { if (size.w > 0) firstFrame.current?.(); }, [size.w > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // The band in dp (the lab: margins bm, 3:1, corners tr x its height).
  const bw = size.w * (1 - 2 * L.bm), bh = bw / 3, fs = bh * 0.3 * L.wsize;
  const bx = (size.w - bw) / 2, by = (size.h - bh) / 2;
  // Him: his cell is ~0.96 x the band's height (the lab's camera and scale), right of the word, a little low.
  const cell = 0.96 * bh * L.ls;
  const cx = bw / 2 + bw * (0.317 + L.lx * 0.2), cy = bh / 2 + (0.06 - L.ly * 0.4) * bh;
  const { px, cols, rows, nl, fps } = F, s = cell / px;

  const bandStyle = useAnimatedStyle(() => {
    const p = arrive(L.band, Math.max(0, clock.value));
    return { opacity: clock.value < 0 ? 0 : p.alpha, transform: [{ translateX: p.dx * bw }, { translateY: p.dy * bh }, { rotate: p.rot + 'deg' }, { scaleX: Math.max(0.001, p.sx) }, { scaleY: Math.max(0.001, p.sy) }] };
  }, [bw, bh, L]);
  const charStyle = useAnimatedStyle(() => {
    const p = arrive(L.char, Math.max(0, clock.value)), g = Math.max(0.001, Math.min(p.sx, p.sy));
    return { opacity: clock.value < 0 ? 0 : p.alpha, transform: [{ translateX: cx - cell / 2 + p.dx * bh * 0.8 }, { translateY: cy - cell / 2 + p.dy * bh * 0.8 }, { scale: g }] };
  }, [cx, cy, cell, bh, L]);
  const slide = useAnimatedStyle(() => {
    const c = Math.floor(Math.max(0, clock.value - L.char.delay) * fps) % nl;
    return { transform: [{ translateX: -(c % cols) * cell }, { translateY: -Math.floor(c / cols) * cell }] };
  }, [cell, L, F]);
  const wordStyle = useAnimatedStyle(() => {
    const p = arrive(L.word, Math.max(0, clock.value));
    return { opacity: clock.value < 0 ? 0 : p.alpha, transform: [{ translateX: p.dx * bw * 0.5 + (p.jit ? (Math.random() - 0.5) * 18 * p.jit : 0) }, { translateY: p.dy * bh * 0.5 }, { rotate: p.rot + 'deg' }, { scaleX: p.sx }, { scaleY: p.sy }] };
  }, [bw, bh, L]);

  return (
    <View style={[styles.fill, { backgroundColor: T.page }]} onLayout={onLayout}>
      {size.w > 0 ? (
        <>
          <Animated.View style={[{ position: 'absolute', left: bx, top: by, width: bw, height: bh, borderRadius: bh * L.tr, backgroundColor: T.band }, bandStyle]} />
          {/* him, kept inside the band like the lab's sparkles */}
          <View pointerEvents="none" style={{ position: 'absolute', left: bx, top: by, width: bw, height: bh, overflow: 'hidden', borderRadius: bh * L.tr }}>
            <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: cell, height: cell, overflow: 'hidden' }, charStyle]}>
              <Animated.Image source={F.sheet} resizeMode="stretch" fadeDuration={0} style={[{ width: cols * px * s, height: rows * px * s }, slide]} />
            </Animated.View>
          </View>
          {L.wshow ? (
            <Animated.Text
              style={[wordStyle, { position: 'absolute', left: bx + bh * 0.22, top: by + bh * 0.56 - fs * 0.78, fontSize: fs, lineHeight: fs * 1.05, color: T.word, fontStyle: fontsReady ? 'normal' : 'italic' },
                fontsReady ? { fontFamily: FONTS.serifItalic } : null]}
              numberOfLines={1}
              allowFontScaling={false}>
              Void Archive
            </Animated.Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
