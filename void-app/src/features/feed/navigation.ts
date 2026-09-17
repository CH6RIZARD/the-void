// Where a post's taps go (web openReel / openPhoto / openThread / switchTab / openCountry).
import { router } from 'expo-router';
import { findPost } from '../../core';
import { voidToast } from '../../ui/Toast';
import { ROUTES } from '../../nav/routes';
import { isPostHidden } from './stores';

/** Video media -> the reel viewer, seeded with this post (web openReel(postId)). */
export function openReel(postId: string): void {
  router.push({ pathname: ROUTES.reels as any, params: { id: postId } });
}

type PhotoOpener = (postId: string, index: number) => void;
let photoOpener: PhotoOpener | null = null;
/**
 * The still photo viewer (web openPhoto) is not part of this agent's files and there
 * is no /photo route yet. Whoever builds it registers here; until then an image tap
 * opens the post's thread, where the image is shown large.
 */
export function registerPhotoOpener(fn: PhotoOpener | null): void {
  photoOpener = fn;
}
export function openPhoto(postId: string, index = 0): void {
  if (photoOpener) return photoOpener(postId, index);
  openThreadRoute(postId);
}

/** Navigate to /thread/[id]; the web's hidden() guard on openThread first. */
export function openThreadRoute(postId: string): void {
  const p = findPost(postId);
  if (p && isPostHidden(p)) {
    voidToast('HIDDEN · BLOCKED OR REPORTED');
    return;
  }
  router.push(ROUTES.thread(postId) as any);
}

export function openLive(): void {
  router.navigate(ROUTES.globe as any);
}
export function openCountry(iso: string): void {
  router.push(ROUTES.nation(iso) as any);
}
