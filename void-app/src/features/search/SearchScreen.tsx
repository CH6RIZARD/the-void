// SEARCH tab — the user's ORIGINAL search screen (patch3 RESCINDED A6: "the
// original/current search screen is final"). Port of #screen-search, setFilter(),
// doSearch(), renderSearch() and the discovery/query pulls.
//
// #screen-search markup:
//   .search-head > .search-bar > input#si.search-input[placeholder="search anywhere…"] + button.search-go "GO"
//                > .filter-row > .filter-pill × 7
//   .search-results > #search-grid
// Mobile CSS (pointer:coarse, what a phone renders):
//   .search-head{position:sticky;top:0;z-index:20;padding:12px 14px 10px;background:linear-gradient(var(--bg) 78%,transparent)}
//   .search-bar{gap:8px;margin-bottom:10px}
//   .search-input{flex:1;min-width:0;background:transparent;border:none;'Syne' 14px;padding:0;color:var(--white)}  ::placeholder{color:var(--muted)}
//   (.search-input-wrap exists in the CSS but NOT in the markup: the input is bare, so it is bare here.)
//   .search-go{padding:11px 18px;background:linear-gradient(135deg,#7c3aed,#5b21d4);'Syne' 800 12px;letter-spacing:.08em;
//     border-radius:26px;box-shadow:0 6px 18px rgba(124,58,237,.35);color:var(--white)}
//   .filter-row{gap:6px;overflow-x:auto;padding-bottom:2px}
//   .filter-pill{padding:6px 13px;border-radius:20px;'Syne Mono' 9px;color:var(--dim);background:rgba(13,8,32,.8);letter-spacing:.07em}
//   .filter-pill.on{color:var(--gold);background:rgba(201,168,76,.14)}
//   .search-results{padding:10px 14px 80px}
//   .search-section-lbl{'Syne Mono' 8px;letter-spacing:.25em;color:var(--gold);padding:14px 14px 8px;gap:10px;uppercase}
//     ::after{flex:1;height:1px;background:linear-gradient(90deg,rgba(201,168,76,.4),transparent)}
//   NO SIGNAL: text-align:center;padding:30px;'Syne Mono' 9px;color:var(--muted)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { moderation, onPostsChanged, openSearchPost, pullSearchDiscovery, findPost, searchPostById } from '../../core';
import { voidToast } from '../../ui/Toast';
import { LiveDot } from '../live/TileChrome';
import { useTheme } from '../../theme/tokens';
import { FONTS, em } from '../../theme/palettes';
import { useBottomNavSpace } from '../../nav/layout';
import { onTabReselect } from '../../nav/reselect';
import { FILTERS, advanceLiveWindow, buildSearch, type SearchBlock, type SearchFilter } from './searchModel';
import { SEARCH_SURFACE, SearchPostCard } from './SearchPostCard';
import { setInView } from '../feed/stores';

/** observeVideos threshold (feed usePostViewability: >=60% visible plays). */
const VIDEO_VISIBLE = 0.6;
// Enough to fill the first screen, then a few per frame. Small enough that no
// single commit is felt; large enough that the rest is there before a thumb
// reaches it.
const FIRST_PAINT = 4;
const STEP = 3;
const STEP_MS = 90;

/** At most this many search clips decode at once. */
const MAX_DECODING = 2;
import { SearchLiveFeat, SearchLiveRow } from './SearchLiveTile';

/** Web renders SEARCH content on a delay after load (setTimeout(pullSearchDiscovery, 5000)). */
let _bootPulled = false;

export default function SearchScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navSpace = useBottomNavSpace();
  const [input, setInput] = useState(''); // #si.value
  // Tapping SEARCH while already on search puts the cursor in the field - the
  // tab press is someone asking to type, and they should not have to aim at the
  // box afterwards.
  const fieldRef = useRef<TextInput>(null);
  useEffect(() => onTabReselect('search', () => fieldRef.current?.focus()), []);
  const inputRef = useRef('');
  inputRef.current = input;
  const [query, setQuery] = useState(''); // the value renderSearch last ran with
  const [pill, setPill] = useState<SearchFilter>('all'); // highlight paints first
  const [filter, setFilterState] = useState<SearchFilter>('all'); // grid follows a frame later
  const [blocks, setBlocks] = useState<SearchBlock[]>([]);
  const sigRef = useRef<string | null>(null);
  const [focused, setFocused] = useState(false);

  useFocusEffect(
    useCallback(() => {
      advanceLiveWindow(); // a fresh visit gets a fresh LIVE NOW set; builds within the visit keep it
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const queryRef = useRef(query);
  queryRef.current = query;
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const viewRef = useRef<string | null>(null);
  const render = useCallback((q: string, f: SearchFilter) => {
    const r = buildSearch(q, f);
    // Same exact set of cards → what is on screen is already correct; leave it alone.
    if (sigRef.current === r.sig) return;
    sigRef.current = r.sig;
    // Only the POSTS changed (a discovery landing on the same query + filter):
    // keep the staircase where it is. Collapsing back to FIRST_PAINT and
    // re-climbing on every landing re-revealed - and remounted - everything
    // below block four, over and over, which is the "slow" search felt.
    const view = f + '\u0000' + q;
    const sameView = viewRef.current === view;
    viewRef.current = view;
    setBlocks(r.blocks);
    if (!sameView) setShown(FIRST_PAINT);
  }, []);

  // ─── THE SCREEN ARRIVES IN PIECES, NOT ALL AT ONCE ─────────────────────
  // Measured on the phone: pressing SEARCH blocked the JS thread for 14351ms and
  // the tab took 13669ms to appear. This is where it went. Every block was
  // rendered in one commit - a dozen post cards with their media, plus nine live
  // stream slots - into a plain ScrollView, which does no windowing at all. One
  // commit that large is not a slow screen, it is a frozen app: nothing else on
  // the JS thread runs until it finishes.
  //
  // Turning this into a FlatList would be the textbook answer and would also
  // rewrite the sticky header, the hand-rolled viewport tracking below, and the
  // block-to-card mapping. The cost here is the size of the first commit, so
  // that is what is cut: enough blocks to fill a screen immediately, the rest
  // appended a few at a time on later frames. The thread comes back between each
  // step, so the tab is usable while the remainder arrives.
  const [shown, setShown] = useState(FIRST_PAINT);
  useEffect(() => {
    if (shown >= blocks.length) return;
    // A frame's grace between steps: this runs after paint, not instead of it.
    const t = setTimeout(() => setShown((n) => Math.min(blocks.length, n + STEP)), STEP_MS);
    return () => clearTimeout(t);
  }, [shown, blocks.length]);

  // renderSearch on entry / query / filter change.
  useEffect(() => {
    if (focused) render(query, filter);
  }, [focused, query, filter, render]);

  // pullSearchDiscovery / pullSearchQuery landing → renderSearch(si.value) while SEARCH is active.
  useEffect(() => {
    if (!_bootPulled) {
      _bootPulled = true;
      pullSearchDiscovery().catch(() => 0);
    }
    return onPostsChanged((reason) => {
      if (reason !== 'search' || !focusedRef.current) return; // web: only while activeTab==='search'
      render(queryRef.current, filterRef.current);
    });
  }, [render]);

  const doSearch = useCallback(() => {
    // Enter / GO: renderSearch(si.value). A repeat of the same query still re-evaluates.
    const q = inputRef.current;
    if (q === queryRef.current) render(q, filterRef.current);
    else setQuery(q);
  }, [render]);

  // setFilter(): highlight now, rebuild on the next frame.
  const setFilter = useCallback((f: SearchFilter) => {
    setPill(f);
    requestAnimationFrame(() => {
      setQuery(inputRef.current);
      setFilterState(f);
    });
  }, []);

  // ── Play-on-view for video cards ───────────────────────────────────────
  // The results are a plain ScrollView (the original screen), so the FlatList viewability
  // callbacks the feed uses are computed here by hand: card rects from onLayout, the
  // viewport from onScroll/onLayout. Same semantics as usePostViewability's video pair:
  // >=60% visible -> in view (play muted), otherwise out (pause). Capped at 2.
  const vis = useRef({ y: 0, h: 0, resultsY: 0, cards: new Map<string, { y: number; h: number }>(), last: '' }).current;
  const recomputeView = useCallback(() => {
    const top = vis.y;
    const bottom = vis.y + vis.h;
    const hits: Array<{ id: string; frac: number }> = [];
    if (focusedRef.current && vis.h > 0) {
      vis.cards.forEach((r, id) => {
        const y0 = vis.resultsY + r.y;
        const y1 = y0 + r.h;
        const frac = r.h > 0 ? Math.max(0, Math.min(bottom, y1) - Math.max(top, y0)) / r.h : 0;
        if (frac >= VIDEO_VISIBLE) hits.push({ id, frac });
      });
    }
    hits.sort((a, b) => b.frac - a.frac);
    const ids = hits.slice(0, MAX_DECODING).map((x) => x.id);
    const sig = ids.join('|');
    if (sig === vis.last) return;
    vis.last = sig;
    setInView(SEARCH_SURFACE, ids);
  }, [vis]);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      vis.y = e.nativeEvent.contentOffset.y;
      vis.h = e.nativeEvent.layoutMeasurement.height;
      recomputeView();
    },
    [vis, recomputeView],
  );
  const cardLayout = useRef(new Map<string, (e: LayoutChangeEvent) => void>()).current;
  const layoutFor = useCallback(
    (id: string) => {
      let fn = cardLayout.get(id);
      if (!fn) {
        fn = (e: LayoutChangeEvent) => {
          vis.cards.set(id, { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height });
          recomputeView();
        };
        cardLayout.set(id, fn);
      }
      return fn;
    },
    [cardLayout, vis, recomputeView],
  );
  // Only cards currently rendered with a clip are candidates.
  useEffect(() => {
    const live = new Set(blocks.filter((b) => b.kind === 'post' && !!(b as any).post._video).map((b) => (b as any).post.id as string));
    for (const id of [...vis.cards.keys()]) if (!live.has(id)) vis.cards.delete(id);
    recomputeView();
  }, [blocks, vis, recomputeView]);
  // Leaving the tab pauses every clip (usePostViewability unmount / blur).
  useEffect(() => {
    vis.last = '';
    recomputeView();
  }, [focused, vis, recomputeView]);
  useEffect(() => () => setInView(SEARCH_SURFACE, []), []);

  const openPost = useCallback((id: string) => {
    const p = searchPostById(id) || findPost(id);
    if (p && moderation.hidden(p)) {
      voidToast('HIDDEN · BLOCKED OR REPORTED');
      return;
    }
    if (!openSearchPost(id)) return;
    InteractionManager.runAfterInteractions(() => router.push(`/thread/${encodeURIComponent(id)}` as any));
  }, []);

  const renderBlock = (b: SearchBlock) => {
    switch (b.kind) {
      case 'label':
        return (
          <View key={b.key} style={styles.sectionLbl}>
            {b.live ? <LiveDot /> : null}
            <Text allowFontScaling={false} style={[styles.sectionText, { color: colors.gold }]}>
              {b.text.toUpperCase()}
            </Text>
            <View style={[styles.sectionRule, { experimental_backgroundImage: 'linear-gradient(90deg, rgba(201,168,76,0.4), transparent)' } as any]} />
          </View>
        );
      case 'feat':
        return <SearchLiveFeat key={b.key} ch={b.ch} active={focused} slotKey={b.key} />;
      case 'row':
        return <SearchLiveRow key={b.key} chs={b.chs} active={focused} rowKey={b.key} />;
      case 'post':
        return <SearchPostCard key={b.key} post={b.post} onOpen={openPost} onLayout={b.post._video ? layoutFor(b.post.id) : undefined} />;
      case 'empty':
        return (
          <Text key={b.key} allowFontScaling={false} style={[styles.empty, { color: colors.muted }]}>
            NO SIGNAL
          </Text>
        );
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ScrollView
        stickyHeaderIndices={[0]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={100}
        onLayout={(e) => {
          vis.h = e.nativeEvent.layout.height;
          recomputeView();
        }}
        contentContainerStyle={{ paddingBottom: 80 + Math.max(0, navSpace - 58) }}
      >
        <View
          style={[
            styles.head,
            { paddingTop: 12 + insets.top, experimental_backgroundImage: `linear-gradient(${colors.bg} 78%, transparent)` } as any,
          ]}
        >
          <View style={styles.bar}>
            <TextInput
                ref={fieldRef}
                value={input}
                onChangeText={setInput}
                onSubmitEditing={doSearch}
                placeholder={'search anywhere…'}
                placeholderTextColor={colors.muted}
                autoComplete="off"
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                allowFontScaling={false}
                style={[styles.input, { color: colors.white }]}
              />
            <Pressable onPress={doSearch} style={({ pressed }) => [styles.go, { opacity: pressed ? 0.72 : 1 }]} accessibilityRole="button">
              <Text allowFontScaling={false} style={[styles.goText, { color: colors.white }]}>
                GO
              </Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} keyboardShouldPersistTaps="handled">
            {FILTERS.map(({ f, label }) => {
              const on = pill === f;
              return (
                <Pressable
                  key={f}
                  onPress={() => setFilter(f)}
                  style={({ pressed }) => [styles.pill, on && styles.pillOn, { opacity: pressed ? 0.72 : 1 }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text allowFontScaling={false} style={[styles.pillText, { color: on ? colors.gold : colors.dim }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
        <View
          style={styles.results}
          onLayout={(e) => {
            vis.resultsY = e.nativeEvent.layout.y;
            recomputeView();
          }}
        >
          {blocks.slice(0, shown).map(renderBlock)}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  head: { zIndex: 20, paddingHorizontal: 14, paddingBottom: 10 },
  bar: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 10 },
  input: { flex: 1, minWidth: 0, fontFamily: FONTS.sans, fontSize: 14, padding: 0, margin: 0 },
  go: {
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 26,
    experimental_backgroundImage: 'linear-gradient(135deg, #7c3aed, #5b21d4)',
    backgroundColor: '#6a2ee0',
    boxShadow: '0px 6px 18px rgba(124,58,237,0.35)',
    flexShrink: 0,
  } as any,
  goText: { fontFamily: FONTS.sansExtraBold, fontSize: 12, letterSpacing: em(12, 0.08) },
  filterRow: { gap: 6, paddingBottom: 2 },
  pill: { paddingVertical: 6, paddingHorizontal: 13, borderRadius: 20, backgroundColor: 'rgba(13,8,32,0.8)', flexShrink: 0 },
  pillOn: { backgroundColor: 'rgba(201,168,76,0.14)' },
  pillText: { fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.07) },
  results: { paddingTop: 10, paddingHorizontal: 14 },
  sectionLbl: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 14, paddingHorizontal: 14, paddingBottom: 8 },
  sectionText: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.25) },
  sectionRule: { flex: 1, height: 1 },
  empty: { textAlign: 'center', padding: 30, fontFamily: FONTS.mono, fontSize: 9 },
});
