// ─── MODERATION (VMod) — block / hide / report / mute / terms / graphic veil ─
// Store-required UGC safety. Pure state + Supabase calls; the web's sheets and DOM
// sweeps become screens that read these functions. Blocking a Void account syncs to
// `blocks`; hiding an external author/source is device-only.
import { env } from '../env.ts';
import type { Comment, Post } from '../types.ts';
import { parseUrl } from '../util.ts';
import { VoidAPI } from './voidApi.ts';

export const SUPPORT_EMAIL = 'daniel4chigs@gmail.com';
export const TERMS_URL = 'https://void-app-d35c.pages.dev/terms';
export const PRIVACY_URL = 'https://void-app-d35c.pages.dev/privacy';
export const LS = { blocks: 'void_blocks', hidden: 'void_hidden_posts', reports: 'void_reports_pending', terms: 'void_terms_accepted', termsSync: 'void_terms_sync_pending', gfx: 'void_hide_graphic' };
export const REPORT_REASONS: Array<[string, string, string]> = [['spam', 'Spam', 'Scams, bots, repetitive junk'], ['harassment', 'Harassment', 'Targets or bullies a person'], ['hate', 'Hate', 'Attacks people for who they are'], ['violence', 'Violence', 'Threats, gore, glorifying harm'], ['sexual', 'Sexual content', 'Nudity or sexual exploitation'], ['misinformation', 'Misinformation', 'Deliberately false or misleading'], ['other', 'Something else', 'Tell us in the note']];
// Placeholder handles that name a PLATFORM, not a person: never blockable as an author.
export const GENERIC = new Set(['', 'void', 'bsky', 'bluesky', 'mastodon', 'lemmy', 'peertube', 'reddit', 'radio', 'commons', 'news', 'world', 'anon', 'source', 'telegram', 'twitter', 'youtube', 'forum', 'void.signal']);

const rd = <T>(k: string, d: T): T => { try { const v = JSON.parse(env.storage.getItem(k) as string); return v == null ? d : v; } catch { return d; } };
const wr = (k: string, v: unknown) => { try { env.storage.setItem(k, JSON.stringify(v)); } catch { /* */ } };

export interface Author { key: string; uid?: string | null; handle: string; label: string; source: string; external: boolean; hostOnly?: boolean; }
export interface Block extends Author { synced?: boolean; at: number; }
export interface Report { reason: string; note?: string; at: number; postId?: string; userId?: string | null; external?: string | null; }

let blocks: Block[] = [];
const hiddenPosts = new Set<string>();
let hideGraphic = true;
let idx = { keys: new Set<string>(), uids: new Set<string>(), voidHandles: new Set<string>() };
function reindex() {
  idx = { keys: new Set(), uids: new Set(), voidHandles: new Set() };
  blocks.forEach(b => { idx.keys.add(b.key); if (b.uid) idx.uids.add(b.uid); if (b.source === 'void' && b.handle) idx.voidHandles.add(b.handle); });
}
/** Load from storage. configureCore() does not call this; call it after configuring. */
export function loadModeration(): void {
  blocks = rd<Block[]>(LS.blocks, []); if (!Array.isArray(blocks)) blocks = [];
  hiddenPosts.clear(); rd<string[]>(LS.hidden, []).forEach(x => hiddenPosts.add(x));
  hideGraphic = rd<boolean>(LS.gfx, true) !== false;        // default ON for new users
  reindex();
}
loadModeration();
const saveBlocks = () => { wr(LS.blocks, blocks); reindex(); };
const saveHidden = () => { wr(LS.hidden, [...hiddenPosts].slice(-3000)); };

const nh = (h: unknown) => String(h || '').trim().replace(/^@/, '').toLowerCase();
const baseId = (id: unknown) => String(id || '').split('~')[0];
const me = () => { try { return VoidAPI._uid(); } catch { return null; } };
const ready = () => { try { return VoidAPI._sbReady(); } catch { return false; } };

export function hostOf(p: Partial<Post>): string {
  const pv = p && p.provenance && p.provenance.sourceHost;
  if (pv) return String(pv).replace(/^www\./, '').toLowerCase();
  try { return parseUrl(p._url || p.sourceUrl || p._link).host.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}
/** Who a post is BY, for block/report. null = the viewer's own / nobody blockable. */
export function authorOf(p: Partial<Post> | null | undefined): Author | null {
  if (!p || p._user) return null;
  const src = String(p.source || 'void').toLowerCase();
  const uid = p.author_id || p._authorId || null;
  if (uid && uid === me()) return null;
  if (uid) return { key: 'uid:' + uid, uid, handle: nh(p._handle) === 'void' ? '' : nh(p._handle), label: (p._author && p._author !== 'void') ? p._author : (nh(p._handle) || 'Void user'), source: 'void', external: false };
  if (src === 'news') { const h = hostOf(p) || nh(p._handle); return h ? { key: 'host:' + h, handle: h, label: h, source: 'news', external: true, hostOnly: true } : null; }
  const h = nh(p._handle);
  if (h && !GENERIC.has(h) && h !== src) return { key: src + ':' + h, handle: h, label: p._author || h, source: src, external: src !== 'void' };
  const host = /bsky/i.test(hostOf(p)) ? '' : hostOf(p);   // appview host is plumbing, never an author
  if (host && src !== 'void') return { key: 'host:' + host, handle: host, label: host, source: src, external: true, hostOnly: true };
  return null;
}
export function authorOfComment(c: Comment | null | undefined, post: Partial<Post> | null | undefined): Author | null {
  if (!c) return null;
  if (c.authorId) return { key: 'uid:' + c.authorId, uid: c.authorId, handle: nh(c.handle), label: c.author || nh(c.handle), source: 'void', external: false };
  if (!c.remote) return null;                                     // local comment = the viewer's own
  const src = String((post && post.source) || 'void').toLowerCase(), h = nh(c.handle);
  if (!h || GENERIC.has(h)) return null;
  return { key: src + ':' + h, handle: h, label: c.author || h, source: src, external: src !== 'void' };
}
export function isBlocked(a: Author | null | undefined): boolean {
  if (!a) return false;
  return idx.keys.has(a.key) || (!!a.uid && idx.uids.has(a.uid)) || (a.source === 'void' && !!a.handle && idx.voidHandles.has(a.handle));
}
/** Hidden everywhere: reported by this viewer, or by a blocked author. */
export function hidden(p: Partial<Post> | null | undefined): boolean {
  if (!p) return false;
  if (hiddenPosts.has(baseId(p.id))) return true;
  return isBlocked(authorOf(p));
}
export const isGraphic = (p: Partial<Post> | null | undefined) => !!(p && (p._graphic || (p.tags || []).includes('graphic')));
/** Graphic media is veiled (tap to view) when this is on. Default ON. */
export function graphicVeilOn(): boolean { return hideGraphic; }
export function setGraphicVeil(on: boolean): void { hideGraphic = on; wr(LS.gfx, on); }
export function filterComments(list: Comment[], post: Partial<Post> | null | undefined): Comment[] {
  return list.filter(c => !hiddenPosts.has(c.id) && !isBlocked(authorOfComment(c, post)));
}
export function getBlocks(): Block[] { return blocks.slice(); }
export function hiddenCount(): number { return hiddenPosts.size; }
export function restoreHidden(): void { hiddenPosts.clear(); saveHidden(); }

async function sb(path: string, method?: string, body?: unknown, h?: Record<string, string>) { return VoidAPI._sb(path, method, body, h); }
async function resolveUid(a: Author): Promise<string | null> {
  if (a.uid) return a.uid;
  if (a.source !== 'void' || !a.handle || !ready()) return null;
  try { const r = await sb('/rest/v1/profiles?handle=eq.' + encodeURIComponent(a.handle) + '&select=id', 'GET'); return (r && r[0] && r[0].id) || null; } catch { return null; }
}
async function pushBlock(b: Block) {
  if (b.external || !ready()) return;
  const uid = await resolveUid(b); if (!uid || uid === me()) return;
  b.uid = uid;
  await sb('/rest/v1/blocks', 'POST', [{ blocker_id: me(), blocked_id: uid }], { 'Prefer': 'resolution=ignore-duplicates,return=minimal' });
  b.synced = true; saveBlocks();
}
export async function sendReport(r: Report): Promise<'queued' | 'noop' | 'sent'> {
  if (!ready()) { const q = rd<Report[]>(LS.reports, []); q.push(r); wr(LS.reports, q.slice(-200)); return 'queued'; }
  const row: any = { reporter_id: me(), reason: r.reason, note: r.note ? String(r.note).slice(0, 1000) : null };
  if (r.postId && VoidAPI._uuid(r.postId)) row.target_post_id = r.postId;
  if (r.userId) row.target_user_id = r.userId;
  if (r.external) row.target_external = String(r.external).slice(0, 500);
  if (!row.target_post_id && !row.target_user_id && !row.target_external) return 'noop';
  try { await sb('/rest/v1/reports', 'POST', [row], { 'Prefer': 'return=minimal' }); }
  catch (e: any) { if (!/duplicate|23505|409/i.test(String(e && e.message))) throw e; }
  return 'sent';
}

/**
 * File a report. scope 'post'|'comment' hides the item for the reporter at once;
 * 'account' reports the author. Returns the toast text the web showed.
 */
export async function submitReport(t: { scope: 'post' | 'comment' | 'account'; id: string; post?: Partial<Post> | null; author: Author | null }, reason: string, note = ''): Promise<string> {
  const a = t.author, p = t.post;
  const r: Report = { reason, note: note.trim(), at: env.now() };
  if (t.scope === 'account') { r.userId = (a && a.uid) || null; r.external = a ? a.key : null; }
  else {
    r.postId = baseId(t.id); r.userId = null;
    const url = t.scope === 'post' && p ? (p._url || p.sourceUrl || '') : '';
    r.external = [a ? a.key : '', t.scope === 'comment' ? 'comment:' + t.id : 'post:' + baseId(t.id), url].filter(Boolean).join(' ');
    hiddenPosts.add(t.scope === 'comment' ? t.id : baseId(t.id)); saveHidden();
  }
  try {
    const st = await sendReport(r);
    return st === 'queued' ? 'REPORT SAVED · SENDS WHEN SIGNED IN' : t.scope === 'account' ? 'ACCOUNT REPORTED · THANK YOU' : 'REPORTED · HIDDEN FOR YOU';
  } catch { const q = rd<Report[]>(LS.reports, []); q.push(r); wr(LS.reports, q); return 'REPORT SAVED · WILL RETRY'; }
}
/** Block (Void) / hide (external) an author, or undo. Returns the toast text. */
export async function toggleBlock(a: Author): Promise<string> {
  if (isBlocked(a)) return unblock(a.key, a);
  const b: Block = { key: a.key, uid: a.uid || null, handle: a.handle || '', label: a.label || a.handle, source: a.source, external: !!a.external, hostOnly: !!a.hostOnly, at: env.now() };
  blocks.push(b); saveBlocks();
  const msg = a.external ? (a.hostOnly ? 'SOURCE HIDDEN' : 'AUTHOR HIDDEN') : 'BLOCKED @' + String(a.handle || a.label).toUpperCase();
  if (!a.external) { try { await pushBlock(b); } catch { return 'BLOCKED ON THIS DEVICE · SYNC PENDING'; } }
  return msg;
}
export async function unblock(key: string, a?: Author): Promise<string> {
  const b = blocks.find(x => x.key === key || (a && a.uid && x.uid === a.uid)); if (!b) return '';
  blocks = blocks.filter(x => x !== b); saveBlocks();
  if (!b.external && b.uid && ready()) { try { await sb('/rest/v1/blocks?blocker_id=eq.' + encodeURIComponent(me()!) + '&blocked_id=eq.' + encodeURIComponent(b.uid), 'DELETE'); } catch { /* */ } }
  return (b.external ? 'SHOWING ' : 'UNBLOCKED ') + String(b.handle || b.label).toUpperCase() + ' · REFRESH TO SEE POSTS';
}
export function isBlockedUser(u: string | { id: string; handle?: string } | null | undefined): boolean {
  if (!u) return false; if (typeof u === 'string') u = { id: u };
  const uuid = VoidAPI._uuid(u.id);
  return isBlocked({ key: uuid ? 'uid:' + u.id : 'void:' + nh(u.handle), uid: uuid ? u.id : null, handle: nh(u.handle), label: '', source: 'void', external: false });
}

let _syncedFor: string | null = null, _syncing = false;
/** Web: 4s after boot, then every 30s while visible. Returns true if new server blocks arrived (re-filter surfaces). */
export async function syncModeration(): Promise<boolean> {
  if (_syncing || !ready()) return false; const uid = me()!; _syncing = true; let changed = false;
  try {
    if (rd(LS.termsSync, false)) { try { await sb('/rest/v1/profiles?id=eq.' + encodeURIComponent(uid), 'PATCH', { terms_accepted_at: new Date(env.now()).toISOString() }, { 'Prefer': 'return=minimal' }); wr(LS.termsSync, false); } catch { /* */ } }
    const q = rd<Report[]>(LS.reports, []);
    if (q.length) { const left: Report[] = []; for (const r of q) { try { await sendReport(r); } catch { left.push(r); } } wr(LS.reports, left); }
    for (const b of blocks.filter(b => !b.external && !b.synced)) { try { await pushBlock(b); } catch { /* */ } }
    if (_syncedFor !== uid) {
      const rows = await sb('/rest/v1/blocks?select=blocked_id,created_at,blocked:blocked_id(handle,display_name)&blocker_id=eq.' + encodeURIComponent(uid), 'GET').catch(() => null);
      if (Array.isArray(rows)) {
        let added = 0;
        rows.forEach((r: any) => {
          if (idx.uids.has(r.blocked_id)) return; const pr = r.blocked || {};
          blocks.push({ key: 'uid:' + r.blocked_id, uid: r.blocked_id, handle: nh(pr.handle), label: pr.display_name || pr.handle || 'Void user', source: 'void', external: false, synced: true, at: Date.parse(r.created_at) || env.now() }); added++;
        });
        if (added) { saveBlocks(); changed = true; }
        _syncedFor = uid;
      }
    }
  } finally { _syncing = false; }
  return changed;
}

// ─── terms gate on every write path ──────────────────────────────────────
export const termsOk = () => !!rd(LS.terms, null);
export async function acceptTerms(): Promise<void> {
  wr(LS.terms, new Date(env.now()).toISOString());
  if (ready()) {
    try { await sb('/rest/v1/profiles?id=eq.' + encodeURIComponent(me()!), 'PATCH', { terms_accepted_at: new Date(env.now()).toISOString() }, { 'Prefer': 'return=minimal' }); }
    catch { wr(LS.termsSync, true); }
  } else wr(LS.termsSync, true);
}
/** true = may post now; false = show the Terms sheet (then acceptTerms() and retry). Checks the server for another device's acceptance. */
export async function termsGate(): Promise<boolean> {
  if (termsOk()) return true;
  if (ready()) {
    try {
      const r = await sb('/rest/v1/profiles?id=eq.' + encodeURIComponent(me()!) + '&select=terms_accepted_at', 'GET');
      if (r && r[0] && r[0].terms_accepted_at) { wr(LS.terms, r[0].terms_accepted_at); return true; }
    } catch { /* */ }
  }
  return false;
}
