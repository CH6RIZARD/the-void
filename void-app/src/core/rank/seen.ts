// ─── CONTENT DEDUPE ─────────────────────────────────────────────────────
// Dedupe by id alone misses most real repeats: over 276 live items, 20 had
// identical normalised text and 20 pointed at the same article from different
// accounts. Two posts telling a reader the same thing ARE the same post.
// A REPOST is exempt (a deliberate re-surface is a real event).
//
// SEEN-STATE PERSISTS ACROSS LAUNCHES. Fresh content on open needs BOTH: remember
// what was shown, AND resume where paging stopped (see the Bluesky cursors).
// Keys are hashed (FNV-1a) so the history stays small in storage.
import { env, onConfigure } from '../env.ts';
import type { Post } from '../types.ts';
import { parseUrl } from '../util.ts';
import { noteStory } from './story.ts';

export const _SEEN_CAP = 4000;
export function _h(s: string): string { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function _loadSeen(k: string): string[] { try { const a = JSON.parse(env.storage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }

export const _seenIds = new Set<string>(), _seenText = new Set<string>(), _seenLink = new Set<string>();
let _seenDirty = false;
function loadSeenAll() {
  _seenIds.clear(); _seenText.clear(); _seenLink.clear();
  _loadSeen('void_seen_ids').forEach(x => _seenIds.add(x));
  _loadSeen('void_seen_text').forEach(x => _seenText.add(x));
  _loadSeen('void_seen_link').forEach(x => _seenLink.add(x));
  _seenDirty = false;
}
loadSeenAll();
onConfigure(loadSeenAll);

export function seenDirty(): boolean { return _seenDirty; }
// Sets preserve insertion order, so trimming from the FRONT drops the oldest.
function _trim(s: Set<string>) { while (s.size > _SEEN_CAP) s.delete(s.values().next().value as string); }
/**
 * Flush seen-state. The web ran this on idle every 15s plus pagehide /
 * visibilitychange(hidden) — call it on the same beat and on AppState 'background'.
 */
export function persistSeen(): void {
  if (!_seenDirty) return; _seenDirty = false;
  _trim(_seenIds); _trim(_seenText); _trim(_seenLink);
  const write = () => {
    env.storage.setItem('void_seen_ids', JSON.stringify([..._seenIds]));
    env.storage.setItem('void_seen_text', JSON.stringify([..._seenText]));
    env.storage.setItem('void_seen_link', JSON.stringify([..._seenLink]));
  };
  try { write(); } catch {   // quota: halve the history and try once more
    try {
      [_seenIds, _seenText, _seenLink].forEach(s => { const n = s.size >> 1; let i = 0; for (const v of [...s]) { if (i++ >= n) break; s.delete(v); } });
      write();
    } catch { /* give up quietly */ }
  }
}

export function _normText(t: unknown): string {
  return String(t || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')          // the same story gets different tracking URLs
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')        // punctuation/emoji vary between outlets
    .replace(/\s+/g, ' ').trim();
}
export function _linkKey(u: unknown): string {
  try { const x = parseUrl(u); return x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, ''); } catch { return ''; }
}

/**
 * Single gate for every source. Returns false if the user has already been shown
 * this content (id, same text, or same article). MARKS the post seen on success.
 */
export function admitPost(p: Post | null | undefined): boolean {
  if (!p || !p.id || _seenIds.has(p.id)) return false;
  noteStory(p);   // a second source on the same story is CORROBORATION — count it before deduping it away
  if (!p._repost) {
    const t = _normText(p.body), l = p._link ? _linkKey(p._link) : '';
    const th = t.length > 15 ? _h(t) : '', lh = l ? _h(l) : '';
    if (th && _seenText.has(th)) return false;
    if (lh && _seenLink.has(lh)) return false;
    if (th) _seenText.add(th);
    if (lh) _seenLink.add(lh);
  }
  _seenIds.add(p.id);
  _seenDirty = true;
  return true;
}

/** READ-ONLY seen check (the nation pane may look, never write). */
export function wasSeen(p: Post): boolean {
  try {
    // Same exemption as admitPost: a REPOST is a deliberate re-surface by someone
    // else, so only its own id counts as seen - not the text it shares with the original.
    if (_seenIds.has(p.id)) return true;
    if (p._repost) return false;
    const t = _normText(p.body), l = p._link ? _linkKey(p._link) : '';
    return (t.length > 15 && _seenText.has(_h(t))) || (!!l && _seenLink.has(_h(l)));
  } catch { return false; }
}
