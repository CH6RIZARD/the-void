// One reel's <video class="vw-vid"> (vwAttach / vwTryPlay / vwWarm / vwPlay / vwPause /
// vwRelease / vwClearLoad), on expo-video.
//
// Mounted by ReelItem only while the card is within two of the one in view — that is
// the web's window: vwWarm(next 1, next 2) attaches the source WITHOUT playing so the
// next clip is already buffering (commit 1577dfb), and vwRelease frees anything more
// than two away. Mounting = attach (player created, source loading), unmounting =
// release (player freed). `want` = this is the card in view on an active surface.
//
// The sparkle loader is cleared on the first sign of media (web: loadeddata / canplay /
// canplaythrough / playing) AND on failure (a 404 / codec refusal must never leave the
// loader spinning forever).
import React, { memo, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { VideoView } from 'expo-video';
import { isReleasedPlayer, usePacedPlayer } from '../live/pacedPlayer';

export interface ReelVideoProps {
  uri: string;
  want: boolean;
  muted: boolean;
  /** Fit whole (landscape) instead of filling. Owned by the card, which may know it
   *  from the poster before this player reports a track. */
  wide: boolean;
  /** First sign of media, or (ok === false) the clip failed: either way the loader goes. */
  onMediaReady(ok?: boolean): void;
  /** The surface has drawn its first frame (the poster over it can go). */
  onFirstFrame?(): void;
  /** The clip is landscape (or square): it is fitted whole, not cropped to fill. */
  onWide?(wide: boolean): void;
}

/** Wider than this (w/h) is fitted whole; anything taller fills the portrait card. */
export const WIDE_ASPECT = 0.8;

export const ReelVideo = memo(function ReelVideo({ uri, want, wide, muted, onMediaReady, onFirstFrame, onWide }: ReelVideoProps) {
  const player = usePacedPlayer({ uri, contentType: /\.m3u8(\?|$)/i.test(uri) ? 'hls' : 'auto' } as any, (p) => {
    p.muted = true; // v.muted = v.defaultMuted = true
    p.loop = true;
    try {
      // hls.js {maxBufferLength:8}
      (p as any).bufferOptions = { ...((p as any).bufferOptions || {}), preferredForwardBufferDuration: 8 };
    } catch {}
    try {
      (p as any).showNowPlayingNotification = false;
    } catch {}
  });

  const wantRef = useWantRef(want);

  // LANDSCAPE CLIPS ARE FITTED, NOT CROPPED. object-fit:cover on a 16:9 clip in a
  // tall portrait card kept only its middle third, blown up and pixelated - 'the
  // reel content is too big'. A clip wider than WIDE_ASPECT is shown whole; the
  // card puts its own poster, blurred, behind it. The track size, when it comes,
  // corrects the poster's guess.
  useEffect(() => {
    if (!player) return;
    const judge = (t: any) => {
      const s = t && t.size;
      if (!s || !(s.width > 0) || !(s.height > 0)) return;
      onWide?.(s.width / s.height > WIDE_ASPECT);
    };
    try {
      judge((player as any).videoTrack);
    } catch {}
    const sub = player.addListener('videoTrackChange', (e: any) => judge(e && e.videoTrack));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  useEffect(() => {
    if (!player) return; // paced creation: not built yet
    const clear = (ok = true) => onMediaReady(ok);
    const subStatus = player.addListener('statusChange', (e: any) => {
      const st = e && e.status;
      if (st === 'readyToPlay') {
        clear();
        // canplay → vwTryPlay if this card is wanted
        if (wantRef.want) {
          try {
            player.play();
          } catch {}
        }
      } else if (st === 'error') clear(false);
    });
    const subPlaying = player.addListener('playingChange', (e: any) => {
      if (e && (e.isPlaying ?? e)) clear();
    });
    // The source may already be ready (or failed) before the listeners attached.
    try {
      if (player.status === 'error') clear(false);
      else if (player.status === 'readyToPlay' || player.playing) clear();
    } catch {}
    return () => {
      subStatus.remove();
      subPlaying.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  // vwPlay / vwPause
  useEffect(() => {
    try {
      // A released player aborts the process if touched (see pacedPlayer).
      if (!player || isReleasedPlayer(player)) return;
      if (want) player.play();
      else player.pause();
    } catch {}
  }, [want, player]);

  useEffect(() => {
    if (!player) return;
    try {
      player.muted = muted;
      if (!muted) player.volume = 1;
    } catch {}
  }, [muted, player]);

  return player ? (
    <VideoView
      player={player}
      style={[StyleSheet.absoluteFill, wide ? styles.vidWide : styles.vid]}
      contentFit={wide ? 'contain' : 'cover'}
      nativeControls={false}
      allowsPictureInPicture={false}
      onFirstFrameRender={onFirstFrame}
    />
  ) : null;
});

function useWantRef(want: boolean) {
  const ref = React.useRef({ want }).current;
  ref.want = want;
  return ref;
}

const styles = StyleSheet.create({
  // .vw-vid{object-fit:cover;background:#05020e}
  vid: { backgroundColor: '#05020e' },
  // Fitted whole: the bars must show the blurred poster behind, not a flat fill.
  vidWide: { backgroundColor: 'transparent' },
});
