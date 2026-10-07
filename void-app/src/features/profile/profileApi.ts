// Profile data: own identity (local USER + profiles row), other users by handle,
// drops lists, edit-profile save with avatar upload.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { allPosts, env, sbPostToApp, VoidAPI, VoidAuth, voidEnsureSession, type Post } from '../../core';
import { voidToast } from '../../ui/Toast';
import { ensureCore, getIdentity, saveIdentity } from '../auth/coreBridge';
import { openThreadRoute } from '../feed/navigation';
import { handleError, stripHandle } from '../auth/handles';
import { compressImage, uploadLocal, type PickedMedia } from '../composer/media';

export const AVATAR_KEY = 'void_avatar_url';

export interface ProfileRow { id: string; handle: string; display_name?: string | null; avatar_url?: string | null }

const POST_SELECT = 'id,author_id,reply_to,body,rank_score,created_at,profiles:author_id(handle,display_name),post_media(url,ordinal,kind,mime,duration_s)';
// sbPostToApp drops reply_to; a row that carries the `parent` embed (fetchReplies) keeps
// who it answers as _replyTo, for the card's "Replying to" line and the tap's walk up.
const toPosts = (rows: any[]): Post[] =>
  rows
    .map((r) => {
      const p = sbPostToApp(r);
      if (p && r.parent) p._replyTo = { id: r.parent.id, handle: '@' + ((r.parent.profiles || {}).handle || 'void'), body: String(r.parent.body || '') };
      return p;
    })
    .filter((p): p is Post => !!p);

/**
 * Profile lists come from their own queries, not the feed pool, and the thread route
 * resolves an id only through findPost(). A post the feed never pulled (your own drops,
 * and every reply, since recentPosts filters reply_to=is.null) rendered MissingThread,
 * which pops straight back: the tap looked dead. So the TAPPED post is registered off
 * the feed first, as openSearchPost does. One post per tap, not the whole list: _offFeed
 * posts have their own trim budget, and a 40-row profile would flood it.
 */
export function registerOffFeed(p: Post): void {
  if (!allPosts.some((x) => x.id === p.id)) { p._offFeed = true; allPosts.push(p); }
}

async function publicGet(path: string): Promise<any> {
  const tok = VoidAPI.token || env.supabaseAnonKey;
  let r = await env.fetch(env.supabaseUrl + path, { headers: { apikey: env.supabaseAnonKey, Authorization: 'Bearer ' + tok } });
  if (r.status === 401) r = await env.fetch(env.supabaseUrl + path, { headers: { apikey: env.supabaseAnonKey, Authorization: 'Bearer ' + env.supabaseAnonKey } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/** Drops by one author (top-level). Falls back to VoidAPI.recentPosts filtered by author. */
export async function fetchDrops(authorId: string | null): Promise<Post[]> {
  await ensureCore();
  if (!authorId) return [];
  try {
    const rows = await publicGet('/rest/v1/posts?author_id=eq.' + encodeURIComponent(authorId) + '&reply_to=is.null&select=' + POST_SELECT + '&order=created_at.desc&limit=40');
    if (Array.isArray(rows)) return toPosts(rows);
  } catch {}
  try {
    const rows = await VoidAPI.recentPosts(40);
    return toPosts(rows.filter((r) => r.author_id === authorId));
  } catch {
    return [];
  }
}

/**
 * The posts this user has hearted.
 *
 * The relation was already there - `reactions` carries (post_id, user_id, kind)
 * and every heart has written a row to it since the feature existed. Nothing
 * read it back, which is the only reason this tab could not be built before.
 *
 * Two queries rather than an embed: the ids first, then the posts, because the
 * posts come back through the same POST_SELECT and sbPostToApp mapping as every
 * other list in the app, and a PostgREST embed would return a different shape
 * that the card would then have to special-case.
 */
export async function fetchHearted(userId: string | null): Promise<Post[]> {
  await ensureCore();
  if (!userId) return [];
  try {
    const refs = await publicGet(
      '/rest/v1/reactions?user_id=eq.' + encodeURIComponent(userId) + '&select=post_id,created_at&order=created_at.desc&limit=60',
    );
    const ids = (Array.isArray(refs) ? refs : []).map((r: any) => r && r.post_id).filter(Boolean);
    if (!ids.length) return [];
    const rows = await publicGet('/rest/v1/posts?id=in.(' + ids.join(',') + ')&select=' + POST_SELECT + '&limit=60');
    if (!Array.isArray(rows)) return [];
    // Newest heart first, not newest post: this list is a record of what you did,
    // so it is ordered by when you did it.
    const order = new Map<string, number>(ids.map((id: string, i: number) => [id, i]));
    return toPosts(rows).sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  } catch {
    return [];
  }
}

/**
 * The replies this user has written.
 *
 * A reply IS a post with reply_to set - the same row, the same table - so this is
 * fetchDrops with the null check inverted.
 */
export async function fetchReplies(authorId: string | null): Promise<Post[]> {
  await ensureCore();
  if (!authorId) return [];
  try {
    const rows = await publicGet(
      '/rest/v1/posts?author_id=eq.' + encodeURIComponent(authorId) + '&reply_to=not.is.null&select=' + POST_SELECT +
        ',parent:posts!reply_to(id,body,profiles:author_id(handle))&order=created_at.desc&limit=40',
    );
    if (Array.isArray(rows)) return toPosts(rows);
  } catch {}
  return [];
}

/**
 * A reply opens the thread it belongs to, not a thread of its own. reply_to can point
 * at another reply (VoidAPI.reply nests), so walk up to the top-level post, register
 * it off-feed, and open it with ?focus= so the thread shows the reply once loaded.
 * A reply deeper than the 3 levels loadRemoteReplies fetches still opens its root,
 * just without the overlay.
 */
export async function openReplyThread(reply: Post): Promise<void> {
  let id: string | null = reply._replyTo?.id || null;
  try {
    for (let hop = 0; id && hop < 6; hop++) {
      const rows = await publicGet('/rest/v1/posts?id=eq.' + encodeURIComponent(id) + '&select=' + POST_SELECT);
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) break;
      if (!row.reply_to) {
        const root = toPosts([row])[0];
        if (!root) break;
        registerOffFeed(root);
        return openThreadRoute(root.id, reply.id);
      }
      id = row.reply_to;
    }
  } catch {}
  // No parent known (the embed failed): the reply on its own beats a dead tap.
  if (!reply._replyTo) {
    registerOffFeed(reply);
    return openThreadRoute(reply.id);
  }
  voidToast('ORIGINAL POST UNAVAILABLE');
}

export async function fetchMyProfile(): Promise<ProfileRow | null> {
  await ensureCore();
  const uid = VoidAPI._uid();
  if (!uid) return null;
  try {
    const rows = await publicGet('/rest/v1/profiles?id=eq.' + encodeURIComponent(uid) + '&select=id,handle,display_name,avatar_url');
    return (rows && rows[0]) || null;
  } catch {
    return null;
  }
}

export async function fetchProfileByHandle(handle: string): Promise<ProfileRow | null> {
  await ensureCore();
  const h = stripHandle(handle);
  if (!h) return null;
  try {
    const rows = await publicGet('/rest/v1/profiles?handle=eq.' + encodeURIComponent(h) + '&select=id,handle,display_name,avatar_url');
    return (rows && rows[0]) || null;
  } catch {
    return null;
  }
}

export async function getLocalAvatar(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(AVATAR_KEY);
  } catch {
    return null;
  }
}

/**
 * EDIT PROFILE save. Name / handle / bio are local (web USER); handle, display name
 * and avatar also go to profiles. Returns '' or the error line.
 * Bio has no profiles column (001) — it stays on the device like the web.
 */
export async function saveProfile(input: { name: string; handle: string; bio: string; avatar?: PickedMedia | null }): Promise<string> {
  await ensureCore();
  const u = getIdentity();
  const rawHandle = input.handle.trim() || u.handle;
  const herr = handleError(rawHandle);
  if (herr) return herr;
  const handle = '@' + stripHandle(rawHandle);
  const name = input.name.trim() || u.name;
  let avatarUrl: string | undefined;
  if (VoidAuth.configured()) {
    try {
      await voidEnsureSession({ handle, name });
    } catch (e: any) {
      if (input.avatar) return String((e && e.message) || 'NOT SIGNED IN').toUpperCase();
    }
    if (input.avatar) {
      try {
        const c = await compressImage(input.avatar, 512);
        const up = await uploadLocal(c.uri, c.mime, 'image', { handle, name });
        avatarUrl = up.url;
      } catch (e: any) {
        return ('AVATAR FAILED · ' + String((e && e.message) || 'UPLOAD')).toUpperCase().slice(0, 60);
      }
    }
    if (VoidAPI._sbReady()) {
      const fields: Record<string, unknown> = { handle: stripHandle(handle), display_name: name };
      if (avatarUrl) fields.avatar_url = avatarUrl;
      const made = await VoidAuth.upsertProfile(fields);
      if (!made) {
        try {
          const rows = await VoidAPI._sb('/rest/v1/profiles?handle=eq.' + encodeURIComponent(stripHandle(handle)) + '&select=id', 'GET');
          if (rows && rows[0] && rows[0].id !== VoidAPI._uid()) return 'HANDLE TAKEN · TRY ANOTHER';
        } catch {}
        return 'SIGNAL LOST · RETRY';
      }
    }
  }
  if (avatarUrl) await AsyncStorage.setItem(AVATAR_KEY, avatarUrl).catch(() => {});
  await saveIdentity({ name, handle, bio: input.bio.trim() });
  return '';
}
