// .post-media for 'image' and 'video' posts (renderPost) and the thread OP media slot.
//
//   .post-media{width:100%;margin:0 0 12px;aspect-ratio:16/9;background:var(--card2);overflow:hidden;border-radius:13px}
//   LIGHT: background #e2dbc9
//   image: orbit loader until painted; a failed image removes the whole box (mediaFailed)
//   video: sparkle float until the poster or the first frame paints; then the real clip,
//          muted + loop, plays while >=60% in view and pauses when it leaves (observeVideos)
//          and a tap opens the reel. In the thread the clip is the destination: native
//          controls, no reel hand-off.
import React, { memo, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { VideoView } from 'expo-video';
import { moderation, type Post } from '../../../core';
import { useTheme } from '../../../theme/ThemeProvider';
import { ImageOrbitLoader } from '../../../ui/ImageOrbitLoader';
import { SparkleLoader } from '../../../ui/SparkleLoader';
import { VText } from '../../../ui/Text';
import { FONTS, em } from '../../../theme/palettes';
import { settingsAutoplay } from '../format';
import { openPhoto, openReel } from '../navigation';
import { useInView, useLifted } from '../stores';
import { hasSharedPlayer, isSharedPlaying, useSharedPlayer } from '../videoStore';
import { GraphicVeil, VeilDim } from './GraphicVeil';

export interface PostMediaProps {
  post: Post;
  /** 'thread' = the OP slot (controls, keeps a borrowed player playing). */
  mode?: 'feed' | 'thread';
  surface?: string;
  style?: StyleProp<ViewStyle>;
}

export const PostMedia = memo(function PostMedia({ post: p, mode = 'feed', surface = 'feed', style }: PostMediaProps) {
  const theme = useTheme();
  const inThread = mode === 'thread';
  const video = p._video || undefined;
  const poster = p._img;
  // renderPost: a 'video' post (or a clip with no still) waits behind the sparkle float,
  // an image behind the orbit.
  const isVideoPost = p.style === 'video' || (!poster && !!video);

  const [posterShown, setPosterShown] = useState(false);
  const [frameShown, setFrameShown] = useState(false);
  const [failed, setFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const veiled = !revealed && moderation.graphicVeilOn() && moderation.isGraphic(p);
  const lifted = useLifted(p.id);
  const inView = useInView(p.id, surface);

  // preload="none": no player until the card has been in view once (or a thread borrows one).
  const everInView = useRef(false);
  if (inView) everInView.current = true;
  const wantPlayer = !!video && !videoFailed && !veiled && (inThread || (!lifted && (everInView.current || hasSharedPlayer(p.id)) && settingsAutoplay()));
  const player = useSharedPlayer(p.id, video, wantPlayer);
  // Thread: remember whether the clip arrived playing (borrowed from the card).
  const borrowedPlaying = useRef(inThread ? isSharedPlaying(p.id) : false);

  // Play-on-view (feed only). A lifted card leaves its player alone: the thread owns it.
  useEffect(() => {
    if (!player || inThread || lifted) return;
    try {
      if (inView && settingsAutoplay()) player.play();
      else if (player.playing) player.pause();
    } catch {}
  }, [player, inView, inThread, lifted]);

  // Thread: a clip that was playing keeps playing; otherwise it waits for the controls.
  useEffect(() => {
    if (!player || !inThread) return;
    try {
      if (borrowedPlaying.current && !player.playing) player.play();
    } catch {}
  }, [player, inThread]);

  // <video onerror="this.remove()">: the poster (if any) stays.
  useEffect(() => {
    if (!player) return;
    let s: { remove(): void } | null = null;
    try {
      s = player.addListener('statusChange', (e: any) => {
        if (e && e.status === 'error') setVideoFailed(true);
      });
    } catch {}
    return () => s?.remove();
  }, [player]);

  if (failed) {
    // Feed: mediaFailed removes the host. Thread: the web printed MEDIA FAILED in the box.
    if (!inThread) return null;
    return (
      <View style={[styles.box, { backgroundColor: theme.isLight ? '#e2dbc9' : theme.colors.card2 }, style]}>
        <View style={styles.lblBox}>
          <VText style={[styles.lbl, { color: theme.colors.muted }]}>MEDIA FAILED</VText>
        </View>
      </View>
    );
  }
  if (!poster && !video) return null;

  const painted = posterShown || frameShown;
  const onPress = () => {
    if (veiled) return setRevealed(true);
    if (inThread) {
      if (!video && poster) openPhoto(p.id);
      return;
    }
    if (video) openReel(p.id);
    else if (poster) openPhoto(p.id);
    // else openThread: the card's own press handles it (the box does not claim the tap)
  };
  const showVideoView = !!player && !(lifted && !inThread) && !videoFailed;

  return (
    <Pressable onPress={onPress} disabled={inThread && !!video && !veiled} style={[styles.box, { backgroundColor: theme.isLight ? '#e2dbc9' : theme.colors.card2 }, style]}>
      {poster ? (
        <Image
          source={{ uri: poster }}
          style={[StyleSheet.absoluteFill, { zIndex: 1 }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          blurRadius={veiled ? 32 : 0}
          recyclingKey={p.id}
          onDisplay={() => setPosterShown(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
      {showVideoView ? (
        <View style={[StyleSheet.absoluteFill, { zIndex: 1, backgroundColor: frameShown ? '#000' : 'transparent' }]} pointerEvents={inThread ? 'auto' : 'none'}>
          <VideoView
            player={player!}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            nativeControls={inThread}
            allowsPictureInPicture={false}
            onFirstFrameRender={() => setFrameShown(true)}
          />
        </View>
      ) : null}
      {veiled ? <VeilDim /> : null}
      {!painted && isVideoPost ? <SparkleLoader surface="feed" radius={13} /> : null}
      {!painted && !isVideoPost && poster ? <ImageOrbitLoader surface="feed" radius={13} /> : null}
      {veiled ? <GraphicVeil /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  box: { width: '100%', aspectRatio: 16 / 9, marginBottom: 12, position: 'relative', overflow: 'hidden', borderRadius: 13 },
  lblBox: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  lbl: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.15) },
});
