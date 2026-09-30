// TAPPING THE TAB YOU ARE ALREADY ON REFRESHES IT.
//
// The bottom nav did nothing on a re-tap: the press was ignored unless it
// changed tabs. But re-tapping the current tab is how people ask a screen to
// start over - it is the gesture every other app gives them - and on a feed
// that holds new posts back until you pull, it is the fastest way to say
// "show me what's new".
//
// A screen opts in by subscribing; tabs that do not subscribe behave as before.

type Handler = () => void;
const subs = new Map<string, Set<Handler>>();

/** Listen for a re-tap of `tab` ('void', 'globe', 'search', 'messages', 'profile'). */
export function onTabReselect(tab: string, fn: Handler): () => void {
  let set = subs.get(tab);
  if (!set) subs.set(tab, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
}

/** The nav calls this when the tab that is already focused is pressed again. */
export function emitTabReselect(tab: string): void {
  const set = subs.get(tab);
  if (!set) return;
  set.forEach((fn) => {
    try {
      fn();
    } catch {
      /* one bad listener must not stop the others */
    }
  });
}

