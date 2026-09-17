// Composer draft + pending drops.
//
// The draft lives at module level so it survives the sheet closing (web: the textarea,
// composerMedia and composerAudio are globals). A failed drop hands the untouched draft
// back by reopening the composer.
//
// Pending drops are what the feed renders at the top while uploads run (web: the
// `_pending` card with the orbit / sparkle loader). Feed integration:
//   const drops = usePendingDrops();   // newest first; each has .post (web app-post shape)
//   post._pending === true  -> render the loader card (post._pendingKind: 'image'|'video'|'audio'|'text')
//   post._pending falsy     -> the saved post with public URLs; dedupe by id against recentPosts()
import { useSyncExternalStore } from 'react';
import type { PickedMedia } from './media';

export type ComposerTab = 'text' | 'media' | 'audio';
export interface DraftAudio { uri: string; mime: string; dur: number }
export interface Draft { text: string; media: PickedMedia[]; audio: DraftAudio | null; tab: ComposerTab }

let draft: Draft = { text: '', media: [], audio: null, tab: 'text' };
const draftSubs = new Set<() => void>();
export function getDraft(): Draft {
  return draft;
}
export function setDraft(patch: Partial<Draft>): void {
  draft = { ...draft, ...patch };
  draftSubs.forEach((s) => s());
}
export function useDraft(): Draft {
  return useSyncExternalStore(
    (cb) => {
      draftSubs.add(cb);
      return () => draftSubs.delete(cb);
    },
    () => draft,
    () => draft,
  );
}

/** web composerMediaStyle(): 1 image -> image, 1 video -> video, many -> carousel. */
export function draftStyle(d: Draft = draft): 'audio' | 'drop' | 'carousel' | 'video' | 'image' {
  if (d.audio) return 'audio';
  if (!d.media.length) return 'drop';
  if (d.media.length > 1) return 'carousel';
  return d.media[0].kind === 'video' ? 'video' : 'image';
}

export type AppPost = Record<string, any> & { id: string };
let drops: AppPost[] = [];
const dropSubs = new Set<() => void>();
function emitDrops() {
  dropSubs.forEach((s) => s());
}
export function usePendingDrops(): AppPost[] {
  return useSyncExternalStore(
    (cb) => {
      dropSubs.add(cb);
      return () => dropSubs.delete(cb);
    },
    () => drops,
    () => drops,
  );
}
export function getPendingDrops(): AppPost[] {
  return drops;
}
export function addDrop(p: AppPost) {
  drops = [p, ...drops];
  emitDrops();
}
export function updateDrop(id: string, patch: Partial<AppPost>) {
  drops = drops.map((p) => (p.id === id ? { ...p, ...patch } : p));
  emitDrops();
}
export function removeDrop(id: string) {
  drops = drops.filter((p) => p.id !== id);
  emitDrops();
}
/** Feed calls this once the saved post is in its own list. */
export function forgetDrop(id: string) {
  removeDrop(id);
}
