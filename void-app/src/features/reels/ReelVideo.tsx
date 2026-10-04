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
  onMediaReady(): void;
  /** The surface has drawn its first frame (the poster over it can go). */
  onFirstFrame?(): void;
}

export const ReelVideo = memo(function ReelVideo({ uri, want, muted, onMediaReady, onFirstFrame }: ReelVideoProps) {
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

  useEffect(() => {
    if (!player) return; // paced creation: not built yet
    const clear = () => onMediaReady();
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
      } else if (st === 'error') clear();
    });
    const subPlaying = player.addListener('playingChange', (e: any) => {
      if (e && (e.isPlaying ?? e)) clear();
    });
    // The source may already be ready (or failed) before the listeners attached.
    try {
      if (player.status === 'readyToPlay' || player.status === 'error' || player.playing) clear();
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

  return player ? <VideoView player={player} style={[StyleSheet.absoluteFill, styles.vid]} contentFit="cover" nativeControls={false} allowsPictureInPicture={false} onFirstFrameRender={onFirstFrame} /> : null;
});

function useWantRef(want: boolean) {
  const ref = React.useRef({ want }).current;
  ref.want = want;
  return ref;
}

const styles = StyleSheet.create({
  // .vw-vid{object-fit:cover;background:#05020e}
  vid: { backgroundColor: '#05020e' },
});
