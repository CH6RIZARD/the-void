// Adapter over Agent B's pure core (src/core/streams, src/core/data).
//
// Every call from the globe/live features into the core goes through THIS file, so
// if B's final export names differ from what is assumed below, only this file needs
// touching. Required exports are read through a namespace import so a missing
// OPTIONAL helper degrades to a local fallback instead of breaking the bundle.
//
// Expected (see src/features/globe/README.md → "Core contract"):
//   streams.wallSlots(): WallSlot[]
//   streams.wallCascadeFor(name: string, first: StreamSource | null): StreamSource[]
//   streams.streamKey(src: StreamSource): string
//   streams.liveVidFor(src: StreamSource): string | null | undefined
//   streams.markBadStream(src) / streams.isBadStream(src)   (or a `badStreams: Set<string>`)
//   streams.rememberStream(src)                              (optional, session memory)
//   data.C: Country[]                                        ({ n, iso, lat, lon })
import * as streams from '../../core/index.ts';
import * as data from '../../core/index.ts';

export type StreamType = 'youtube' | 'hls' | 'mjpeg' | 'iframe';

export interface StreamSource {
  type: StreamType;
  /** youtube: channel id (UC…), 11-char video id, or playlist id (PL/UU/OLAK). */
  id?: string;
  /** youtube: resolved live video id for a channel. */
  vid?: string;
  /** hls / mjpeg / iframe URL. */
  url?: string;
  label?: string;
  thumbnail?: string;
  [k: string]: unknown;
}

export interface WallSlot {
  name: string;
  src: StreamSource;
  kind?: 'life' | 'news';
}

export interface Country {
  n: string;
  iso: string;
  lat: number;
  lon: number;
  [k: string]: unknown;
}

const S = streams as any;
const D = data as any;

export function streamKey(src: StreamSource): string {
  if (typeof S.streamKey === 'function') return S.streamKey(src);
  return src.type === 'youtube' ? `youtube:${src.id}` : `${src.type}:${src.url || ''}`;
}

export function wallSlots(): WallSlot[] {
  return S.wallSlots();
}

export function wallCascadeFor(name: string, first: StreamSource | null): StreamSource[] {
  return S.wallCascadeFor(name, first);
}

export function liveVidFor(src: StreamSource): string | null | undefined {
  return S.liveVidFor(src);
}

// Session-scoped dead-feed memory (bars/slate, removed/embed-disabled VODs).
const localBad = new Set<string>();
function badSet(): Set<string> {
  return S.badStreams instanceof Set ? S.badStreams : S._badStreams instanceof Set ? S._badStreams : localBad;
}
export function markBadStream(src: StreamSource | null | undefined): void {
  if (!src) return;
  if (typeof S.markBadStream === 'function') return S.markBadStream(src);
  const k = streamKey(src);
  if (k) badSet().add(k);
}
/** Sources refused on principle (test streams). See keys.ts. */
export function isBannedStream(s: { url?: string; id?: string } | null | undefined): boolean {
  return typeof S.isBannedStream === 'function' ? !!S.isBannedStream(s) : false;
}

export function isBadStream(src: StreamSource | null | undefined): boolean {
  if (!src) return false;
  if (typeof S.isBadStream === 'function') return !!S.isBadStream(src);
  const k = streamKey(src);
  return !!(k && badSet().has(k));
}

export function rememberStream(src: StreamSource): void {
  try {
    if (typeof S.rememberStream === 'function') S.rememberStream(src);
  } catch {}
}

export function countries(): Country[] {
  return (D.C || []) as Country[];
}
