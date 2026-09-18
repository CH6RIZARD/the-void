// Small pure helpers ported verbatim from void2-final.html (esc/fmt/ago/AVC/_tcCol/auFmt).
import type { Post } from '../../core';
import { env } from '../../core';

/** web AVC — seeded avatar colours. */
export const AVC = ['#3b1f8a', '#1f3a8a', '#8a1f3a', '#1f8a3a', '#5b1f8a', '#8a5b1f', '#6b1f5a'];

/** web fmt(n) */
export function fmt(n: number | undefined | null): string {
  const v = Number(n) || 0;
  return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v);
}

/** web ago(ts) */
export function ago(ts: number | undefined | null): string {
  const d = Math.floor((Date.now() - (Number(ts) || 0)) / 1000);
  if (d < 60) return d + 's';
  if (d < 3600) return Math.floor(d / 60) + 'm';
  if (d < 86400) return Math.floor(d / 3600) + 'h';
  return Math.floor(d / 86400) + 'd';
}

/** web auFmt(s) */
export const auFmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** web _tcCol(name): avatar colour keyed to the author, stable across sorts. */
export function tcCol(name: string | undefined | null): string {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return AVC[Math.abs(h) % AVC.length];
}

/** renderPost typeIco */
export const TYPE_ICO: Record<string, string> = { drop: '◈', take: '✦', image: '▣', video: '▷', audio: '◉', carousel: '⊞', link_live: '⊕', link_thread: '⊡' };
export const typeIco = (p: Post) => TYPE_ICO[p.style as string] || '◈';

/** renderPost avatar letter + colour. */
export const avatarLetter = (p: Post) => String(p._author || p.iso || '?')[0].toUpperCase();
export const avatarColor = (p: Post, i: number) => p._isoColor || AVC[i % AVC.length] || '#2a1060';

/** SETTINGS.lang (localStorage v_lang, default en). */
export function settingsLang(): string {
  try {
    return env.storage.getItem('v_lang') || 'en';
  } catch {
    return 'en';
  }
}
/** SETTINGS.autoplay (localStorage v_autoplay !== 'false'). */
export function settingsAutoplay(): boolean {
  try {
    return env.storage.getItem('v_autoplay') !== 'false';
  } catch {
    return true;
  }
}

/** Audio pill fallback duration + wave bar heights (renderPost). */
export const auDuration = (p: Post, i: number) => p._audioDur || 97 + ((i * 53) % 140);
export const auBars = (seed: number) => Array.from({ length: 26 }, (_, j) => 6 + Math.round((Math.sin(j * 0.9 + seed) * 0.5 + 0.5) * 20));

/** openThread source label. */
const SRC_LABEL: Record<string, string> = {
  reddit: 'REDDIT', twitter: 'X', instagram: 'INSTAGRAM', telegram: 'TELEGRAM', youtube: 'YOUTUBE', void: 'VOID', forum: 'FORUM',
  mastodon: 'MASTODON', lemmy: 'LEMMY', bluesky: 'VOID', peertube: 'PEERTUBE', radio: 'RADIO', commons: 'WIKIMEDIA COMMONS',
};
export function sourceLabel(p: Post): string {
  if (p.source === 'news') return String((p.provenance && p.provenance.sourceHost) || p._author || 'NEWS').toUpperCase();
  return SRC_LABEL[p.source as string] || 'SOURCE';
}
