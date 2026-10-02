// FlatList viewability for post lists — the web's two IntersectionObservers:
//   setupDwellTracking  threshold .5  -> impression on enter, learnDwell(ms) on leave
//   observeVideos       threshold .6  -> play while in, pause when out
// Any surface rendering <PostCard> in a FlatList can use this so its videos play on view:
//   const pairs = usePostViewability('nation');
//   <FlatList viewabilityConfigCallbackPairs={pairs} ... />   (items must be Post, or pass getPost)
import { useContext, useEffect, useRef } from 'react';
import { NavigationContext } from 'expo-router/build/react-navigation/core';
import type { ViewToken } from 'react-native';
import { learnDwell, type Post } from '../../core';
import { Sensing } from '../../lib/sensing';
import { setInView } from './stores';

export function usePostViewability(surface: string, getPost: (item: any) => Post | null | undefined = (x) => x as Post) {
  const entered = useRef<Record<string, { at: number; post: Post }>>({});
  const getRef = useRef(getPost);
  getRef.current = getPost;

  const pairs = useRef([
    {
      viewabilityConfig: { itemVisiblePercentThreshold: 50, minimumViewTime: 0 },
      onViewableItemsChanged: ({ changed }: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
        const now = Date.now();
        for (const t of changed) {
          const p = getRef.current(t.item);
          if (!p) continue;
          if (t.isViewable) {
            if (!entered.current[p.id]) {
              entered.current[p.id] = { at: now, post: p };
              try {
                (Sensing as any).markImpression?.('imp_' + p.id + '_' + now, p.id);
              } catch {}
            }
          } else if (entered.current[p.id]) {
            const e = entered.current[p.id];
            delete entered.current[p.id];
            try {
              learnDwell(e.post, now - e.at);
            } catch {}
          }
        }
      },
    },
    {
      viewabilityConfig: { itemVisiblePercentThreshold: 60, minimumViewTime: 0 },
      onViewableItemsChanged: ({ viewableItems }: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
        const ids: string[] = [];
        for (const t of viewableItems) {
          const p = getRef.current(t.item);
          if (p) ids.push(p.id);
        }
        lastIds.current = ids;
        if (focusedRef.current) setInView(surface, ids);
      },
    },
  ]).current;

  // A HIDDEN TAB'S CLIPS DO NOT KEEP DECODING.
  //
  // Play and pause followed the list's viewport and nothing else
  // (PostMedia: inView -> play(), else pause()). Switching tabs does not scroll
  // the list, so its viewport never changed, so every clip that was on screen
  // when you left kept decoding - muted, looping, invisible - for as long as
  // you were on the globe. Tabs here never unmount (detachInactiveScreens is
  // false), so the unmount cleanup below never ran either.
  //
  // The globe tab is the one that suffers: its wall asks for ten decoders on a
  // phone with four to eight, and every one a hidden feed card holds is one
  // the wall cannot have - a tile that gives up, or falls back to software
  // decoding, instead of a picture. Decoding video nobody can see is work that
  // cannot produce a result.
  //
  // So blur empties the surface's in-view set (every clip pauses) and focus
  // restores the ids the viewport last reported (they resume) - the list did
  // not move, so those ids are still the ones in view. Dwell timing is left
  // alone: an impression that was interrupted by a tab switch is still the
  // impression it was.
  const nav = useContext(NavigationContext);
  const focusedRef = useRef(nav ? nav.isFocused() : true);
  const lastIds = useRef<string[]>([]);
  useEffect(() => {
    if (!nav) return;
    focusedRef.current = nav.isFocused();
    const offBlur = nav.addListener('blur', () => {
      focusedRef.current = false;
      setInView(surface, []);
    });
    const offFocus = nav.addListener('focus', () => {
      focusedRef.current = true;
      setInView(surface, lastIds.current);
    });
    return () => {
      offBlur();
      offFocus();
    };
  }, [nav, surface]);

  // Leaving the screen ends every dwell and pauses every clip on it.
  useEffect(
    () => () => {
      const now = Date.now();
      for (const id of Object.keys(entered.current)) {
        const e = entered.current[id];
        try {
          learnDwell(e.post, now - e.at);
        } catch {}
      }
      entered.current = {};
      setInView(surface, []);
    },
    [surface],
  );

  return pairs;
}
