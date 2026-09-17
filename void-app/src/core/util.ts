// Small pure helpers shared by feed/rank/api. DOM-free replacements for the few
// browser APIs the web code leaned on (URL getters, DOMParser).
import { env } from './env.ts';

export interface ParsedUrl { host: string; hostname: string; pathname: string; }

// React Native's URL polyfill does not implement host/hostname/pathname getters,
// so `new URL(u).host` (used all over the web code) is replaced by this. Mirrors
// WHATWG for http(s)-style URLs: lower-cased host, default port dropped, empty
// path -> '/'. Throws on a relative / scheme-less string, like `new URL(u)`.
export function parseUrl(u: unknown): ParsedUrl {
  const s = String(u == null ? '' : u).trim();
  const m = /^([a-z][a-z0-9+.\-]*):\/\/([^\/?#]*)([^?#]*)/i.exec(s);
  if (!m) throw new TypeError('Invalid URL: ' + s);
  const scheme = m[1].toLowerCase();
  let auth = m[2];
  const at = auth.lastIndexOf('@'); if (at >= 0) auth = auth.slice(at + 1);
  if (!auth && (scheme === 'http' || scheme === 'https')) throw new TypeError('Invalid URL: ' + s);
  let hostname = auth.toLowerCase(), port = '';
  const pm = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/.exec(hostname);
  if (pm) { hostname = pm[1]; port = pm[2] || ''; }
  const defaults: Record<string, string> = { http: '80', https: '443', ws: '80', wss: '443', ftp: '21' };
  if (port && defaults[scheme] === port) port = '';
  let pathname = m[3] || '';
  if (!pathname && defaults[scheme]) pathname = '/';
  pathname = pathname.replace(/ /g, '%20');
  return { host: port ? hostname + ':' + port : hostname, hostname, pathname };
}

// Ids land in keys and handlers, so they must never carry punctuation from the
// source URL — hash it instead (djb2-xor).
export function urlKey(u: string): string { let h = 5381; for (let i = 0; i < u.length; i++) h = ((h * 33) ^ u.charCodeAt(i)) >>> 0; return h.toString(36); }

export function decodeEnt(s: string | null | undefined): string {
  return (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

const NAMED_ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    const v = NAMED_ENT[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/**
 * HTML -> plain text with paragraph/line breaks kept. The web used
 * DOMParser().body.textContent; this is tag-strip + entity decode, which is what
 * textContent yields for Mastodon/PeerTube status HTML.
 */
export function htmlText(h: unknown): string {
  const withBreaks = String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p>/gi, '\n\n');
  return decodeEntities(withBreaks.replace(/<[^>]+>/g, '')).trim();
}

export function nfHost(u: unknown): string { try { return parseUrl(u).host.replace(/^www\./, ''); } catch { return ''; } }
export function lemmyHost(u: unknown): string { try { return parseUrl(u).host; } catch { return 'lemmy.world'; } }
export function fediHost(u: unknown): string { try { return parseUrl(u).host; } catch { return ''; } }

export const nfFold = (s: unknown): string => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** GET JSON with a hard timeout; null on any failure (non-2xx, abort, parse). */
export async function nfFetchJson(u: string, ms = 9000): Promise<any> {
  const AC: any = (globalThis as any).AbortController;
  const ctl = AC ? new AC() : null;
  const t = setTimeout(() => { try { ctl && ctl.abort(); } catch { /* */ } }, ms);
  try {
    const r = await env.fetch(u, { headers: { Accept: 'application/json' }, signal: ctl ? ctl.signal : undefined });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

export function escRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function readJSON<T>(key: string, fallback: T): T {
  try { const v = JSON.parse(env.storage.getItem(key) || 'null'); return v == null ? fallback : v; } catch { return fallback; }
}
export function writeJSON(key: string, v: unknown): void {
  try { env.storage.setItem(key, JSON.stringify(v)); } catch { /* quota / unavailable */ }
}
