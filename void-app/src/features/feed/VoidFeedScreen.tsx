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
import { BackHandler, FlatList, Pressable, RefreshControl, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import {
  FEED_MAX_AGE_H,
  FEED_SETTLE_MS,
  FEED_WINDOW,
  _rendered,
  allPosts,
  markEvicted,
  nextFeedBatch,
  onPostsChanged,
  peekFeedFresh,
  pullSupabasePosts,
  pullVoidFeed,
  rebuildFeedBatch,
  refreshVoidFeed,
  type Post,
} from '../../core';
import { timed } from '../../core/slow';
import { useTheme } from '../../theme/ThemeProvider';
import { FONTS, em } from '../../theme/palettes';
import { VText } from '../../ui/Text';
import { voidToast } from '../../ui/Toast';
import { ROUTES } from '../../nav/routes';
import { onTabReselect } from '../../nav/reselect';
import { ModerationHost } from './ModerationSheet';
import { PostCard } from './PostCard';
import { PtrFlash } from './PtrFlash';
import { isPostHidden, useModerationVersion, useTick } from './stores';
import { usePostViewability } from './viewability';
import { Masthead } from '../home/Masthead';
import { Mailbox } from '../home/Mailbox';
import { MailLayer } from '../home/MailLayer';
import { markAllSeen, pullNotifs, useNotifs } from '../home/notifs';
import { PollsLayer } from '../polls/PollsLayer';
import { WEB } from '../../theme/motion';

const hiddenFn = (p: Post) => isPostHidden(p);
type Status = 'idle' | 'scanning' | 'error' | 'stale';
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

  // SETTLE FIRST, THEN STAY LIVE (web renderFeed). The list used to be append-only
  // by arrival, so the fastest source - the Void backend, signed in - owned the top
  // for the whole session and a days-old drop sat above everything newer.
  //   settling (first FEED_SETTLE_MS, reader at the top): re-rank everything
  //   after:   posts newer than anything shown are HELD until pull-to-refresh -
  //            nothing is inserted under the reader
  const firstAt = useRef(dealt.length ? Date.now() - FEED_SETTLE_MS : 0);
  const atTop = useRef(true);
  const newest = useRef(0);
  useEffect(() => {
    const cap = Date.now() + 60000;
    for (const p of items) if ((p.time || 0) > newest.current && (p.time || 0) <= cap) newest.current = p.time || 0;
    if (items.length && !firstAt.current) firstAt.current = Date.now();
  }, [items]);
  const replaceAll = useCallback((batch: Post[]) => {
    setItems(batch);
    setStatus(batch.length || allPosts.length ? 'idle' : 'error');
  }, []);

  // renderFeed(): append whatever is fresh, then window the list.
  // `atEnd`: the reader scrolled to the bottom and asked for more. Appending there
  // inserts nothing above them, so nothing is held: the hold below kept every post
  // NEWER than the newest card for pull-to-refresh, and since almost every fresh
  // arrival is newer, the main feed stopped dead at ~20 cards while the nation feed
  // (no hold) kept scrolling. The hold still applies to background arrivals.
  const append = useCallback((atEnd = false) => timed('feed.append', () => {
    let held: Set<string> | undefined;
    if (dealt.length) {
      if (Date.now() - firstAt.current < FEED_SETTLE_MS) {
        if (atTop.current) {
          replaceAll(rebuildFeedBatch(hiddenFn));
          return;
        }
      } else if (!atEnd) {
        held = new Set(peekFeedFresh(hiddenFn).filter((p) => (p.time || 0) > newest.current).map((p) => p.id));
      }
    }
    const fresh = nextFeedBatch(hiddenFn, held);
    if (!fresh.length) {
      // Posts arrived, but every one is older than the feed's window. Say that instead
      // of sitting on SCANNING, which reads as a hung app.
      if (!dealt.length && allPosts.length) {
        const oldest = Date.now() - FEED_MAX_AGE_H * 3600000;
        if (!allPosts.some((p) => (p.time || 0) >= oldest)) setStatus('stale');
      }
      return;
    }
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
  }), [replaceAll]);

  const pull = useCallback(async () => {
    const res = await pullVoidFeed();
    if (!alive.current) return;
    if ((res === 'empty' || res === 'error') && !allPosts.length) setStatus('error');
    else append(true);
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
  // The masthead (THE⬡ + sections + mailbox) hides on scroll-down like the old
  // .bio-hud did, and while anything covers the feed: Polls' topic page or Suggest
  // sheet, Mail, or a route pushed over this tab (the thread overlay).
  const lastY = useRef(0);
  const [hdrOn, setHdrOn] = useState(true);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    atTop.current = y < 120;
    if (y < 24) {
      setHdrOn(true);
      lastY.current = y;
      return;
    }
    const d = y - lastY.current;
    if (Math.abs(d) < 6) return;
    setHdrOn(d <= 0);
    lastY.current = y;
  }, []);

  // ─── sections: Feed | Polls, and Mail ────────────────────────────────────
  const { width } = useWindowDimensions();
  // false while a route sits over this tab (the thread overlay, settings, a profile)
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const [section, setSection] = useState<'feed' | 'polls'>('feed');
  const [mailOpen, setMailOpen] = useState(false);
  const [pollsCovered, setPollsCovered] = useState(false);
  // the topic page and Suggest sheet own the bottom edge (composer / sheet), as the mock: no nav under them
  const nav = useNavigation();
  useEffect(() => {
    nav.setOptions({ tabBarStyle: pollsCovered ? { display: 'none' } : undefined });
  }, [nav, pollsCovered]);
  const pollsBack = useRef<() => boolean>(() => false);
  const { unread } = useNotifs();
  useEffect(() => {
    pullNotifs();
    const t = setInterval(pullNotifs, 90000);
    return () => clearInterval(t);
  }, []);
  const toggleMail = useCallback(() => {
    setMailOpen((o) => {
      if (!o) markAllSeen();
      return !o;
    });
  }, []);
  const behind = section === 'polls' || mailOpen;
  const recede = useSharedValue(0);
  useEffect(() => {
    recede.value = withTiming(behind ? 1 : 0, { duration: 320, easing: WEB.SHEET, reduceMotion: ReduceMotion.System });
  }, [behind, recede]);
  // feed layer behind Polls / Mail: translateX(-28%) + brightness(.45)
  const feedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -0.28 * width * recede.value }] }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: 0.55 * recede.value }));
  const mastHidden = !focused || mailOpen || pollsCovered || (section === 'feed' && !hdrOn);
  useEffect(() => {
    if (!focused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mailOpen) {
        setMailOpen(false);
        return true;
      }
      if (section === 'polls') {
        if (!pollsBack.current()) setSection('feed');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [focused, mailOpen, section]);

  // ─── pull-to-refresh ─────────────────────────────────────────────────────
  // The wash is shown by ONE shared-value write before any work starts, and hidden
  // by another when the work is done (web showPtrFlash(0) / hidePtrFlash): the
  // picture never waits on a React render while the feed rebuilds.
  const flash = useSharedValue(0);
  const onRefresh = useCallback(async () => {
    if (refreshing) return;
    flash.value = 1;
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
      flash.value = 0;
      if (alive.current) setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshing]);

  // Tapping THE VOID while already on it refreshes the feed, the same as a pull.
  useEffect(() => onTabReselect('void', () => { void onRefresh(); }), [onRefresh]);

  const retry = useCallback(() => {
    setStatus('scanning');
    pull();
  }, [pull]);

  const pairs = usePostViewability('feed');
  const renderItem = useCallback(({ item, index }: { item: Post; index: number }) => <PostCard post={item} index={index} surface="feed" />, []);

  const empty =
    status === 'stale' ? (
      <Pressable onPress={onRefresh} style={styles.lblBox}>
        <VText style={[styles.lbl, { color: colors.muted }]}>{'NOTHING IN THE LAST ' + FEED_MAX_AGE_H + 'H · TAP TO RETRY'}</VText>
      </Pressable>
    ) : status === 'error' ? (
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
      {/* HOW MUCH FEED STAYS ALIVE BEHIND YOU.

          windowSize 7 was measured at 162 MB of graphics memory and a UI thread at
          ~90%, so I cut it to 3. That is ONE SCREEN of runway either side, and it
          shows: scroll down past a few cards and back up, and the ones you passed
          have been unmounted and have to load again - streams included. The feed
          used to hold them.

          5 is two screens either side, which covers the scroll-back people actually
          do, at roughly two thirds of what 7 cost. The budget for it is real rather
          than hoped for: the app now measures 74 MB native and 36 MB of GL on this
          phone, against the 933 MB that was getting it killed, because the decoder
          caps and the image work landed in between. */}
      <Animated.View style={[styles.fill, feedStyle]}>
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
        windowSize={5}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={60}
        removeClippedSubviews
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
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, dimStyle]} />
      </Animated.View>

      <PollsLayer open={section === 'polls'} width={width} onCover={setPollsCovered} backRef={pollsBack} />
      <MailLayer open={mailOpen} width={width} />

      {/* the masthead: THE⬡ + the stagger icon that unfolds into Polls / Feed, and the mailbox */}
      <Masthead
        section={section}
        onSwitch={setSection}
        hidden={mastHidden}
        right={<Mailbox unread={unread > 0} open={mailOpen} onPress={toggleMail} hidden={!focused || pollsCovered || section === 'polls'} />}
      />

      {/* #compose-fab */}
      {!behind ? <Pressable
        onPress={() => router.push(ROUTES.composer as any)}
        accessibilityLabel="Compose"
        style={({ pressed }) => [styles.fab, { bottom: 88 + insets.bottom }, pressed && { opacity: 0.85 }]}
      >
        <LinearGradient colors={['#7c3aed', '#5b21d4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fabFill}>
          <VText style={styles.fabT}>+</VText>
        </LinearGradient>
      </Pressable> : null}

      {/* #ptr-flash: the sparkle wash, mounted for good, shown by a shared-value write */}
      <PtrFlash flash={flash} />

      <ModerationHost />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  lblBox: { paddingVertical: 48, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  lbl: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.15), textAlign: 'center' },
  fab: { position: 'absolute', right: 18, zIndex: 60, width: 52, height: 52, borderRadius: 26, boxShadow: '0px 8px 24px rgba(124,58,237,0.45)' },
  fabFill: { flex: 1, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  fabT: { fontFamily: FONTS.sans, fontSize: 24, lineHeight: 26, color: '#fff' },
});
