// Handle rules. The web's local rules (validateHandle: 2+ chars, letters/numbers/_/.)
// are looser than the database (profiles.handle ~* '^[a-z0-9_]{3,20}$'), so a
// web-valid handle like "a.b" or the random anonymous "@x1y2z" could never be
// written to profiles. Native enforces BOTH: validateHandle's messages first, then
// the DB rule.
import { validateHandle, env } from '../../core';

export const DB_HANDLE_RE = /^[a-z0-9_]{3,20}$/;
export const HANDLE_MAX = 20;

/** '' when the handle can be stored in profiles, else the on-screen error (web si-err copy style). */
export function handleError(raw: string): string {
  const base = validateHandle(raw);
  if (base) return base;
  const h = stripHandle(raw);
  if (h.length < 3) return 'HANDLE TOO SHORT';
  if (h.length > HANDLE_MAX) return 'HANDLE TOO LONG · 20 MAX';
  if (!DB_HANDLE_RE.test(h)) return 'LETTERS, NUMBERS AND _ ONLY';
  return '';
}

export function stripHandle(raw: string): string {
  return String(raw || '').trim().replace(/^@/, '').toLowerCase();
}

/** A random anonymous handle that passes the DB check: void_xxxxxx. */
export function anonHandle(): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += abc[Math.floor(env.random() * abc.length)];
  return '@void_' + s;
}

/** Keep a stored local handle if it is DB-valid, else mint an anonymous one. */
export function dbSafeLocalHandle(h: string | undefined | null): string {
  return h && !handleError(h) ? '@' + stripHandle(h) : anonHandle();
}
