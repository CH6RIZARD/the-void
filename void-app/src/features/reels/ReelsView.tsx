// REELS — the immersive viewer engine (patch3 §5, ref 4d; B3). One engine, two hosts,
// exactly like the web's vwObserve(ctEl) driving both #greel-container and #reel-container:
//
//   inline  (globe tab, REELS mode)   fillGlobeReels / stopGlobeReels
//     .greel-sub "FOR YOU · SEEDED BY YOUR SIGNALS"  top:44px centred, 'Syne Mono' 7px .24em var(--nav-dim), z29
//     .greel-empty "PULLING SIGNAL…"  padding:120px 20px;'Syne Mono' 9px .2em var(--muted)
//     #greel-container .vw-rail{bottom:110px}
//   overlay (/reels route)             openReel(postId) / openNationReel(nation, postId) / closeReel
//     #reel-overlay{background:#000}
//     .reel-chrome{height:90px;padding:16px 16px 0;gap:12px;background:linear-gradient(rgba(0,0,0,.6),transparent);z10}
//     .reel-back{36px circle;rgba(13,8,32,.78) (coarse);inset 0 1px 0 rgba(255,255,255,.1)} .vi 17px
//     .reel-fortag{'Syne Mono' 8px .25em rgba(255,255,255,.75)} "FOR YOU"
//     .reel-counter{margin-left:auto;'Syne Mono' 8px rgba(255,255,255,.6) .15em} "n / ∞"
//     .vw-rail{bottom:130px}
//
// Paging: scroll-snap-type:y mandatory + scroll-snap-stop:always → FlatList snapToInterval
// (one full-height card per page) + disableIntervalMomentum (one card per swipe). vwObserve(threshold .5) → viewability 50%.
// Reels stay a dark media surface in every theme (LIGHT included).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Pressable, Share, StyleSheet, Text, View, type LayoutChangeEvent, type ViewToken } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VoidAPI, moderation, onPostsChanged, findPost } from '../../core';
import type { Post } from '../../core';
import { Icon } from '../../ui/icons';
import { SparkleLoader } from '../../ui/SparkleLoader';
import { voidToast } from '../../ui/Toast';
import { useTheme } from '../../theme/tokens';
import { FONTS, em } from '../../theme/palettes';
import { baseId } from '../search/format';
import { ReelItem, ReelPlaceholder } from './ReelItem';
import { ReelModSheet, type ModTarget } from './ReelModSheet';
import {
  appendMore,
  dwell,
  fillOpenReel,
  reelVisible,
  seedInline,
  seedNation,
  seedOpenReel,
  shareLink,
  toggleFollow,
  toggleRepost,
  useReelStoreVersion,
  vwFire,
  vwLess,
} from './reelStore';
import { useSafeClaimAudio } from './useSafeClaimAudio';

export interface ReelsViewProps {
  /** true while this surface is visible and focused (start/stop playback on it). */
  active: boolean;
  /** /reels?nation=ISO (or a country name): seed nation-first (openNationReel). */
  nation?: string;
  /** /reels?post=<id>: start on this post (openReel / openNationReel's postId). */
  postId?: string;
  /**
   * Full-screen overlay chrome (back, FOR YOU, counter; rail at 130px). Defaults to
   * true when `nation` or `postId` is given, false for the inline globe host.
   */
  overlay?: boolean;
  /** Overlay back button. Default router.back(). */
  onClose?: () => void;
}

/** Near the end when fewer than three screens remain below (ct.scrollTop + clientHeight*3 > scrollHeight). */
const nearEnd = (idx: number, len: number) => len - idx < 3;
/** The GLOBE-REELS slide is 340ms; players are built once it has landed, not under it. */
const ENTRY_HOLD_MS = 380;
/** Momentum end is the settle. This is only the net under it (a programmatic scroll, a missed event). */
const SETTLE_FALLBACK_MS = 700;
/** Nothing to show after this long: say NO SIGNAL and offer a retry (never a spinner forever). */
const STALL_MS = 12000;
const STALL_RETRY_MS = 15000;

export function ReelsView({ active, nation, postId, overlay: overlayProp, onClose }: ReelsViewProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const overlay = overlayProp ?? (!!nation || !!postId);
  const mode: 'inline' | 'nation' | 'open' = nation ? 'nation' : overlay && postId ? 'open' : 'inline';

  const [items, setItems] = useState<Post[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [pulling, setPulling] = useState(false); // .greel-empty
  const [h, setH] = useState(0);
  const [cur, setCur] = useState(0);
  const curRef = useRef(0);
  // THE SWIPE OWNS THE FRAME; EVERYTHING HEAVY WAITS FOR IT TO LAND.
  //
  // Measured on the lab phone (perfetto, six flicks): every swipe inflated a
  // media3 PlayerView on the main thread (~43ms each, 8 in 6 swipes), mounted a
  // whole card and released another, re-rendered every cell three times and ran
  // the ranker - all at the 50% mark, in the middle of the snap animation. The
  // card in view still changes at 50% (play / pause / sound follow the web), but
  // that is now a prop flip on two cards. `win` is the centre of the heavy
  // window - full cards and players for win±1 - and it moves only when the
  // scroll has settled, so mounts, releases and appends land on a still screen.
  const [win, setWin] = useState(0);
  const moving = useRef(false); // from drag start until the scroll settles
  const dragging = useRef(false); // a finger is down
  const wantAppend = useRef(false);
  const settleT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewed = useRef(new Set<string>()).current;
  const [cleared, setCleared] = useState<Record<string, true>>({});
  const [soundOn, setSoundOn] = useState(false);
  const [mod, setMod] = useState<ModTarget>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const storeVersion = useReelStoreVersion();
  const list = useRef<FlatList<Post>>(null);
  const audio = useSafeClaimAudio();

  const live = active && appActive;
  // Players wait for the slide (or the route push) that reveals this surface:
  // the cards are all there under it, the heavy part arrives once it has landed.
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    if (!live) {
      setWarm(false);
      return;
    }
    const t = setTimeout(() => setWarm(true), ENTRY_HOLD_MS);
    return () => clearTimeout(t);
  }, [live]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  const append = useCallback((add: Post[]) => {
    if (!add.length) return;
    setItems((prev) => {
      const have = new Set(prev.map((x) => x._vid));
      return prev.concat(add.filter((x) => !have.has(x._vid)));
    });
  }, []);

  const settle = useCallback(() => {
    moving.current = false;
    if (settleT.current) clearTimeout(settleT.current);
    settleT.current = null;
    setWin(curRef.current);
    if (wantAppend.current || nearEnd(curRef.current, itemsRef.current.length)) {
      wantAppend.current = false;
      append(appendMore());
    }
  }, [append]);
  const settleRef = useRef(settle);
  settleRef.current = settle;
  useEffect(() => () => { if (settleT.current) clearTimeout(settleT.current); }, []);

  // ── seeding ──────────────────────────────────────────────────────────
  const resetView = () => {
    setCur(0);
    setWin(0);
    curRef.current = 0;
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };
  // openNationReel / openReel: once per (nation, post).
  useEffect(() => {
    if (mode === 'inline') return;
    resetView();
    if (mode === 'nation') {
      setItems(seedNation(nation!, postId));
      setPulling(false);
      return;
    }
    if (mode === 'open') {
      const seeded = seedOpenReel(postId!);
      setItems(seeded);
      setPulling(!seeded.length);
      let alive = true;
      fillOpenReel().then((added) => {
        if (!alive) return;
        setPulling(false);
        append(added); // APPEND: never tear out the clip already playing
      });
      return () => {
        alive = false;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, nation, postId]);
  // fillGlobeReels(): runs when the inline surface becomes active; cards already
  // there are kept (the web only re-observes them), so returning never restarts.
  useEffect(() => {
    if (mode !== 'inline' || !live || itemsRef.current.length) return;
    resetView();
    const picks = seedInline();
    setItems(picks);
    setPulling(!picks.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, live]);

  // Empty inline surface: "PULLING SIGNAL…" then fill as soon as posts land.
  // Near the end with a dry pool: append once the reel pool tops up.
  useEffect(() => {
    return onPostsChanged((reason) => {
      if ((reason !== 'reels' && reason !== 'feed') || !live) return;
      if (!itemsRef.current.length) {
        if (mode !== 'inline') return;
        const picks = seedInline();
        if (picks.length) {
          setItems(picks);
          setPulling(false);
        }
        return;
      }
      if (!nearEnd(curRef.current, itemsRef.current.length)) return;
      // A fetch that lands under a finger waits for the settle.
      if (moving.current) wantAppend.current = true;
      else append(appendMore());
    });
  }, [mode, live, append]);

  // NEVER A PERMANENT SPINNER. Every source can fail (offline, a blocked media host,
  // a dry pool) and pullReelPage then returns without emitting anything, so the surface
  // used to sit on "PULLING SIGNAL…" for the rest of the session with nothing to tap.
  // After STALL_MS with nothing, it says so, retries by itself, and takes a tap.
  const [stalled, setStalled] = useState(false);
  const retry = useCallback(() => {
    const picks = seedInline();
    if (picks.length) {
      setItems(picks);
      setPulling(false);
      setStalled(false);
    }
    return picks.length > 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (mode !== 'inline' || !live || items.length) {
      setStalled(false);
      return;
    }
    const t = setTimeout(() => setStalled(true), STALL_MS);
    return () => clearTimeout(t);
  }, [mode, live, items.length]);
  useEffect(() => {
    if (!stalled) return;
    const iv = setInterval(retry, STALL_RETRY_MS);
    return () => clearInterval(iv);
  }, [stalled, retry]);

  // ── moderation sweep (hidden posts leave every surface) ────────────
  const sweep = useCallback(() => {
    setItems((prev) => prev.filter(reelVisible));
  }, []);

  // ── observation (vwObserve) ─────────────────────────────────────────
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const v = viewableItems.find((t) => t.isViewable && t.index != null);
    if (!v || v.index == null) return;
    const idx = v.index;
    if (idx === curRef.current) return;
    curRef.current = idx;
    setCur(idx);
    if (settleT.current) clearTimeout(settleT.current);
    // Never under a finger: a held drag settles on its own momentum end.
    settleT.current = setTimeout(() => {
      if (!dragging.current) settleRef.current();
    }, SETTLE_FALLBACK_MS);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  const current = items[cur];
  useEffect(() => {
    if (!current || !live) return;
    // counter / FOR YOU tag, dwell signal, play. (Spine fill is marked in
    // renderItem, in the same commit; the append rides the settle.)
    dwell(current);
    if (!moving.current && nearEnd(cur, items.length)) append(appendMore());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current && current._vid, live]);

  // ── sound: one audible source app-wide ─────────────────────────────
  const soundId = 'reels:' + (overlay ? 'overlay' : 'inline');
  const soundRef = useRef(false);
  soundRef.current = soundOn;
  // Ref, because useClaimAudio returns a new object each render - as a dep it
  // gave every card a new onToggleSound on every render and defeated their memo.
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const stopSound = useCallback(() => setSoundOn(false), []);
  const toggleSound = useCallback(() => {
    const next = !soundRef.current;
    if (next) audioRef.current?.claimAudio({ id: soundId, stop: stopSound });
    else audioRef.current?.releaseAudio(soundId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSoundOn(next);
  }, [soundId, stopSound]);
  // stopGlobeReels / closeReel: pause everything and give the slot back.
  useEffect(() => {
    if (!live && soundOn) {
      setSoundOn(false);
      audio?.releaseAudio(soundId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);
  // unmount (closeReel): give the slot back.
  useEffect(() => () => audioRef.current?.releaseAudio(soundId), [soundId]);

  // ── rail actions ────────────────────────────────────────────────────
  const onReply = useCallback((pid: string) => {
    const p = findPost(pid);
    if (p && moderation.hidden(p)) {
      voidToast('HIDDEN · BLOCKED OR REPORTED');
      return;
    }
    router.push(`/thread/${encodeURIComponent(pid)}` as any);
  }, []);
  const onShare = useCallback((pid: string) => {
    Haptics.selectionAsync().catch(() => {});
    Share.share({ message: shareLink(pid), url: shareLink(pid) }).catch(() => {});
    VoidAPI.share(pid).catch(() => voidToast('SIGNAL LOST · RETRY'));
  }, []);
  const onLess = useCallback(
    (item: Post, index: number) => {
      vwLess(item);
      if (index + 1 < itemsRef.current.length && h) list.current?.scrollToOffset({ offset: (index + 1) * h, animated: true });
    },
    [h],
  );
  const onMenu = useCallback((item: Post) => setMod({ kind: 'menu', post: item }), []);
  const onAuthor = useCallback((item: Post) => {
    const p = findPost(baseId(item.id)) || item;
    const a = moderation.authorOf(p);
    if (!a) {
      if (!p._user) voidToast('NO ACCOUNT TO SHOW');
      return;
    }
    setMod({ kind: 'author', post: item });
  }, []);
  const onLoaderCleared = useCallback((vid: string) => setCleared((c) => (c[vid] ? c : { ...c, [vid]: true })), []);

  const railBottom = overlay ? 130 : 110;

  const renderItem = useCallback(
    ({ item, index }: { item: Post; index: number }) => {
      // The heavy window: the card in view, and one each side of where the
      // scroll last settled. Anything further is a cover and a poster.
      const near = index === cur || Math.abs(index - win) <= 1;
      if (!near) return <ReelPlaceholder item={item} height={h} />;
      const k = item._vid || item.id;
      // Marked in the commit that shows the card, so the spine fill needs no second pass.
      if (live && index === cur) viewed.add(k);
      return (
      <ReelItem
        item={item}
        index={index}
        height={h}
        current={index === cur}
        want={live && index === cur}
        // THE HIDDEN SIDE HOLDS ZERO PLAYERS.
        //
        // Attached meant a player exists - the web's window: the card in view
        // plus two ahead, warming so the next flick is instant. That window
        // stayed open while the REELS side was hidden behind the globe, so
        // ExoPlayers sat attached and prepared on the side nobody was looking
        // at, holding decoders the wall under the globe was giving up tiles
        // for want of.
        //
        // Even the one warm current card was 1/8th of the VPU budget spent on
        // a nicety. Hidden now means cold: the current card shows its poster,
        // and the swipe to REELS creates its player on the paced queue - the
        // poster covers the ~0.5s to first frame, same as every cold reel.
        attached={live && warm}
        viewed={viewed.has(k)}
        railBottom={railBottom}
        soundOn={soundOn}
        surfaceActive={live}
        storeVersion={storeVersion}
        loaderCleared={!!cleared[item._vid || item.id]}
        onLoaderCleared={onLoaderCleared}
        onToggleSound={toggleSound}
        onFire={vwFire}
        onReply={onReply}
        onRepost={toggleRepost}
        onShare={onShare}
        onLess={onLess}
        onFollow={toggleFollow}
        onMenu={onMenu}
        onAuthor={onAuthor}
      />
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [h, cur, win, warm, live, railBottom, soundOn, storeVersion, cleared, toggleSound, onReply, onShare, onLess, onMenu, onAuthor],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => setH(Math.round(e.nativeEvent.layout.height)), []);
  const onDragStart = useCallback(() => {
    moving.current = true;
    dragging.current = true;
  }, []);
  const onDragEnd = useCallback(() => {
    dragging.current = false;
  }, []);
  const extra = useMemo(() => ({ cur, win, warm, live, soundOn, storeVersion, cleared, h }), [cur, win, warm, live, soundOn, storeVersion, cleared, h]);

  return (
    <View style={[styles.fill, { backgroundColor: overlay ? '#000' : '#05020e' }]} onLayout={onLayout}>
      {h > 0 && items.length ? (
        <FlatList
          ref={list}
          data={items}
          keyExtractor={(p) => p._vid || p.id}
          renderItem={renderItem}
          extraData={extra}
          snapToInterval={h}
          snapToAlignment="start"
          disableIntervalMomentum
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
          getItemLayout={(_d, index) => ({ length: h, offset: h * index, index })}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={viewabilityConfig}
          onScrollBeginDrag={onDragStart}
          onScrollEndDrag={onDragEnd}
          onMomentumScrollEnd={settle}
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
        />
      ) : pulling || (!items.length && mode === 'inline') ? (
        overlay ? (
          // openReel with nothing seeded: the video surface shows the original sparkle/float
          <SparkleLoader surface="media" label="" />
        ) : stalled ? (
          <Pressable onPress={retry} hitSlop={16}>
            <Text allowFontScaling={false} style={[styles.empty, { color: colors.muted }]}>
              NO SIGNAL · TAP TO RETRY
            </Text>
          </Pressable>
        ) : (
          <Text allowFontScaling={false} style={[styles.empty, { color: colors.muted }]}>
            PULLING SIGNAL{'…'}
          </Text>
        )
      ) : null}

      {overlay ? (
        <View style={[styles.chrome, { height: 90 + insets.top, paddingTop: 16 + insets.top }, { experimental_backgroundImage: 'linear-gradient(rgba(0,0,0,0.6), transparent)' } as any]} pointerEvents="box-none">
          <Pressable
            onPress={() => (onClose ? onClose() : router.back())}
            style={({ pressed }) => [styles.back, { opacity: pressed ? 0.72 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={9}
          >
            <Icon name="back" size={17} color="#f4f0ff" />
          </Pressable>
          <Text allowFontScaling={false} style={styles.fortag}>
            FOR YOU
          </Text>
          <Text allowFontScaling={false} style={styles.counter}>
            {items.length ? `${cur + 1} / ∞` : ''}
          </Text>
        </View>
      ) : (
        // .greel-sub
        <View pointerEvents="none" style={styles.sub}>
          <Text allowFontScaling={false} style={[styles.subText, { color: colors.navDim }]}>
            FOR YOU · SEEDED BY YOUR SIGNALS
          </Text>
        </View>
      )}

      <ReelModSheet target={mod} onClose={() => setMod(null)} onChanged={sweep} />
    </View>
  );
}

export default ReelsView;

const styles = StyleSheet.create({
  fill: { flex: 1, overflow: 'hidden' },
  empty: { paddingVertical: 120, paddingHorizontal: 20, textAlign: 'center', fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.2) },
  chrome: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(13,8,32,0.78)',
    boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  } as any,
  fortag: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.25), color: 'rgba(255,255,255,0.75)' },
  counter: { marginLeft: 'auto', fontFamily: FONTS.mono, fontSize: 8, color: 'rgba(255,255,255,0.6)', letterSpacing: em(8, 0.15) },
  sub: { position: 'absolute', top: 44, left: 0, right: 0, alignItems: 'center', zIndex: 29 },
  subText: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.24) },
});
