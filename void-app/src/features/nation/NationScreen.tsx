// NATION — native port of the web #c-overlay (patch3 §6, 7e Cinema LIVE, original skin).
// Route: app/nation/[iso].tsx → <NationScreen iso={iso} />  (upper-case ISO from core C).
//
// One scrolling column (.c-body) under the fixed .c-overlay-head:
//   .cn-cta-head  FOR YOU · RANKED FOR <NATION> ───── TAP → REELS
//   .nation-hero  StreamTile walking nationStreamSources(c)
//   .nation-cards TRENDING / ABOUT <ISO>
//   .cn-feed-lbl  THE FEED · <NATION> ───── SCROLL ↓
//   #cpane-feed   the infinite nation feed (PostCard), .nf-status / .nf-more, 80px tail
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View, type ListRenderItemInfo } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, moderation, nationCards, regionOf } from '../../core';
import type { Country, Post } from '../../core/types';
import { useAudioOwner } from '../live/AudioOwner';
import PostCard from '../feed/PostCard';
import { usePostViewability } from '../feed/viewability';
import { FeedMore, FeedStatusLine, LabelRow, OverlayHead, OverlaySkin } from './NationChrome';
import { NationCards } from './NationCards';
import { NATION_HERO_TILE_ID, NationHero } from './NationHero';
import { useNationFeed } from './useNationFeed';

export interface NationScreenProps {
  iso: string;
}

/** A new ISO is a new nation: remount so every token / timer / feed state starts clean. */
export default function NationScreen({ iso }: NationScreenProps) {
  const ISO = String(iso || '').toUpperCase();
  return <NationView key={ISO} iso={ISO} />;
}

function countryFor(iso: string): Country {
  // openCountry: C.find(...) || {n:name, iso:'??', lat:0, lon:0}
  return (C.find((x) => x.iso === iso) as Country | undefined) || { n: iso, iso: '??', lat: 0, lon: 0, sr: null };
}

const VIEWABILITY = { itemVisiblePercentThreshold: 1, minimumViewTime: 0 };

function NationView({ iso }: { iso: string }) {
  const c = useMemo(() => countryFor(iso), [iso]);
  const N = (c.n || '').toUpperCase();
  const insets = useSafeAreaInsets();
  const audio = useAudioOwner();

  // renderNationCTA(c): on open, and again whenever posts land / a pull settles.
  const [ctaTick, setCtaTick] = useState(0);
  const bumpCta = useCallback(() => setCtaTick((t) => t + 1), []);
  const cards = useMemo(() => nationCards(c), [c, ctaTick]);

  const feed = useNationFeed(c, bumpCta);
  // Video play-on-view + dwell/impressions (feed contract) combined with the nation feed's own
  // viewability callback: RN allows only one of onViewableItemsChanged / callback pairs.
  const postPairs = usePostViewability('nation');
  const onNationViewable = feed.onViewableItemsChanged;
  const viewPairs = useRef([...postPairs, { viewabilityConfig: VIEWABILITY, onViewableItemsChanged: onNationViewable }]).current;

  // Moderation: hidden() is re-read when the screen regains focus (report / block sheets).
  const [modTick, setModTick] = useState(0);
  useFocusEffect(useCallback(() => setModTick((t) => t + 1), []));
  const visible = useMemo(() => feed.posts.filter((p) => !moderation.hidden(p)), [feed.posts, modTick]);

  const openReels = useCallback((postId?: string) => {
    // openNationReel(nation, postId): the reel queue is seeded nation-first.
    router.push({ pathname: '/reels', params: postId ? { nation: c.iso, post: postId } : { nation: c.iso } } as any);
  }, [c.iso]);
  const openThread = useCallback((id: string) => router.push(`/thread/${encodeURIComponent(id)}` as any), []);

  const close = useCallback(() => {
    // closeOverlay(): the hero / feed teardown runs in their unmount effects.
    // releaseStream(id) is a no-op unless this hero owns the sound.
    audio.releaseStream(NATION_HERO_TILE_ID);
    if (router.canGoBack()) router.back();
    else router.replace('/globe' as any);
  }, [audio]);
  const releaseRef = useRef(audio.releaseStream);
  releaseRef.current = audio.releaseStream;
  useEffect(() => () => releaseRef.current(NATION_HERO_TILE_ID), []);

  const header = useMemo(
    () => (
      <View onLayout={(e) => feed.onHeaderLayout(e.nativeEvent.layout.height)}>
        <LabelRow kind="cta" text={`FOR YOU · RANKED FOR ${N}`} tail={'TAP → REELS'} />
        <NationHero c={c} onOpenReels={openReels} />
        <NationCards iso={c.iso} trending={cards.trending} about={cards.about} onOpen={openReels} />
        <LabelRow kind="feed" text={`THE FEED · ${N}`} tail={'SCROLL ↓'} />
      </View>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, N, cards, openReels],
  );

  const footer = (
    <View style={styles.paneTail}>
      {feed.status && !feed.posts.length ? <FeedStatusLine text={feed.status.text} onPress={feed.status.retry ? feed.retryNow : undefined} /> : null}
      {feed.more ? <FeedMore /> : null}
    </View>
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Post>) => (
      <View onTouchStart={() => feed.warmTouch(item)}>
        <PostCard post={item} index={index} onOpenThread={openThread} />
      </View>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openThread],
  );

  return (
    <View style={styles.overlay}>
      <OverlaySkin />
      <OverlayHead eyebrow={`${c.iso} · ${regionOf(c)}`} name={c.n} topInset={insets.top} onClose={close} />
      <FlatList
        style={styles.body}
        data={visible}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        onScroll={feed.onScroll}
        scrollEventThrottle={16}
        onLayout={(e) => feed.onLayout(e.nativeEvent.layout.height)}
        onContentSizeChange={feed.onContentSize}
        viewabilityConfigCallbackPairs={viewPairs}
        overScrollMode="never"
        bounces={false}
        removeClippedSubviews
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={3}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'column' },
  body: { flex: 1 },
  // #cpane-feed{padding-bottom:80px}
  paneTail: { paddingBottom: 80 },
});
