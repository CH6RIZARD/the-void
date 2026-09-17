// NATION FEED — native port of loadCountryFeed / nationFeedPull / nationBindScroll /
// nationThreadWarmBind (void2-final.html). The pool / deal / retry logic is the core's
// (createNationFeed, nationFeedPull, nationFeedOnScroll, closeNationFeed); this file
// is the NationFeedUI adapter over the FlatList's scroll metrics.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent, ViewToken } from 'react-native';
import {
  FEDI_REPLY_SOURCES,
  _remoteReplies,
  closeNationFeed,
  createNationFeed,
  loadFediReplies,
  nationFeedOnScroll,
  nationFeedPull,
  nationFeedRetryNow,
  type NationFeedState,
  type NationFeedUI,
} from '../../core';
import type { Country, Post } from '../../core/types';

export interface FeedStatus {
  text: string;
  /** RE-SCANNING is a button (nationFeedRetryNow); PULLING is not. */
  retry: boolean;
}

export function useNationFeed(c: Country, onCta: () => void) {
  const N = (c.n || '').toUpperCase();
  const [posts, setPosts] = useState<Post[]>([]);
  const [status, setStatus] = useState<FeedStatus | null>({ text: `PULLING ${N} SIGNAL…`, retry: false });
  const [more, setMore] = useState(false);

  const m = useRef({ y: 0, h: 0, contentH: 0, headerH: 0 }).current; // c-body scrollTop / clientHeight / scrollHeight
  const r = useRef({ alive: true, st: null as NationFeedState | null, raf: 0 as any, shortT: null as ReturnType<typeof setTimeout> | null }).current;
  const ctaRef = useRef(onCta);
  ctaRef.current = onCta;

  const nearBottom = () => m.y + m.h * 2 > m.contentH;

  const ui = useMemo<NationFeedUI>(
    () => ({
      // Deal only what the reader will reach soon (about ten screens below the fold).
      need: (st) => {
        if (!st.rendered || !m.h) return 16;
        const below = m.contentH - m.y - m.h;
        const paneH = Math.max(0, m.contentH - m.headerH);
        return Math.ceil((m.h * 10 - below) / Math.max(160, paneH / st.rendered));
      },
      wantsNow: (st) => st.rendered < 6 || nearBottom(),
      onPosts: (list, st) => {
        if (!r.alive || st !== r.st) return;
        setStatus(null);
        setPosts((prev) => prev.concat(list));
        ctaRef.current(); // a late source can still fill the TRENDING / ABOUT cards
      },
      onEmpty: (_ms, st) => {
        if (!r.alive || st !== r.st) return;
        setStatus({ text: `RE-SCANNING ${N} SIGNAL…`, retry: true });
      },
      // A short first page can't be scrolled, so it would never ask for page two.
      onShort: (st) => {
        if (r.shortT) clearTimeout(r.shortT);
        r.shortT = setTimeout(() => {
          if (r.alive && st === r.st && m.contentH < m.h * 2) pull(false);
        }, 400);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const pull = useCallback(
    async (first: boolean) => {
      const st = r.st;
      if (!st || !st.c || st.busy) return;
      if (!first && st.rendered) setMore(true); // .nf-more PULLING MORE SIGNAL…
      await nationFeedPull(st, first, ui);
      if (!r.alive || st !== r.st) return;
      setMore(false);
      if (st.rendered) ctaRef.current();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ui],
  );

  const retryNow = useCallback(() => {
    if (r.st) nationFeedRetryNow(r.st, ui);
  }, [r, ui]);

  // nationBindScroll: deal from the pool as the reader goes (one per frame); pull near the bottom.
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      m.y = contentOffset.y;
      m.h = layoutMeasurement.height;
      m.contentH = contentSize.height;
      const st = r.st;
      if (!st || !st.c || !st.rendered) return;
      if (st.pool.length && !r.raf) {
        r.raf = requestAnimationFrame(() => {
          r.raf = 0;
          if (r.alive && r.st === st) nationFeedOnScroll(st, ui, false);
        });
      }
      if (st.busy || ((st.dry || 0) >= 3 && !st.pool.length)) return;
      if (nearBottom()) pull(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ui, pull],
  );
  const onLayout = useCallback((h: number) => {
    m.h = h;
  }, [m]);
  const onContentSize = useCallback((_w: number, h: number) => {
    m.contentH = h;
  }, [m]);
  const onHeaderLayout = useCallback((h: number) => {
    m.headerH = h;
  }, [m]);

  // nationThreadWarmBind: replies start loading before the tap lands.
  const warmed = useRef(new Set<string>()).current;
  const q = useRef({ active: 0, queue: [] as Post[] }).current;
  const pump = useCallback(() => {
    while (q.active < 3 && q.queue.length) {
      const p = q.queue.shift()!;
      const pr = loadFediReplies(p);
      if (pr && pr.finally) {
        q.active++;
        pr.finally(() => {
          q.active--;
          pump();
        });
      }
    }
  }, [q]);
  /** pointerdown on a card (nationThreadWarm). */
  const warmTouch = useCallback((p: Post) => {
    if (p && FEDI_REPLY_SOURCES[p.source] && (p.replies || 0) > 0) loadFediReplies(p);
  }, []);
  /** IntersectionObserver path: each post once, as it scrolls into view, 3 at a time. */
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    for (const v of viewableItems) {
      const p = v.item as Post;
      if (!p || !v.isViewable || warmed.has(p.id)) continue;
      warmed.add(p.id);
      if (FEDI_REPLY_SOURCES[p.source] && (p.replies || 0) > 0 && !_remoteReplies[p.id]) {
        q.queue.push(p);
        pump();
      }
    }
  }).current;

  // loadCountryFeed(c) on open; closeOverlay() on unmount.
  useEffect(() => {
    r.alive = true;
    const st = createNationFeed(c as any);
    r.st = st;
    pull(true);
    return () => {
      r.alive = false;
      if (r.shortT) clearTimeout(r.shortT);
      if (r.raf) cancelAnimationFrame(r.raf);
      closeNationFeed(st);
      (st as any).c = null; // web: _nf.c = null
      r.st = null;
      q.queue.length = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { posts, status, more, retryNow, onScroll, onLayout, onContentSize, onHeaderLayout, warmTouch, onViewableItemsChanged };
}
