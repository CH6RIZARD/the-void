// PHOTO VIEWER — native port of the web #photo-overlay / openPhoto / closePhoto /
// initPhotoSwipe. Route: /photo?id=<postId>&i=<index>.
//
//   #photo-overlay{position:fixed;inset:0;z-index:125;background:rgba(2,1,8,.97);flex column;center;gap:16px;padding:24px 20px}
//     (LIGHT keeps the dark media surface: background #05020e, color #f4f0ff)
//   .photo-strip  scroll-snap x, one .photo-cell (padding 0 8px) per image of p._imgs || [p._img]
//   .photo-cell img{max-width:100%;max-height:72vh;object-fit:contain;border-radius:14px} + IMG_LOADER (orbit)
//   .photo-dots i{5x5;rgba(244,240,255,.28)} .on{gold; scale 1.35}  (only when >1 slide)
//   .photo-cap{'Syne' 13px/1.5 #cfc3ee;center;max-width 600;max-height 22vh scroll}
//   .photo-thread{gap 7;margin-top 16;padding 9x18;radius 22;'Syne Mono' 8px .18em #f4f0ff;
//     linear-gradient(135deg,#7c3aed,#5b21d4);shadow 0 4 14 rgba(124,58,237,.4)}  "↩ OPEN THREAD"
//   .photo-src{'Syne Mono' 8px .15em #6a58a0;margin-top 14}  "<host> · N SLIDES · SWIPE DOWN TO CLOSE"
//   .photo-close{top:16px;left:16px;34x34;color #6a58a0;x icon 18}
//   Swipe: axis locks after 8px; |dy| > |dx|*1.2 is vertical (dismiss), else the strip owns it.
//     downward follows, upward resists (x.35); opacity 1-|damp|/500; release past 110px closes.
//   openPhoto also runs vwBump(p.tags, .3).
//
// Native additions asked for on top of the web: an "i / N" counter, pinch-zoom and
// double-tap zoom per image, share through the native sheet, the ⋯ moderation menu,
// and the graphic veil (blurred + GRAPHIC CONTENT until tapped).
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { findPost, moderation, VoidAPI, vwBump, type Post } from '../../core';
import { ImageOrbitLoader } from '../../ui/ImageOrbitLoader';
import { VText } from '../../ui/Text';
import { Icon } from '../../ui/icons';
import { voidToast } from '../../ui/Toast';
import { FONTS, em } from '../../theme/palettes';
import { ModerationHost, openPostMenu } from '../feed/ModerationSheet';
import { openThreadRoute } from '../feed/navigation';
import { isPostHidden, useModerationVersion } from '../feed/stores';
import { GraphicVeil, VeilDim } from '../feed/media/GraphicVeil';
import { VmodIcon } from '../feed/vmodIcons';

const GOLD = '#c9a84c';
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const DISMISS_PX = 110;

function slidesOf(p: Post | null | undefined): string[] {
  if (!p) return [];
  return ((p._imgs && p._imgs.length ? p._imgs : [p._img]) as Array<string | undefined>).filter(Boolean) as string[];
}

export default function PhotoViewer() {
  const params = useLocalSearchParams<{ id?: string; i?: string }>();
  const postId = params.id ? decodeURIComponent(String(params.id)) : '';
  const startIdx = Math.max(0, parseInt(String(params.i || '0'), 10) || 0);
  const p = useMemo(() => (postId ? findPost(postId) : null), [postId]);
  const slides = useMemo(() => slidesOf(p), [p]);
  const n = slides.length;
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [k, setK] = useState(Math.min(startIdx, Math.max(0, n - 1)));
  const kRef = useRef(k);
  const [zoomed, setZoomed] = useState(false);
  const zoomedSV = useSharedValue(0);
  const [revealed, setRevealed] = useState(false);
  const veiled = !!p && !revealed && moderation.graphicVeilOn() && moderation.isGraphic(p);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/void' as any);
  }, []);

  // Nothing to show (post gone / no images): the web returned before opening.
  useEffect(() => {
    if (!p || !n) close();
    else if (p.tags) {
      try {
        vwBump(p.tags, 0.3);
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A block / report / hide from the ⋯ menu removes the post everywhere: close.
  const modV = useModerationVersion();
  useEffect(() => {
    if (modV && p && isPostHidden(p)) close();
  }, [modV, p, close]);

  // ── swipe down to dismiss (initPhotoSwipe) ─────────────────────────────
  const dragY = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const dismiss = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => {
      const t = e.allTouches[0];
      if (t) {
        sx.value = t.absoluteX;
        sy.value = t.absoluteY;
      }
    })
    .onTouchesMove((e, state) => {
      if (zoomedSV.value || e.numberOfTouches !== 1) {
        state.fail();
        return;
      }
      const t = e.allTouches[0];
      if (!t) return;
      const ddx = t.absoluteX - sx.value;
      const ddy = t.absoluteY - sy.value;
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      if (Math.abs(ddy) > Math.abs(ddx) * 1.2) state.activate();
      else state.fail(); // horizontal belongs to the slide strip
    })
    .onUpdate((e) => {
      const dy = e.translationY;
      dragY.value = dy < 0 ? dy * 0.35 : dy; // upward drag resists, downward follows
    })
    .onEnd((e) => {
      if (Math.abs(e.translationY) > DISMISS_PX) {
        runOnJS(close)();
      } else {
        dragY.value = withTiming(0, { duration: 220 });
      }
    });

  const bgStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - Math.abs(dragY.value) / 500) }));
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
    opacity: Math.max(0, 1 - Math.abs(dragY.value) / 500),
  }));

  const onZoomChange = useCallback(
    (z: boolean) => {
      zoomedSV.value = z ? 1 : 0;
      setZoomed(z);
    },
    [zoomedSV],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const w = e.nativeEvent.layoutMeasurement.width || 1;
      const next = Math.round(e.nativeEvent.contentOffset.x / w);
      if (next !== kRef.current) {
        kRef.current = next;
        setK(next);
      }
    },
    [],
  );

  const share = useCallback(async () => {
    if (!p) return;
    const img = slides[kRef.current] || slides[0];
    const url = p.sourceUrl || p._url || img || `https://void-app-d35c.pages.dev/#${p.id}`;
    try {
      await Share.share(Platform.OS === 'ios' ? { url, message: p.body ? String(p.body).slice(0, 200) : undefined } : { message: url });
    } catch {}
    VoidAPI.share(p.id).catch(() => voidToast('SIGNAL LOST · RETRY'));
  }, [p, slides]);

  if (!p || !n) return <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(2,1,8,0.97)' }]} />;

  const mediaH = Math.round(H * 0.72);
  const host = (p.provenance && p.provenance.sourceHost) || p.source || 'void';
  const srcLine = `${String(host)}${n > 1 ? ` · ${n} SLIDES` : ''} · SWIPE DOWN TO CLOSE`.toUpperCase();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.bg, bgStyle]} />
      <GestureDetector gesture={dismiss}>
        <Animated.View style={[styles.fill, contentStyle]}>
          {/* backdrop tap closes (web onclick on #photo-overlay) */}
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close photo" />
          <View style={[styles.center, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]} pointerEvents="box-none">
            <View style={{ width: W, height: mediaH }}>
              <FlatList
                data={slides}
                keyExtractor={(u, i) => u + i}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={Math.min(startIdx, n - 1)}
                getItemLayout={(_, i) => ({ length: W, offset: W * i, index: i })}
                onScroll={onScroll}
                scrollEventThrottle={16}
                scrollEnabled={!zoomed && !veiled && n > 1}
                windowSize={3}
                initialNumToRender={Math.min(n, startIdx + 2)}
                renderItem={({ item, index }) => (
                  <ZoomCell
                    uri={item}
                    width={W}
                    height={mediaH}
                    active={index === k}
                    veiled={veiled}
                    zoomedSV={zoomedSV}
                    onZoomChange={onZoomChange}
                    onReveal={() => setRevealed(true)}
                  />
                )}
              />
            </View>
            {n > 1 ? (
              <View style={styles.dots} pointerEvents="none">
                {slides.map((_, i) => (
                  <View key={i} style={[styles.dot, i === k ? styles.dotOn : null]} />
                ))}
              </View>
            ) : null}
            <View style={styles.capWrap} pointerEvents="box-none">
              {p.body ? (
                <ScrollView style={{ maxHeight: Math.round(H * 0.22) }} contentContainerStyle={styles.capInner}>
                  <VText style={styles.cap}>{String(p.body)}</VText>
                </ScrollView>
              ) : null}
              <Pressable
                onPress={() => {
                  close();
                  setTimeout(() => openThreadRoute(p.id), 60);
                }}
                style={({ pressed }) => [styles.threadBtn, { opacity: pressed ? 0.72 : 1 }]}
                accessibilityRole="button"
              >
                <Icon name="reply" size={13} color="#f4f0ff" />
                <VText style={styles.threadT}>OPEN THREAD</VText>
              </Pressable>
              <VText style={styles.src}>{srcLine}</VText>
            </View>
          </View>
        </Animated.View>
      </GestureDetector>

      {/* chrome stays put while the content drags */}
      <Pressable
        onPress={close}
        hitSlop={10}
        style={({ pressed }) => [styles.close, { top: insets.top + 16, opacity: pressed ? 0.72 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <Icon name="x" size={18} color="#6a58a0" />
      </Pressable>
      {n > 1 ? (
        <View pointerEvents="none" style={[styles.counter, { top: insets.top + 22 }]}>
          <VText style={styles.counterT}>{`${Math.min(k + 1, n)} / ${n}`}</VText>
        </View>
      ) : null}
      <View style={[styles.actions, { top: insets.top + 16 }]}>
        <Pressable onPress={share} hitSlop={8} style={({ pressed }) => [styles.action, { opacity: pressed ? 0.72 : 1 }]} accessibilityLabel="Share">
          <Icon name="share" size={17} color="#cfc3ee" />
        </Pressable>
        <Pressable onPress={() => openPostMenu(p)} hitSlop={8} style={({ pressed }) => [styles.action, { opacity: pressed ? 0.72 : 1 }]} accessibilityLabel="More">
          <VmodIcon name="more" size={18} color="#cfc3ee" />
        </Pressable>
      </View>
      <ModerationHost />
    </View>
  );
}

// ─── one image: orbit loader, contain fit, pinch / double-tap / pan-when-zoomed ─────
const ZoomCell = memo(function ZoomCell({
  uri,
  width,
  height,
  active,
  veiled,
  zoomedSV,
  onZoomChange,
  onReveal,
}: {
  uri: string;
  width: number;
  height: number;
  active: boolean;
  veiled: boolean;
  zoomedSV: SharedValue<number>;
  onZoomChange(z: boolean): void;
  onReveal(): void;
}) {
  const [shown, setShown] = useState(false);
  const [dead, setDead] = useState(false);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const base = useSharedValue({ s: 1, x: 0, y: 0, ox: 0, oy: 0 });
  // The strip cell has 8px side padding; the image box is inside it.
  const boxW = width - 16;
  const boxH = height;

  // Paging away resets the zoom of the slide left behind.
  useEffect(() => {
    if (active) return;
    scale.value = 1;
    tx.value = 0;
    ty.value = 0;
  }, [active, scale, tx, ty]);

  const clampT = (s: number, x: number, y: number) => {
    'worklet';
    const mx = Math.max(0, (boxW * s - boxW) / 2);
    const my = Math.max(0, (boxH * s - boxH) / 2);
    return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  };
  const settle = (s: number, x: number, y: number) => {
    'worklet';
    const ns = Math.min(MAX_SCALE, Math.max(1, s));
    const c = clampT(ns, x, y);
    scale.value = withTiming(ns, { duration: 180 });
    tx.value = withTiming(ns === 1 ? 0 : c.x, { duration: 180 });
    ty.value = withTiming(ns === 1 ? 0 : c.y, { duration: 180 });
    const z = ns > 1.01;
    if ((zoomedSV.value === 1) !== z) runOnJS(onZoomChange)(z);
  };

  const pinch = Gesture.Pinch()
    .enabled(!veiled && !dead)
    .onStart((e) => {
      base.value = { s: scale.value, x: tx.value, y: ty.value, ox: e.focalX - boxW / 2, oy: e.focalY - boxH / 2 };
      if (zoomedSV.value !== 1) runOnJS(onZoomChange)(true);
    })
    .onUpdate((e) => {
      const b = base.value;
      const s = Math.min(MAX_SCALE * 1.2, Math.max(0.7, b.s * e.scale));
      const r = s / b.s;
      scale.value = s;
      tx.value = b.ox - (b.ox - b.x) * r;
      ty.value = b.oy - (b.oy - b.y) * r;
    })
    .onEnd(() => {
      settle(scale.value, tx.value, ty.value);
    });

  const pan = Gesture.Pan()
    .enabled(!veiled && !dead)
    .manualActivation(true)
    .onTouchesMove((_e, state) => {
      if (scale.value > 1.01) state.activate();
      else state.fail();
    })
    .onStart(() => {
      base.value = { s: scale.value, x: tx.value, y: ty.value, ox: 0, oy: 0 };
    })
    .onUpdate((e) => {
      const b = base.value;
      tx.value = b.x + e.translationX;
      ty.value = b.y + e.translationY;
    })
    .onEnd(() => {
      settle(scale.value, tx.value, ty.value);
    });

  const doubleTap = Gesture.Tap()
    .enabled(!veiled && !dead)
    .numberOfTaps(2)
    .maxDelay(260)
    .onEnd((e, ok) => {
      if (!ok) return;
      if (scale.value > 1.01) {
        settle(1, 0, 0);
      } else {
        const s = DOUBLE_TAP_SCALE;
        const ox = e.x - boxW / 2;
        const oy = e.y - boxH / 2;
        settle(s, -ox * (s - 1), -oy * (s - 1));
      }
    });

  const gesture = Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));

  const imgStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <View style={{ width, height, paddingHorizontal: 8 }}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.box, { width: boxW, height: boxH }]} collapsable={false}>
          {!dead ? (
            <Animated.View style={[StyleSheet.absoluteFill, imgStyle]}>
              <Image
                source={{ uri }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={0}
                blurRadius={veiled ? 32 : 0}
                onDisplay={() => setShown(true)}
                onError={() => {
                  setShown(true);
                  setDead(true);
                }}
              />
            </Animated.View>
          ) : (
            <View style={styles.failBox}>
              <VText style={styles.failT}>MEDIA FAILED</VText>
            </View>
          )}
          {!shown && !dead ? <ImageOrbitLoader radius={14} /> : null}
          {veiled ? (
            <Pressable style={StyleSheet.absoluteFill} onPress={onReveal} accessibilityLabel="Reveal graphic content">
              <VeilDim />
              <GraphicVeil />
            </Pressable>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  fill: { flex: 1 },
  bg: { backgroundColor: 'rgba(2,1,8,0.97)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  box: { borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  failBox: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  failT: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.15), color: '#6a58a0' },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: -6 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(244,240,255,0.28)' },
  dotOn: { backgroundColor: GOLD, transform: [{ scale: 1.35 }] },
  capWrap: { alignItems: 'center', paddingHorizontal: 20, maxWidth: 600 },
  capInner: { alignItems: 'center' },
  cap: { fontFamily: FONTS.sans, fontSize: 13, lineHeight: 13 * 1.5, color: '#cfc3ee', textAlign: 'center' },
  threadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 16,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: '#6a2ee0',
    experimental_backgroundImage: 'linear-gradient(135deg, #7c3aed, #5b21d4)',
    boxShadow: '0px 4px 14px rgba(124,58,237,0.4)',
  } as any,
  threadT: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.18), color: '#f4f0ff' },
  src: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.15), color: '#6a58a0', marginTop: 14, textAlign: 'center' },
  close: { position: 'absolute', left: 16, width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  counter: { position: 'absolute', left: 60, right: 60, alignItems: 'center' },
  counterT: { fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.15), color: '#cfc3ee' },
  actions: { position: 'absolute', right: 12, flexDirection: 'row', gap: 4 },
  action: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
});
