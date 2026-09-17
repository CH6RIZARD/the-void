// Nav badge state (the DMS unread dot). Any screen can set it:
//   setDmUnread(true)            // e.g. after counting unread messages
//   const unread = useDmUnread() // BottomNav reads it
import { useSyncExternalStore } from 'react';

let dmUnread = false;
const subs = new Set<() => void>();

export function setDmUnread(on: boolean): void {
  if (dmUnread === on) return;
  dmUnread = on;
  subs.forEach((s) => s());
}

export function getDmUnread(): boolean {
  return dmUnread;
}

export function useDmUnread(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => dmUnread,
    () => dmUnread,
  );
}
