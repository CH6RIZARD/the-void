// VOID tab — #screen-void + #void-feed + .bio-hud wordmark + #compose-fab (void2-final.html).
//
//   .bio-hud{position:fixed;top:0;left:0;padding:14px 18px 10px;pointer-events:none;transition:opacity .22s,transform .22s}
//   .bio-logo{font-weight:800;font-size:15px;letter-spacing:.14em}  span(⬡){color:var(--gold)}
//   .hdr-hide{opacity:0;transform:translateY(-100%)}   autoHideHeader: <24 shown, |d|<6 ignored, down hides
//   .void-feed{padding:46px 0 90px}
//   #compose-fab{bottom:88px;right:18px;52x52;linear-gradient(135deg,#7c3aed,#5b21d4);"+" 24px #fff;box-shadow:0 8px 24px rgba(124,58,237,.45)}
//
// Feed model = the web's append-only renderFeed: posts on screen keep their place,
// only new arrivals are ranked (nextFeedBatch) and appended; refresh rebuilds with the
// new pull leading; the list windows old rows away past FEED_WINDOW (90 + 30 slack).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  FEED_WINDOW,
  _rendered,
  allPosts,
  markEvicted,
  nextFeedBatch,
  onPostsChanged,
  pullSupabasePosts,
  pullVoidFeed,
  refreshVoidFeed,
  type Post,
} from '../../core';
import { useTheme } from '../../theme/ThemeProvider';
import { FONTS, em } from '../../theme/palettes';
import { SparkleLoader } from '../../ui/SparkleLoader';
import { VText } from '../../ui/Text';
import { voidToast } from '../../ui/Toast';
import { ROUTES } from '../../nav/routes';
import { ModerationHost } from './ModerationSheet';
import { PostCard } from './PostCard';
import { isPostHidden, useModerationVersion, useTick } from './stores';
import { usePostViewability } from './viewability';

const EASE = Easing.bezier(0.25, 0.1, 0.25, 1);
const hiddenFn = (p: Post) => isPostHidden(p);
type Status = 'idle' | 'scanning' | 'error';
// The list outlives a remount of the tab (the web's #void-feed DOM did): nextFeedBatch
// only ever hands a post out once, so what was already dealt is kept here.
let dealt: Post[] = [];

export default function VoidFeedScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const modVersion = useModerationVersion();
  useTick(30000); // ago() labels

  const [items, setItems] = useState<Post[]>(() => (dealt = dealt.concat(nextFeedBatch(hiddenFn))));
  useEffect(() => {
    dealt = items;
  }, [items]);
  const [status, setStatus] = useState<Status>(() => (allPosts.length ? 'idle' : 'scanning'));
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef<FlatList<Post>>(null);
  const alive = useRef(true);

  // renderFeed(): append whatever is fresh, then window the list.
  const append = useCallback(() => {
    const fresh = nextFeedBatch(hiddenFn);
    if (!fresh.length) return;
    setItems((cur) => {
      let next = cur.concat(fresh);
      if (next.length > FEED_WINDOW.max + FEED_WINDOW.trim) {
        const drop = next.slice(0, next.length - FEED_WINDOW.max);
        const ids = drop.map((p) => p.id);
        ids.forEach((id) => _rendered.delete(id));
        markEvicted(ids);
        next = next.slice(drop.length);
      }
      return next;
    });
    setStatus('idle');
  }, []);

  const pull = useCallback(async () => {
    const res = await pullVoidFeed();
    if (!alive.current) return;
    if ((res === 'empty' || res === 'error') && !allPosts.length) setStatus('error');
    else append();
  }, [append]);

  useEffect(() => {
    alive.current = true;
    const off = onPostsChanged((reason) => {
      if (reason === 'feed') append();
    });
    pullSupabasePosts().catch(() => {});
    pull();
    return () => {
      alive.current = false;
      off();
    };
  }, [append, pull]);

  // VMod sweep: a block / report / mute removes matching cards at once.
  const visible = useMemo(() => items.filter((p) => !isPostHidden(p)), [items, modVersion]);

  // ─── header auto-hide ────────────────────────────────────────────────────
  const hdr = useSharedValue(1);
  const lastY = useRef(0);
  const hdrShown = useRef(true);
  const setHdr = (on: boolean) => {
    if (hdrShown.current === on) return;
    hdrShown.current = on;
    hdr.value = withTiming(on ? 1 : 0, { duration: 220, easing: EASE });
  };
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    if (y < 24) {
      setHdr(true);
      lastY.current = y;
      return;
    }
    const d = y - lastY.current;
    if (Math.abs(d) < 6) return;
    setHdr(d <= 0);
    lastY.current = y;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [hdrH, setHdrH] = useState(44 + insets.top);
  const hdrStyle = useAnimatedStyle(() => ({ opacity: hdr.value, transform: [{ translateY: -(1 - hdr.value) * hdrH }] }));

  // ─── pull-to-refresh ─────────────────────────────────────────────────────
  const onRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    try {
      const batch = await refreshVoidFeed(hiddenFn);
      if (batch && alive.current) {
        setItems(batch);
        setStatus(batch.length || allPosts.length ? 'idle' : 'error');
      }
    } catch {
      voidToast('SIGNAL LOST · RETRY');
    } finally {
      if (alive.current) setRefreshing(false);
    }
  }, [refreshing]);

  const retry = useCallback(() => {
    setStatus('scanning');
    pull();
  }, [pull]);

  const pairs = usePostViewability('feed');
  const renderItem = useCallback(({ item, index }: { item: Post; index: number }) => <PostCard post={item} index={index} surface="feed" />, []);

  const empty =
    status === 'error' ? (
      <Pressable onPress={retry} style={styles.lblBox}>
        <VText style={[styles.lbl, { color: colors.muted }]}>NO VERIFIED SIGNAL — CHECK CONNECTION AND RETRY · TAP TO RETRY</VText>
      </Pressable>
    ) : (
      <View style={styles.lblBox}>
        <VText style={[styles.lbl, { color: colors.muted }]}>SCANNING VERIFIED PUBLIC SOURCES…</VText>
      </View>
    );

  return (
    <View style={[styles.fill, { backgroundColor: 'transparent' }]}>
      <FlatList
        ref={listRef}
        data={visible}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        viewabilityConfigCallbackPairs={pairs}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onEndReached={pull}
        onEndReachedThreshold={1.2}
        ListEmptyComponent={empty}
        contentContainerStyle={{ paddingTop: 46 + insets.top, paddingBottom: 90 + 58 + insets.bottom }}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        windowSize={7}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        removeClippedSubviews={false}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="transparent"
            colors={['transparent']}
            progressBackgroundColor="transparent"
            progressViewOffset={insets.top}
          />
        }
      />

      {/* .bio-hud — the mark, not a header bar */}
      <Animated.View
        pointerEvents="none"
        onLayout={(e) => setHdrH(e.nativeEvent.layout.height)}
        style={[styles.hud, { paddingTop: 14 + insets.top }, hdrStyle]}
      >
        <VText style={[styles.logo, { color: colors.white }]}>
          THE<VText style={[styles.logo, { color: colors.gold }]}>⬡</VText>
        </VText>
      </Animated.View>

      {/* #compose-fab */}
      <Pressable
        onPress={() => router.push(ROUTES.composer as any)}
        accessibilityLabel="Compose"
        style={({ pressed }) => [styles.fab, { bottom: 88 + insets.bottom }, pressed && { opacity: 0.85 }]}
      >
        <LinearGradient colors={['#7c3aed', '#5b21d4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fabFill}>
          <VText style={styles.fabT}>+</VText>
        </LinearGradient>
      </Pressable>

      {/* #ptr-flash: sparkle wash while a refresh is running */}
      {refreshing ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 90 }]}>
          <SparkleLoader label="REFRESHING" style={{ backgroundColor: 'rgba(3,1,10,0.85)' }} />
        </View>
      ) : null}

      <ModerationHost />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hud: { position: 'absolute', top: 0, left: 0, zIndex: 60, paddingHorizontal: 18, paddingBottom: 10, flexDirection: 'row', alignItems: 'center' },
  logo: { fontFamily: FONTS.sansExtraBold, fontSize: 15, letterSpacing: em(15, 0.14) },
  lblBox: { paddingVertical: 48, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  lbl: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.15), textAlign: 'center' },
  fab: { position: 'absolute', right: 18, zIndex: 60, width: 52, height: 52, borderRadius: 26, boxShadow: '0px 8px 24px rgba(124,58,237,0.45)' },
  fabFill: { flex: 1, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  fabT: { fontFamily: FONTS.sans, fontSize: 24, lineHeight: 26, color: '#fff' },
});
