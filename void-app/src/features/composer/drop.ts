// submitComposerPost() — void2-final.html ~8719-8800, native.
// Validates, shows a pending card, uploads every file to post-media, then create_post
// with the public URLs. Failure: uploads removed, card withdrawn, toast
// "DROP FAILED · … · DRAFT KEPT", composer reopened with the untouched draft.
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { COMPOSER_MAX_CHARS, MEDIA_CAPS, MEDIA_EXT, VoidAPI, voidDeleteMedia, voidEnsureSession, voidSafeHandle, voidUuid } from '../../core';
import { voidToast } from '../../ui/Toast';
import { ROUTES } from '../../nav/routes';
import { ensureCore, getIdentity, saveIdentity } from '../auth/coreBridge';
import { addDrop, draftStyle, getDraft, removeDrop, setDraft, updateDrop, type Draft } from './dropStore';
import { compressImage, readBlob, uploadLocal } from './media';

let dropping = false;
const postedSubs = new Set<(id: string) => void>();
/** Profile listens to refresh its DROPS list. */
export function onDropPosted(cb: (id: string) => void): () => void {
  postedSubs.add(cb);
  return () => postedSubs.delete(cb);
}

/** Pre-flight (before the sheet closes). '' = go, else the toast. */
export async function checkDraft(d: Draft = getDraft()): Promise<string> {
  if (dropping) return 'DROP IN PROGRESS';
  const text = d.text.trim();
  if (text.length > COMPOSER_MAX_CHARS) return 'TOO LONG · 280 MAX';
  if (!text && !d.media.length && !d.audio) return 'NOTHING TO DROP';
  for (const m of d.media) {
    if (m.kind === 'video' && !MEDIA_EXT[m.mime]) return 'UNSUPPORTED VIDEO FORMAT';
    if (m.kind === 'video' && m.size > MEDIA_CAPS.video) return 'VIDEO TOO LARGE · 100MB MAX';
  }
  if (d.audio) {
    try {
      const b = await readBlob(d.audio.uri);
      if (b.size > MEDIA_CAPS.audio) return 'VOICE NOTE TOO LARGE · 20MB MAX';
    } catch {}
  }
  return '';
}

export function hasDraftContent(d: Draft = getDraft()): boolean {
  return !!d.text.trim() || d.media.length > 0 || !!d.audio;
}

/** Fire the drop. Resolves when the post is saved or the draft was handed back. */
export async function runDrop(): Promise<void> {
  if (dropping) {
    voidToast('DROP IN PROGRESS');
    return;
  }
  dropping = true;
  await ensureCore();
  const d = getDraft();
  const text = d.text.trim();
  const draftMedia = d.media.slice();
  const draftAudio = d.audio;
  const u = getIdentity();
  const id = voidUuid();
  const hasImg = draftMedia.some((m) => m.kind === 'image');
  const hasVid = draftMedia.some((m) => m.kind === 'video');
  let style: string = draftStyle(d);
  if (style === 'carousel' && !hasImg) style = 'video';
  const np = {
    id,
    source: 'void',
    style,
    _isoColor: '#5b21d4',
    _author: u.name || 'You',
    _handle: '@' + voidSafeHandle(u.handle || 'me'),
    body: text,
    tags: ['void'],
    time: Date.now(),
    score: 0,
    replies: 0,
    reposts: 0,
    country: '',
    imgHue: Math.floor(Math.random() * 360),
    _user: true,
    _sb: true,
    _pending: true,
    _pendingKind: draftAudio ? 'audio' : hasImg ? 'image' : hasVid ? 'video' : 'text',
  };
  addDrop(np);

  const uploaded: Array<{ url: string; path: string; mime: string; kind: string; duration_s?: number }> = [];
  try {
    try {
      for (const m of draftMedia) {
        if (m.kind === 'image') {
          const c = await compressImage(m);
          uploaded.push(await uploadLocal(c.uri, c.mime, 'image', u));
        } else {
          uploaded.push(await uploadLocal(m.uri, m.mime, 'video', u));
        }
      }
      if (draftAudio) {
        const au: any = await uploadLocal(draftAudio.uri, draftAudio.mime || 'audio/mp4', 'audio', u);
        au.duration_s = draftAudio.dur;
        uploaded.push(au);
      }
      await voidEnsureSession(u);
      await VoidAPI.createPost(id, text, uploaded);
    } catch (e) {
      voidDeleteMedia(uploaded.map((x) => x.path));
      throw e;
    }
    // Saved: the card now carries ONLY the public URLs the server stored.
    const imgs = uploaded.filter((x) => x.kind === 'image').map((x) => x.url);
    const vids = uploaded.filter((x) => x.kind === 'video').map((x) => x.url);
    const au = uploaded.find((x) => x.kind === 'audio');
    const patch: Record<string, any> = { _pending: false, _pendingKind: undefined, _landed: true };
    if (imgs.length) {
      patch._img = imgs[0];
      patch._imgs = imgs;
    }
    if (vids.length) patch._video = vids[0];
    if (au) {
      patch._audio = au.url;
      patch._audioDur = au.duration_s;
    }
    updateDrop(id, patch);
    await saveIdentity({ posts: (getIdentity().posts || 0) + 1 });
    // The draft is spent only now (text only if the user has not typed on since).
    const cur = getDraft();
    setDraft({
      text: cur.text.trim() === text ? '' : cur.text,
      media: cur.media.filter((m) => !draftMedia.includes(m)),
      audio: cur.audio === draftAudio ? null : cur.audio,
      tab: 'text',
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    postedSubs.forEach((s) => s(id));
  } catch (e: any) {
    removeDrop(id);
    const why = String((e && e.message) || 'NETWORK').toUpperCase().replace(/[^A-Z0-9 ·()/.]/g, ' ').slice(0, 36).trim();
    voidToast('DROP FAILED · ' + why + ' · DRAFT KEPT');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    dropping = false;
    // Hand the untouched draft back.
    setTimeout(() => router.push(ROUTES.composer as any), 260);
  } finally {
    dropping = false;
  }
}
