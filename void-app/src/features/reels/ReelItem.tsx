// One reel card — vwItemHtml(p,i) plus the moderation wrapper (⋯ after FOLLOW for
// non-own posts, graphic veil), 1:1 with the web CSS.
//
// .vw-item{height:100%;position:relative;overflow:hidden;background:#05020e}
// .vw-cover{inset:0;background:radial-gradient(120% 90% at 30% 20%, COL, #05020e 65%)}  COL = p._isoColor || hsl(H,55%,14%)
//   audio  → cover + .vw-audio-wrap(au-pill)
//   video  → cover + sparkle(z1, no taps) + <video muted loop playsinline poster=_img>
//   image  → cover + IMG_LOADER + <img onerror=remove>
//   else   → cover
// .vw-scan{inset:0;repeating-linear-gradient(0deg,transparent 0 3px,rgba(255,255,255,.012) 3px 4px)}
// .vw-rail{right:12px;bottom:130px (inline globe: 110px);z-index:3;gap:8px}
// .vw-act{46px circle;background:rgba(13,8,32,.82) (pointer:coarse);box-shadow:inset 0 1px 0 rgba(255,255,255,.1);color:#f4f0ff;gap:1px} .vi 17px
//   span{'Syne Mono' 6.5px;rgba(255,255,255,.6);.05em}  .gold{#c9a84c}  .dim{#6a58a0}   :active{opacity:.72}
// .vw-info{left:0;right:0;bottom:0;z-index:2;padding:100px 70px 24px 18px;background:linear-gradient(transparent,rgba(4,2,12,.95) 70%)}
// .vw-id-row{gap:8px;margin-bottom:10px}
// .vw-av{28px circle;font-size:10px;800;#f4f0ff;box-shadow:0 0 0 2px rgba(201,168,76,.5);background:COL}
// .vw-name{12px 700 #f4f0ff}
// .vw-follow{padding:2px 10px;radius 16;border:1px solid rgba(201,168,76,.5);'Syne Mono' 7px .12em #c9a84c}  (hit area inset -9px)
// .vmod-vmore{margin-left:auto;28x24;color:rgba(244,240,255,.8)} .vi 17px
// .vw-body{'DM Serif Display' italic 20px/1.38 #f4f0ff; clamp 3}  .open{no clamp;max-height:48vh;scroll}
// .vw-more{margin-top:6px;'Syne Mono' 8px .18em var(--gold)}  shown when body.length > 150
// .vw-meta{gap:4px;'Syne Mono' 8px rgba(255,255,255,.45) .12em;margin-top:8px} .vi 11px
// .vw-spine{height:2px;radius 1;margin-top:12px;rgba(255,255,255,.12)}  i{linear-gradient(90deg,#7c3aed,#c9a84c);width 0→100% 6s linear}
// .vw-burst{centre;z9;#c9a84c;84px;drop-shadow(0 0 24px rgba(201,168,76,.8));vwB .7s: scale .4→1.4, opacity 0→1(25%)→0}
// .vmod-veil{centre (top 40% on a reel);gap:6px;padding:10px 16px;radius 18;rgba(4,2,12,.72);inset ring rgba(255,255,255,.14);
//   'Syne Mono' 8px .2em #f4f0ff}  em{7px rgba(244,240,255,.6)}   media: blur(32px) brightness(.5)
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated as RNAnimated, Easing as RNEasing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import type { Post } from '../../core';
import { moderation } from '../../core';
import { Icon, type IconName } from '../../ui/icons';
import { SparkleLoader } from '../../ui/SparkleLoader';
import { ImageOrbitLoader } from '../../ui/ImageOrbitLoader';
import { useTheme } from '../../theme/tokens';
import { FONTS, em } from '../../theme/palettes';
import { ago, baseId, fmt } from '../search/format';
import { ModIcon } from './ModIcons';
import { ReelAudioPill } from './ReelAudioPill';
import { ReelVideo, WIDE_ASPECT } from './ReelVideo';
import { boltCount, isFollowing, repostCount } from './reelStore';
import { PersonPfp } from '../../ui/Pfp';

export interface ReelItemProps {
  item: Post;
  index: number;
  height: number;
  /** Card in view (>50%). */
  current: boolean;
  /** In view AND the surface is active → play. */
  want: boolean;
  /** Within two of the card in view → player attached (warm / release window). */
  attached: boolean;
  /** Seen at least once → spine filled. */
  viewed: boolean;
  railBottom: number;
  /** Height of the chrome under the card (nav pill or system nav): the info block starts above it. */
  bottomClear: number;
  soundOn: boolean;
  surfaceActive: boolean;
  /** Re-render key for reactions/follows. */
  storeVersion: number;
  loaderCleared: boolean;
  onLoaderCleared(vid: string): void;
  onToggleSound(): void;
  onFire(item: Post): void;
  onReply(pid: string): void;
  onRepost(pid: string): void;
  onShare(pid: string): void;
  onLess(item: Post, index: number): void;
  onFollow(item: Post): void;
  onMenu(item: Post): void;
  onAuthor(item: Post): void;
}

const bg = (g: string): any => ({ experimental_backgroundImage: g });
// THE SHAPE IS KNOWN BEFORE THE FIRST FRAME. No source carries a video's aspect, and
// the player reports its track size only once media arrives - so a landscape clip
// opened cropped and blown up (poster and player both on cover) and then snapped to
// the fitted size. The poster is the same picture: its size, from expo-image's
// onLoad, settles the fit before the player has anything to show.
const isWideSource = (e: any): boolean => {
  const s = e && e.source;
  return !!(s && s.width > 0 && s.height > 0 && s.width / s.height > WIDE_ASPECT);
};
const coverOf = (p: Post) => p._isoColor || `hsl(${p.imgHue || 270},55%,14%)`;

/**
 * A card outside the heavy window: the cover and the poster, nothing else. It is
 * off screen when it mounts and is swapped for the full card once the scroll has
 * settled next to it, so no swipe pays for a rail, a loader or a player.
 */
export const ReelPlaceholder = memo(function ReelPlaceholder({ item: p, height }: { item: Post; height: number }) {
  const [wide, setWide] = useState(false);
  return (
    <View style={[styles.item, { height }]}>
      <View style={[StyleSheet.absoluteFill, bg(`radial-gradient(120% 90% at 30% 20%, ${coverOf(p)}, #05020e 65%)`)]} />
      {p._img && p.style !== 'audio' ? (
        // A long drag can bring a placeholder on screen: a graphic post keeps its veil here too.
        <Image
          source={{ uri: p._img }}
          style={StyleSheet.absoluteFill}
          contentFit={wide ? 'contain' : 'cover'}
          cachePolicy="memory-disk"
          transition={0}
          onLoad={(e) => setWide(isWideSource(e))}
          blurRadius={moderation.graphicVeilOn() && moderation.isGraphic(p) ? 32 : 0}
        />
      ) : null}
    </View>
  );
});

// .vw-act — at module level: defined inside ReelItem it was a new component type
// on every render, so all five buttons unmounted and remounted each time.
function RailAct({ icon, label, onPress, tone, custom }: { icon?: IconName; label: string; onPress(): void; tone?: 'gold' | 'dim'; custom?: React.ReactNode }) {
  const c = tone === 'gold' ? '#c9a84c' : tone === 'dim' ? '#6a58a0' : '#f4f0ff';
  const lc = tone === 'gold' ? '#c9a84c' : tone === 'dim' ? '#6a58a0' : 'rgba(255,255,255,0.6)';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.act, { opacity: pressed ? 0.72 : 1 }]} accessibilityRole="button" accessibilityLabel={label}>
      {custom ?? <Icon name={icon!} size={17} color={c} />}
      <Text allowFontScaling={false} style={[styles.actText, { color: lc }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export const ReelItem = memo(function ReelItem(props: ReelItemProps) {
  const { item: p, index, height, want, attached, viewed, railBottom, soundOn, loaderCleared, current } = props;
  const { colors } = useTheme();
  const { height: winH, width: winW } = useWindowDimensions();
  const pid = baseId(p.id);
  const vid = p._vid || p.id;
  const col = coverOf(p);
  const [open, setOpen] = useState(false);
  const [imgState, setImgState] = useState<'loading' | 'shown' | 'failed'>('loading');
  const [revealed, setRevealed] = useState(false);
  const veiled = moderation.isGraphic(p) && moderation.graphicVeilOn() && !revealed;

  // ── spine: width 0 → 100% over 6s linear, once the card has been in view.
  // Drawn as a scale pinned to the left edge - the same bar and the same squeezed
  // gradient - on the native driver. Animating `width` relaid out the card on
  // every frame for six seconds after each swipe, and Reanimated commits the tree
  // per frame even for a transform; this costs no JS, no commit and no layout.
  const spine = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    if (!viewed) return;
    const a = RNAnimated.timing(spine, { toValue: 1, duration: 6000, easing: RNEasing.linear, useNativeDriver: true, isInteraction: false });
    a.start();
    return () => a.stop();
  }, [viewed, spine]);
  const spineW = winW - 88; // .vw-info padding: 18 left + 70 right
  // A scale works about the centre; the translate walks the left edge back to 0.
  const spineStyle = useMemo(
    () => ({ transform: [{ translateX: spine.interpolate({ inputRange: [0, 1], outputRange: [-spineW / 2, 0] }) }, { scaleX: spine }] }),
    [spine, spineW],
  );

  // The poster comes off at the first frame the surface actually renders. "Ready"
  // comes earlier (a prepared neighbour has no surface yet) and stays set for the
  // life of the list, which left a returning card on a bare gradient.
  const [frameShown, setFrameShown] = useState(false);
  // THIS player has reported media. (loaderCleared cannot stand in: it is sticky,
  // so on a re-attach it is already true before a player even exists.)
  const [ready, setReady] = useState(false);
  // A landscape clip or photo is fitted whole over its own poster, blurred.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (!attached) {
      setFrameShown(false);
      setReady(false);
    }
  }, [attached]);
  const onFirstFrame = useCallback(() => setFrameShown(true), []);
  // The net under it: a device that never reports a first frame must not keep a
  // poster over a clip that is playing. A clip that failed keeps its poster.
  useEffect(() => {
    if (!attached || frameShown || !want || !ready) return;
    const t = setTimeout(() => setFrameShown(true), 1500);
    return () => clearTimeout(t);
  }, [attached, frameShown, want, ready]);

  // ── bolt burst
  const burst = useSharedValue(0);
  const burstOn = useSharedValue(0);
  const burstStyle = useAnimatedStyle(() => {
    const t = burst.value;
    const opacity = burstOn.value ? (t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75) : 0;
    return { opacity, transform: [{ scale: 0.4 + t * 1.0 }] };
  });

  const fire = useCallback(() => {
    props.onFire(p);
    burstOn.value = 1;
    burst.value = 0;
    burst.value = withSequence(withTiming(1, { duration: 700, easing: Easing.bezier(0.25, 0.1, 0.25, 1) }), withTiming(1, { duration: 0 }, () => {
      burstOn.value = 0;
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, props.onFire]);

  const singleTap = useCallback(() => {
    // graphic filter: the first tap on the media reveals it
    if (veiled) {
      setRevealed(true);
      return;
    }
    if (p._video) props.onToggleSound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [veiled, p._video, props.onToggleSound]);

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(250)
    .onEnd((_e, ok) => {
      'worklet';
      if (ok) runOnJS(fire)();
    });
  const oneTap = Gesture.Tap().onEnd((_e, ok) => {
    'worklet';
    if (ok) runOnJS(singleTap)();
  });
  const taps = Gesture.Exclusive(doubleTap, oneTap);

  const clearedRef = useRef(loaderCleared);
  clearedRef.current = loaderCleared;
  const onMediaReady = useCallback((ok?: boolean) => {
    if (ok !== false) setReady(true);
    if (!clearedRef.current) props.onLoaderCleared(vid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vid]);

  // ── media
  let media: React.ReactNode;
  if (p.style === 'audio') {
    media = <ReelAudioPill index={index} audioId={'reel-audio:' + vid} stopSignal={!props.surfaceActive} />;
  } else if (p._video) {
    media = (
      <>
        {wide && p._img ? <Image source={{ uri: p._img }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={0} blurRadius={24} /> : null}
        {attached ? <ReelVideo uri={p._video} want={want} muted={!(soundOn && current)} wide={wide} onMediaReady={onMediaReady} onFirstFrame={onFirstFrame} onWide={setWide} /> : null}
        {/* The <video poster>: shown whenever there is no player, and - as on the
            web - kept over the player until its first frame, so a cold or
            returning reel opens on its picture instead of an empty gradient. */}
        {p._img && (!attached || !frameShown) ? (
          <Image source={{ uri: p._img }} style={StyleSheet.absoluteFill} contentFit={wide ? 'contain' : 'cover'} cachePolicy="memory-disk" transition={0} onLoad={(e) => setWide(isWideSource(e))} />
        ) : null}
        {!loaderCleared ? <SparkleLoader surface="media" style={styles.z1} /> : null}
      </>
    );
  } else if (p._img) {
    media =
      imgState !== 'failed' ? (
        <>
          {wide ? <Image source={{ uri: p._img }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={0} blurRadius={24} /> : null}
          <Image
            source={{ uri: p._img }}
            style={[StyleSheet.absoluteFill, wide ? null : styles.img]}
            contentFit={wide ? 'contain' : 'cover'}
            cachePolicy="memory-disk"
            transition={0}
            onLoad={(e) => setWide(isWideSource(e))}
            onDisplay={() => setImgState('shown')}
            onError={() => setImgState('failed')}
          />
          {imgState === 'loading' ? <ImageOrbitLoader surface="media" /> : null}
        </>
      ) : null;
  }

  const who = p._author || p.country || 'void';
  const body = String(p.body || '');
  const following = isFollowing(p);

  return (
    <View style={[styles.item, { height }]}>
      <GestureDetector gesture={taps}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <View style={[StyleSheet.absoluteFill, bg(`radial-gradient(120% 90% at 30% 20%, ${col}, #05020e 65%)`)]} />
          {media}
          {veiled && p.style !== 'audio' ? (
            <>
              <BlurView intensity={100} tint="dark" style={[StyleSheet.absoluteFill, styles.z2]} />
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.z2, { backgroundColor: 'rgba(0,0,0,0.5)' }]} />
            </>
          ) : null}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, bg('repeating-linear-gradient(0deg, transparent 0px, transparent 3px, rgba(255,255,255,0.012) 3px, rgba(255,255,255,0.012) 4px)')]} />
          {veiled ? (
            <View pointerEvents="none" style={styles.veilHost}>
              <View style={styles.veil}>
                <ModIcon name="eyeOff" size={18} color="#f4f0ff" />
                <Text allowFontScaling={false} style={styles.veilText}>
                  GRAPHIC CONTENT
                </Text>
                <Text allowFontScaling={false} style={styles.veilEm}>
                  TAP TO VIEW
                </Text>
              </View>
            </View>
          ) : null}
          <Animated.View pointerEvents="none" style={[styles.burst, burstStyle]}>
            <View style={styles.burstGlow}>
              <Icon name="heartFill" size={84} color="#c9a84c" />
            </View>
          </Animated.View>
        </View>
      </GestureDetector>

      <View style={[styles.rail, { bottom: railBottom }]} pointerEvents="box-none">
        <RailAct icon="heart" tone="gold" label={fmt(boltCount(p))} onPress={fire} />
        <RailAct icon="reply" label={fmt(p.replies || 0)} onPress={() => props.onReply(pid)} />
        <RailAct icon="repost" label={fmt(repostCount(p))} onPress={() => props.onRepost(pid)} />
        <RailAct icon="share" label="SHARE" onPress={() => props.onShare(pid)} />
        <RailAct icon="less" tone="dim" label="LESS" onPress={() => props.onLess(p, index)} />
      </View>

      <View style={[styles.info, { paddingBottom: props.bottomClear + 16 }, bg('linear-gradient(transparent, rgba(4,2,12,0.95) 70%)')]} pointerEvents="box-none">
        <View style={styles.idRow}>
          <Pressable onPress={() => props.onAuthor(p)} style={styles.av}>
            <PersonPfp uid={p.author_id || p._authorId} handle={p._handle} label={p._author || p.country} size={28} />
          </Pressable>
          <Pressable onPress={() => props.onAuthor(p)} style={styles.nameWrap}>
            <Text allowFontScaling={false} numberOfLines={1} style={styles.name}>
              {who}
            </Text>
          </Pressable>
          <Pressable onPress={() => props.onFollow(p)} hitSlop={9} style={styles.follow}>
            <Text allowFontScaling={false} style={styles.followText}>
              {following ? 'FOLLOWING' : 'FOLLOW'}
            </Text>
          </Pressable>
          {!p._user ? (
            <Pressable onPress={() => props.onMenu(p)} style={styles.vmore} accessibilityLabel="More" hitSlop={6}>
              <ModIcon name="more" size={17} color="rgba(244,240,255,0.8)" />
            </Pressable>
          ) : null}
        </View>
        {open ? (
          <ScrollView style={{ maxHeight: winH * 0.48 }} nestedScrollEnabled>
            <Text allowFontScaling={false} style={styles.body}>
              {body}
            </Text>
          </ScrollView>
        ) : (
          <Text allowFontScaling={false} numberOfLines={3} style={styles.body}>
            {body}
          </Text>
        )}
        {body.length > 150 ? (
          <Pressable onPress={() => setOpen((o) => !o)} hitSlop={9} style={styles.moreBtn}>
            <Text allowFontScaling={false} style={[styles.moreText, { color: colors.gold }]}>
              {open ? 'LESS' : 'MORE'}
            </Text>
          </Pressable>
        ) : null}
        <View style={styles.meta} pointerEvents="none">
          <Icon name="pin" size={11} color="rgba(255,255,255,0.45)" />
          <Text allowFontScaling={false} style={styles.metaText}>
            {` ${(p.country || 'WORLD').toUpperCase()} · ${ago(p.time)} · SWIPE ↑`}
          </Text>
        </View>
        <View style={styles.spine} pointerEvents="none">
          <RNAnimated.View style={[styles.spineFill, bg('linear-gradient(90deg, #7c3aed, #c9a84c)'), spineStyle]} />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  item: { position: 'relative', overflow: 'hidden', backgroundColor: '#05020e', width: '100%' },
  z1: { zIndex: 1 },
  z2: { zIndex: 2 },
  img: { backgroundColor: '#05020e' },
  veilHost: { position: 'absolute', left: 0, right: 0, top: '40%', alignItems: 'center', zIndex: 4 },
  veil: {
    transform: [{ translateY: -30 }],
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(4,2,12,0.72)',
    boxShadow: 'inset 0px 0px 0px 1px rgba(255,255,255,0.14)',
  } as any,
  veilText: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.2), color: '#f4f0ff' },
  veilEm: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.2), color: 'rgba(244,240,255,0.6)' },
  burst: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', zIndex: 9 },
  burstGlow: { filter: 'drop-shadow(0px 0px 24px rgba(201,168,76,0.8))' } as any,
  rail: { position: 'absolute', right: 12, zIndex: 3, flexDirection: 'column', gap: 8, alignItems: 'center' },
  act: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(13,8,32,0.82)',
    boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  } as any,
  actText: { fontFamily: FONTS.mono, fontSize: 6.5, letterSpacing: em(6.5, 0.05) },
  info: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 2, paddingTop: 100, paddingRight: 70, paddingLeft: 18 },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  av: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden', boxShadow: '0px 0px 0px 2px rgba(201,168,76,0.5)' } as any,
  nameWrap: { flexShrink: 1 },
  name: { fontFamily: FONTS.sansBold, fontSize: 12, color: '#f4f0ff' },
  follow: { paddingVertical: 2, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(201,168,76,0.5)' },
  followText: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.12), color: '#c9a84c' },
  vmore: { marginLeft: 'auto', width: 28, height: 24, alignItems: 'center', justifyContent: 'center' },
  body: { fontFamily: FONTS.serifItalic, fontSize: 20, lineHeight: 20 * 1.38, color: '#f4f0ff' },
  moreBtn: { marginTop: 6, alignSelf: 'flex-start' },
  moreText: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.18) },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  metaText: { fontFamily: FONTS.mono, fontSize: 8, color: 'rgba(255,255,255,0.45)', letterSpacing: em(8, 0.12) },
  spine: { height: 2, borderRadius: 1, marginTop: 12, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  spineFill: { height: '100%', width: '100%', backgroundColor: '#9a6fb0' },
});
