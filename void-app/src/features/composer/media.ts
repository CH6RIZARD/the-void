// Native media plumbing for the composer (and the profile avatar):
//   pick (expo-image-picker, multi-select images + videos)
//   compress (expo-image-manipulator: longest edge <= 2048px, WebP; GIF passes through)
//   upload (core voidUploadMedia with a Blob read from the local file URI)
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { MEDIA_CAPS, MEDIA_EXT, mediaMime, voidUploadMedia } from '../../core';

export interface PickedMedia {
  uri: string;
  kind: 'image' | 'video';
  mime: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number | null;
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  m4a: 'audio/mp4', aac: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', weba: 'audio/webm', caf: 'audio/x-caf', '3gp': 'audio/3gpp',
};
export function mimeFromUri(uri: string, fallback = ''): string {
  const ext = (String(uri).split('?')[0].match(/\.([a-z0-9]+)$/i) || [])[1];
  return (ext && EXT_MIME[ext.toLowerCase()]) || fallback;
}

/** Open the gallery. Returns [] when cancelled. Throws 'GALLERY ACCESS DENIED'. */
export async function pickMedia(opts: { multiple?: boolean; imagesOnly?: boolean; square?: boolean; aspect?: [number, number] } = {}): Promise<PickedMedia[]> {
  const crop = opts.aspect || (opts.square ? ([1, 1] as [number, number]) : undefined);
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted && perm.accessPrivileges !== 'limited') throw new Error('GALLERY ACCESS DENIED');
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: opts.imagesOnly ? ['images'] : ['images', 'videos'],
    allowsMultipleSelection: opts.multiple !== false && !crop,
    allowsEditing: !!crop,
    aspect: crop,
    quality: 1,
    selectionLimit: opts.multiple === false ? 1 : 10,
    orderedSelection: true,
    videoExportPreset: ImagePicker.VideoExportPreset.H264_1920x1080,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (res.canceled) return [];
  return res.assets.map((a) => {
    const kind: 'image' | 'video' = a.type === 'video' ? 'video' : 'image';
    return {
      uri: a.uri,
      kind,
      mime: mediaMime(a.mimeType || mimeFromUri(a.uri, kind === 'video' ? 'video/mp4' : 'image/jpeg')),
      size: a.fileSize || 0,
      width: a.width,
      height: a.height,
      durationMs: a.duration,
    };
  });
}

/** web voidCompressImage(): longest edge <= maxEdge, WebP (JPEG fallback). GIFs untouched. */
export async function compressImage(m: { uri: string; mime: string; width?: number; height?: number }, maxEdge = 2048): Promise<{ uri: string; mime: string }> {
  if (m.mime === 'image/gif') return { uri: m.uri, mime: m.mime };
  const w = m.width || 0;
  const h = m.height || 0;
  const s = w && h ? Math.min(1, maxEdge / Math.max(w, h, 1)) : 1;
  const resize = w && h && s < 1 ? (w >= h ? { width: Math.round(w * s) } : { height: Math.round(h * s) }) : null;
  const run = async (format: ImageManipulator.SaveFormat, compress: number) => {
    const anyIM = ImageManipulator as any;
    if (anyIM.ImageManipulator?.manipulate) {
      const ctx = anyIM.ImageManipulator.manipulate(m.uri);
      if (resize) ctx.resize(resize);
      const img = await ctx.renderAsync();
      return img.saveAsync({ format, compress });
    }
    return ImageManipulator.manipulateAsync(m.uri, resize ? [{ resize }] : [], { format, compress });
  };
  try {
    const out = await run(ImageManipulator.SaveFormat.WEBP, 0.86);
    return { uri: out.uri, mime: 'image/webp' };
  } catch {
    try {
      const out = await run(ImageManipulator.SaveFormat.JPEG, 0.88);
      return { uri: out.uri, mime: 'image/jpeg' };
    } catch {
      if (MEDIA_EXT[m.mime]) return { uri: m.uri, mime: m.mime };
      throw new Error('UNSUPPORTED IMAGE');
    }
  }
}

export async function readBlob(uri: string): Promise<Blob> {
  const r = await fetch(uri);
  return r.blob();
}

/**
 * Upload one local file to post-media. Returns core's {url,path,mime,kind}.
 * Sends bytes, not a Blob: expo/fetch (the global fetch) overwrites Content-Type
 * with a Blob's own type, which for a local file is application/octet-stream, and
 * the bucket rejects that (400 invalid_mime_type). Bytes keep our image/webp etc.
 */
export async function uploadLocal(uri: string, mime: string, kind: 'image' | 'video' | 'audio', user: { handle?: string; name?: string }) {
  const bytes = await (await fetch(uri)).arrayBuffer();
  return voidUploadMedia(bytes, bytes.byteLength, mime, kind, user);
}

export { MEDIA_CAPS, MEDIA_EXT };
