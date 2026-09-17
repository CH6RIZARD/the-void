// Real direct messages over Supabase — port of the web MESSAGING MODULE
// (void2-final.html ~8845-9120). 001 conversations / conversation_members / messages,
// 007 messages.body. start_dm() is the only way a conversation is created.
//
// NOT END-TO-END ENCRYPTED. Bodies are stored on The Void's servers (TLS in transit,
// members-only RLS at rest) and the UI says exactly that.
//
// Delivery: 5s poll while a chat is open, 15s poll of the list. No Realtime socket.
import { useSyncExternalStore } from 'react';
import { moderation, VoidAPI, voidEnsureSession, voidUuid } from '../../core';
import { setDmUnread } from '../../nav/badges';
import { ensureCore, getIdentity } from '../auth/coreBridge';

export interface DmUser { id: string; handle: string; name: string }
export interface DmMessage { id: string; conversation_id: string; sender_id: string; body: string; created_at: string; _pending?: boolean }
export interface DmConv { id: string; other: DmUser; last: DmMessage | null; unread: number; lastReadAt?: string | null }
export interface DmPerson { id: string; handle: string; display_name?: string | null }
export type DmState = 'idle' | 'loading' | 'ready' | 'offline' | 'unavailable';

export const DM_NOTE = "Messages are stored on The Void's servers and are not end-to-end encrypted.";
export const DM_FOOT = "NOT ENCRYPTED · STORED ON THE VOID'S SERVERS";

interface Snapshot { convs: DmConv[]; msgs: Record<string, DmMessage[]>; state: DmState; rev: number }
let snap: Snapshot = { convs: [], msgs: {}, state: 'idle', rev: 0 };
const subs = new Set<() => void>();
function emit(patch: Partial<Snapshot>) {
  snap = { ...snap, ...patch, rev: snap.rev + 1 };
  subs.forEach((s) => s());
}
function subscribe(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}
export function useDmStore(): Snapshot {
  return useSyncExternalStore(subscribe, () => snap, () => snap);
}
export function getDmSnapshot(): Snapshot {
  return snap;
}

let serverBlocked = new Set<string>();
let blocksMissing = false;

export function dmMe(): string | null {
  return VoidAPI._uid();
}
/** Server-side blocks (006) plus the on-device block list (VMod), either direction. */
export function dmIsBlocked(uid: string, handle?: string): boolean {
  if (serverBlocked.has(uid)) return true;
  try {
    return moderation.isBlockedUser({ id: uid, handle: handle || '' });
  } catch {
    return false;
  }
}
const AVC = ['#3b1f8a', '#1f3a8a', '#8a1f3a', '#1f8a3a', '#5b1f8a', '#8a5b1f', '#6b1f5a'];
export function dmColor(id: string): string {
  let h = 0;
  for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVC[h % AVC.length];
}
export function ago(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return d + 's';
  if (d < 3600) return Math.floor(d / 60) + 'm';
  if (d < 86400) return Math.floor(d / 3600) + 'h';
  return Math.floor(d / 86400) + 'd';
}

async function session() {
  await ensureCore();
  const u = getIdentity();
  return voidEnsureSession({ handle: u.handle, name: u.name });
}

function refreshBadge(convs = snap.convs) {
  setDmUnread(convs.some((c) => (c.unread || 0) > 0));
}

async function loadBlocks(): Promise<void> {
  if (blocksMissing) return;
  const me = dmMe();
  try {
    const rows = await VoidAPI._sb('/rest/v1/blocks?select=blocker_id,blocked_id&or=(blocker_id.eq.' + me + ',blocked_id.eq.' + me + ')', 'GET');
    serverBlocked = new Set((rows || []).map((r: any) => (r.blocker_id === me ? r.blocked_id : r.blocker_id)));
  } catch (e: any) {
    if (/blocks|PGRST205|42P01|schema cache|does not exist|404/i.test(String(e && e.message))) blocksMissing = true;
  }
}

export async function loadConversations(): Promise<void> {
  if (snap.state === 'idle') emit({ state: 'loading' });
  try {
    await session();
  } catch {
    emit({ state: 'offline' });
    return;
  }
  const me = dmMe();
  try {
    await loadBlocks();
    const mine: any[] = (await VoidAPI._sb('/rest/v1/conversation_members?user_id=eq.' + me + '&select=conversation_id,last_read_at', 'GET')) || [];
    if (!mine.length) {
      emit({ convs: [], state: 'ready' });
      refreshBadge([]);
      return;
    }
    const inList = 'in.(' + mine.map((m) => m.conversation_id).join(',') + ')';
    const [others, msgs] = await Promise.all([
      VoidAPI._sb('/rest/v1/conversation_members?conversation_id=' + inList + '&user_id=neq.' + me + '&select=conversation_id,user_id,profiles:user_id(handle,display_name)', 'GET'),
      VoidAPI._sb('/rest/v1/messages?conversation_id=' + inList + '&body=not.is.null&select=id,conversation_id,sender_id,body,created_at&order=created_at.desc&limit=500', 'GET'),
    ]);
    const readAt: Record<string, string | null> = Object.fromEntries(mine.map((m) => [m.conversation_id, m.last_read_at]));
    const convs: DmConv[] = ((others as any[]) || [])
      .filter((o) => !dmIsBlocked(o.user_id, o.profiles && o.profiles.handle))
      .map((o) => {
        const cm = ((msgs as DmMessage[]) || []).filter((m) => m.conversation_id === o.conversation_id);
        const lr = readAt[o.conversation_id] ? Date.parse(readAt[o.conversation_id] as string) : 0;
        const prof = o.profiles || {};
        return {
          id: o.conversation_id,
          other: { id: o.user_id, handle: prof.handle || 'void', name: prof.display_name || prof.handle || 'void' },
          last: cm[0] || null,
          unread: cm.filter((m) => m.sender_id !== me && Date.parse(m.created_at) > lr).length,
          lastReadAt: readAt[o.conversation_id],
        };
      })
      .sort((a, b) => (b.last ? Date.parse(b.last.created_at) : 0) - (a.last ? Date.parse(a.last.created_at) : 0));
    // The open chat's already-read state wins over a list refresh racing it.
    if (activeConv) convs.forEach((c) => { if (c.id === activeConv) c.unread = 0; });
    emit({ convs, state: 'ready' });
    refreshBadge(convs);
  } catch (e: any) {
    // messages.body missing = migration 007 not applied on this project.
    emit({ state: /body|column/i.test(String(e && e.message)) ? 'unavailable' : 'offline' });
  }
}

/** Handle / name search for starting a DM (web dmSearchPeople). Excludes me, blocked, existing convs. */
export async function searchPeople(q: string): Promise<DmPerson[]> {
  const clean = q.replace(/[^a-z0-9_ ]/gi, '').trim();
  if (clean.length < 2) return [];
  let rows: DmPerson[] = [];
  try {
    await session();
    rows = (await VoidAPI._sb('/rest/v1/profiles?or=(handle.ilike.*' + encodeURIComponent(clean) + '*,display_name.ilike.*' + encodeURIComponent(clean) + '*)&select=id,handle,display_name&limit=12', 'GET')) || [];
  } catch {
    rows = [];
  }
  const me = dmMe();
  const inConv = new Set(snap.convs.map((c) => c.other.id));
  return rows.filter((p) => p.id !== me && !dmIsBlocked(p.id, p.handle) && !inConv.has(p.id));
}

/** Start (or reopen) the DM with a user id. Returns the conversation id, or throws the toast text. */
export async function startDm(userId: string): Promise<string> {
  try {
    await session();
  } catch {
    throw new Error('COULD NOT OPEN CHAT');
  }
  if (userId === dmMe()) throw new Error("THAT'S YOU");
  if (dmIsBlocked(userId)) throw new Error('YOU BLOCKED THIS ACCOUNT');
  try {
    const conv = await VoidAPI._sb('/rest/v1/rpc/start_dm', 'POST', { other_user: userId });
    await loadConversations();
    return String(conv);
  } catch (e: any) {
    throw new Error(/dm_blocked|blocked|42501/i.test(String(e && e.message)) ? "CAN'T MESSAGE THIS ACCOUNT · BLOCKED" : 'COULD NOT OPEN CHAT');
  }
}

/** dm_blocked(conv) RPC (007): a block either way on the server. false when the RPC is missing. */
export async function serverDmBlocked(convId: string): Promise<boolean> {
  try {
    const r = await VoidAPI._sb('/rest/v1/rpc/dm_blocked', 'POST', { conv: convId });
    return r === true;
  } catch {
    return false;
  }
}

let activeConv: string | null = null;
export function setActiveConv(id: string | null) {
  activeConv = id;
}

/** web dmPollChat(full). Returns false when the first load failed (MESSAGES OFFLINE). */
export async function pollChat(convId: string, full: boolean): Promise<boolean> {
  const have = (snap.msgs[convId] || []).filter((m) => !m._pending);
  const since = !full && have.length ? have[have.length - 1].created_at : null;
  let rows: DmMessage[];
  try {
    rows =
      (await VoidAPI._sb(
        '/rest/v1/messages?conversation_id=eq.' + convId + '&body=not.is.null' + (since ? '&created_at=gt.' + encodeURIComponent(since) : '') + '&select=id,conversation_id,sender_id,body,created_at&order=created_at.desc&limit=200',
        'GET',
      )) || [];
  } catch {
    return !(full && !have.length);
  }
  rows.reverse();
  const cur = snap.msgs[convId] || [];
  const ids = new Set(cur.map((m) => m.id));
  const fresh = rows.filter((m) => !ids.has(m.id));
  let next = cur;
  if (full || fresh.length) {
    next = full ? rows.concat(cur.filter((m) => m._pending && !rows.some((r) => r.id === m.id))) : cur.concat(fresh);
  }
  const convs = snap.convs.map((c) => {
    if (c.id !== convId) return c;
    const last = next.filter((m) => !m._pending).slice(-1)[0] || c.last;
    return { ...c, last, unread: c.unread || fresh.length || full ? 0 : c.unread };
  });
  const c = snap.convs.find((x) => x.id === convId);
  emit({ msgs: { ...snap.msgs, [convId]: next }, convs });
  if (c && (c.unread || fresh.length || full)) {
    refreshBadge(convs);
    VoidAPI._sb('/rest/v1/conversation_members?conversation_id=eq.' + convId + '&user_id=eq.' + dmMe(), 'PATCH', { last_read_at: new Date().toISOString() }, { Prefer: 'return=minimal' }).catch(() => {});
  }
  return true;
}

/**
 * Optimistic send + rollback. Returns '' when sent, else the toast text
 * (the caller puts the text back in the input).
 */
export async function sendMessage(convId: string, raw: string): Promise<string> {
  const text = raw.trim();
  if (!text || !convId) return 'EMPTY';
  if (text.length > 2000) return 'TOO LONG · 2000 MAX';
  const c = snap.convs.find((x) => x.id === convId);
  if (c && dmIsBlocked(c.other.id, c.other.handle)) return 'YOU BLOCKED THIS ACCOUNT';
  const me = dmMe() || '';
  const msg: DmMessage = { id: voidUuid(), conversation_id: convId, sender_id: me, body: text, created_at: new Date().toISOString(), _pending: true };
  emit({ msgs: { ...snap.msgs, [convId]: [...(snap.msgs[convId] || []), msg] } });
  try {
    const rows = await VoidAPI._sb('/rest/v1/messages', 'POST', [{ id: msg.id, conversation_id: convId, sender_id: me, body: text }], { Prefer: 'return=representation' });
    const saved = rows && rows[0];
    const sent: DmMessage = { ...msg, created_at: (saved && saved.created_at) || msg.created_at };
    delete sent._pending;
    emit({
      msgs: { ...snap.msgs, [convId]: (snap.msgs[convId] || []).map((m) => (m.id === msg.id ? sent : m)) },
      convs: snap.convs.map((x) => (x.id === convId ? { ...x, last: sent } : x)),
    });
    return '';
  } catch (e: any) {
    emit({ msgs: { ...snap.msgs, [convId]: (snap.msgs[convId] || []).filter((m) => m.id !== msg.id) } });
    const m = String(e && e.message);
    return /dm_blocked|row-level|policy|42501/i.test(m) ? "NOT SENT · CAN'T MESSAGE THIS ACCOUNT" : /body|column/i.test(m) ? 'NOT SENT · MESSAGING NOT AVAILABLE YET' : 'NOT SENT · RETRY';
  }
}

/** Nav DMS dot outside the Messages tab: call from the tabs layout (see README). */
let badgeTimer: ReturnType<typeof setInterval> | null = null;
export function startDmBadgePoll(ms = 60000): () => void {
  if (!badgeTimer) {
    loadConversations().catch(() => {});
    badgeTimer = setInterval(() => {
      if (!activeConv) loadConversations().catch(() => {});
    }, ms);
  }
  return () => {
    if (badgeTimer) clearInterval(badgeTimer);
    badgeTimer = null;
  };
}
