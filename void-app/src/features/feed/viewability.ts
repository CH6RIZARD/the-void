// FlatList viewability for post lists — the web's two IntersectionObservers:
//   setupDwellTracking  threshold .5  -> impression on enter, learnDwell(ms) on leave
//   observeVideos       threshold .6  -> play while in, pause when out
// Any surface rendering <PostCard> in a FlatList can use this so its videos play on view:
//   const pairs = usePostViewability('nation');
//   <FlatList viewabilityConfigCallbackPairs={pairs} ... />   (items must be Post, or pass getPost)
import { useEffect, useRef } from 'react';
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
        setInView(surface, ids);
      },
    },
  ]).current;

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
