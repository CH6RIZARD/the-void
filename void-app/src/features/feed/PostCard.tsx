// <PostCard> = renderPost(p, i) from void2-final.html, with the VMod wrapper (⋯ menu,
// graphic veil, hidden posts render nothing). Shared by the feed, nation, search and
// profile surfaces — keep the props contract stable.
//
//   .post{background:var(--card);border-radius:20px;padding:18px;margin:0 16px 12px;
//         box-shadow:var(--elev),inset 0 1px 0 rgba(255,255,255,.06);animation:vfadeIn .28s ease both}
//   .post.highlight (i===0){background:linear-gradient(160deg,rgba(124,58,237,.14),rgba(13,8,32,.9) 60%)}
//   .post:active{opacity:.72}   .pa:active{opacity:.6;transform:scale(.94)}
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { moderation, onRepliesChanged, type Post } from '../../core';
import { useTheme } from '../../theme/ThemeProvider';
import { FONTS, em } from '../../theme/palettes';
import { Icon, type IconName } from '../../ui/icons';
import { VText } from '../../ui/Text';
import { ImageOrbitLoader } from '../../ui/ImageOrbitLoader';
import { SparkleLoader } from '../../ui/SparkleLoader';
import { avatarColor, avatarLetter, fmt, ago, typeIco } from './format';
import { AudioPill } from './media/AudioPill';
import { PostCarousel } from './media/PostCarousel';
import { PostMedia } from './media/PostMedia';
import { openPostMenu } from './ModerationSheet';
import { openCountry, openLive, openThreadRoute, openUser } from './navigation';
import { boltCount, fireBolt, toggleRepost, touchPost, usePostReaction } from './reactions';
import { beginFlip, isPostHidden, useLifted, useModerationVersion, type Rect } from './stores';
import { toggleTranslate, useTranslation } from './translate';
import { VmodIcon } from './vmodIcons';

export type PostSurface = 'feed' | 'nation' | 'search' | 'profile';

export interface PostCardProps {
  post: Post;
  /** Running list index: highlight on 0, stagger, avatar colour, audio seed. */
  index: number;
  /**
   * Override the navigation on tap (default: push /thread/<encoded id>). The FLIP rect is
   * recorded before this runs, so a caller that pushes the thread route still gets the lift.
   */
  onOpenThread?: (id: string, post: Post) => void;
  /** Which surface renders it: keys play-on-view (see usePostViewability). Default 'feed'. */
  surface?: PostSurface;
  /**
   * The uid whose profile this card sits on. Their own face there would open the page
   * already showing, so it leaves the tap to the card; anyone else's (a HEARTED drop)
   * still opens their profile.
   */
  ownerUid?: string | null;
  style?: StyleProp<ViewStyle>;
}

// syncReplyCount mutates post.replies; every card showing that post repaints.
onRepliesChanged((postId) => touchPost(postId));

// vfadeIn runs once per post id (a recycled row scrolling back does not re-fade).
const faded = new Set<string>();
const EASE = Easing.bezier(0.25, 0.1, 0.25, 1);

function Pa({ icon, label, color, onPress, style, iconColor }: { icon?: IconName; label: string; color: string; iconColor?: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} hitSlop={{ top: 11, bottom: 11, left: 4, right: 4 }} style={({ pressed }) => [styles.pa, pressed && { opacity: 0.6, transform: [{ scale: 0.94 }] }, style]}>
      {icon ? <Icon name={icon} size={13} color={iconColor || color} /> : null}
      <VText style={[styles.paT, { color }]}>{label}</VText>
    </Pressable>
  );
}

export const PostCard = memo(function PostCard({ post: p, index: i, onOpenThread, surface = 'feed', ownerUid, style }: PostCardProps) {
  const theme = useTheme();
  const { colors, isLight } = theme;
  useModerationVersion();
  const r = usePostReaction(p.id);
  const tr = useTranslation('post:' + p.id);
  const lifted = useLifted(p.id);
  const ref = useRef<View>(null);


  const measure = useCallback((cb: (r: Rect | null) => void) => {
    const node = ref.current;
    if (!node) return cb(null);
    try {
      node.measureInWindow((x, y, width, height) => cb(width && height ? { x, y, width, height } : null));
    } catch {
      cb(null);
    }
  }, []);

  const open = useCallback(() => {
    measure((rect) => {
      beginFlip(p.id, rect, measure);
      if (onOpenThread) onOpenThread(p.id, p);
      else openThreadRoute(p.id);
    });
  }, [measure, onOpenThread, p]);

  if (isPostHidden(p)) return null;

  const take = p.style === 'take';
  const col = avatarColor(p, i);
  const highlight = i === 0;
  const media = renderMedia(p, i, surface);

  const avatarStyle = isLight
    ? { backgroundColor: '#ded7c5', boxShadow: 'inset 0px 0px 0px 1px rgba(26,20,36,0.12), 0px 2px 6px rgba(26,20,36,0.12)' }
    : { backgroundColor: col, boxShadow: p._user ? '0px 0px 0px 2px rgba(201,168,76,0.35)' : '0px 0px 0px 2px rgba(124,58,237,0.35)' };

  // Void accounts only (they have a uid). External/source authors, and drops already
  // on their author's profile (ownerUid), leave the tap to the card, which opens the thread.
  const author = moderation.authorOf(p);
  const toUser = author?.uid && author.uid !== ownerUid ? author.handle : null;

  return (
    <FadeIn id={p.id} index={i} viewRef={ref} style={style}>
      <Pressable
        onPress={open}
        style={({ pressed }) => [
          styles.post,
          { backgroundColor: highlight ? 'transparent' : colors.card, boxShadow: `${colors.elev}, inset 0px 1px 0px rgba(255,255,255,0.06)` },
          pressed && { opacity: 0.72 },
          // visibility:hidden while its copy is the thread's OP card
          lifted && { opacity: 0 },
        ]}
      >
        {highlight ? (
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(124,58,237,0.14)', 'rgba(13,8,32,0.9)']}
            locations={[0, 0.6]}
            start={{ x: 0.33, y: 0 }}
            end={{ x: 0.67, y: 1 }}
            style={[StyleSheet.absoluteFill, { borderRadius: 20 }]}
          />
        ) : null}

        <View style={styles.header}>
          <Pressable disabled={!toUser} onPress={() => openUser(toUser)} style={[styles.avatar, avatarStyle]}>
            <VText style={[styles.avT, { color: isLight ? '#4a4234' : colors.white }]}>{avatarLetter(p)}</VText>
          </Pressable>
          <Pressable disabled={!toUser} onPress={() => openUser(toUser)} style={styles.meta}>
            <VText style={[styles.name, { color: colors.white }]}>
              {p._author || p.iso || 'void'}{' '}
              <VText style={[styles.handle, { color: colors.muted }]}>{p._handle || '@void'}</VText>
            </VText>
            <VText style={[styles.time, { color: colors.muted }]}>{ago(p.time)}</VText>
          </Pressable>
          <VText style={[styles.typeIco, { color: colors.muted }]}>{typeIco(p)}</VText>
          {!p._user ? (
            <Pressable onPress={() => openPostMenu(p)} style={styles.more} accessibilityLabel="More" hitSlop={6}>
              <VmodIcon name="more" size={17} color={colors.navDim} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.bodyWrap}>
          {p._replyTo ? (
            // dim, not muted: muted is a hairline / fill colour in these palettes
            // (~1.3:1 on the card), dim is the mock's secondary mono text. The handle
            // takes the mock's gold @handle accent; purple is a structural grey in DARK.
            <VText numberOfLines={2} style={[styles.replyTo, { color: colors.dim }]}>
              {'Replying to '}
              <VText style={{ color: colors.gold, fontFamily: FONTS.sansSemiBold }}>{p._replyTo.handle}</VText>
              {p._replyTo.body ? ' · ' + p._replyTo.body : ''}
            </VText>
          ) : null}
          {tr.pending ? (
            <VText style={[styles.translating, { color: colors.white }]}>translating…</VText>
          ) : (
            <VText style={[take ? styles.bodyTake : styles.body, { color: colors.white }]}>
              {tr.text != null ? tr.text : p.body || ''}
              {tr.text != null ? (
                <VText style={[styles.trBadge, { color: colors.purple }]}>{'  ↺ ' + tr.lang.toUpperCase() + ' '}</VText>
              ) : null}
            </VText>
          )}
        </View>

        {media}

        <View style={styles.acts}>
          <Pa icon="reply" label={fmt((p.replies || 0) + (r.rank || 0))} color={colors.dim} onPress={open} />
          <Pa icon={r.mf ? 'heartFill' : 'heart'} label={fmt(boltCount(p.score, r))} color={r.mf ? colors.gold : colors.dim} onPress={() => fireBolt(p.id)} />
          <Pa icon="repost" label={fmt(p.reposts || p._reposts || 0)} color={r.mrp ? colors.gold : colors.dim} onPress={() => toggleRepost(p.id)} />
          <Pa
            icon="globe"
            label="TR"
            color={tr.pending || tr.text != null ? colors.white : colors.dim}
            onPress={() => toggleTranslate('post:' + p.id, p.body || '')}
            style={{ marginLeft: 'auto' }}
          />
        </View>
      </Pressable>
    </FadeIn>
  );
});

// .post{animation:vfadeIn .28s ease both}, as its own component.
//
// THE FADE'S END STATE IS WRITTEN INTO REACT. React's own props for the card keep
// the first render's opacity 0 for its whole life; the fade's frames reach the
// native view only through Reanimated (its UI commits, which it skips while a React
// commit is pending, and its settled-props sync, which a JS stall or a stopped GC
// timer can lose). When they don't, the card sits at alpha 0 until some React
// commit lands - "the nation feed is loaded but the content won't show till I tap
// or scroll". The fade's end now commits its own settled state, and a settled card
// drops the animated style: no opacity 0 is left in React's props to fall back
// to. Here rather than in PostCard so that commit re-renders one View, not the
// whole card (media, actions, text) in the middle of a nation open.
const FadeIn = memo(function FadeIn({
  id,
  index,
  viewRef,
  style,
  children,
}: {
  id: string;
  index: number;
  viewRef: React.RefObject<View | null>;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const fade = useSharedValue(faded.has(id) ? 1 : 0);
  const [settled, setSettled] = useState(() => faded.has(id));
  useEffect(() => {
    if (faded.has(id)) {
      // Already faded (a re-mount, or a second card for the same post in the same
      // commit): show it settled rather than leave this instance at fade 0.
      setSettled(true);
      return;
    }
    faded.add(id);
    fade.value = withDelay(
      Math.min(index, 8) * 40,
      withTiming(1, { duration: 280, easing: EASE }, (done) => {
        if (done) runOnJS(setSettled)(true);
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ translateY: (1 - fade.value) * 3 }] }));
  return (
    <Animated.View ref={viewRef as any} collapsable={false} style={[styles.outer, settled ? null : fadeStyle, style]}>
      {children}
    </Animated.View>
  );
});

function renderMedia(p: Post, i: number, surface: string): React.ReactNode {
  if (p._pending && p._pendingKind && p._pendingKind !== 'text') return <PendingMedia kind={p._pendingKind} />;
  if (p.style === 'image' || p.style === 'video') return p._img || p._video ? <PostMedia post={p} surface={surface} /> : null;
  if (p.style === 'carousel') return <PostCarousel post={p} />;
  if (p.style === 'audio') return <AudioPill post={p} index={i} />;
  const any = p as any;
  if (p.style === 'link_live' && any._linkedLive) return <PostRef glyph="⊕" glyphColor="red" label={'LIVE · ' + any._linkedLive.n} onPress={openLive} />;
  if (p.style === 'link_thread' && any._linkedThread) return <PostRef glyph="⊡" glyphColor="gold" label={String(any._linkedThread.label)} onPress={() => openCountry(any._linkedThread.country)} />;
  return null;
}

/** A drop whose media is still uploading: loader only, never the local file. */
function PendingMedia({ kind }: { kind: 'image' | 'video' | 'audio' }) {
  const { colors, isLight } = useTheme();
  return (
    <View style={[styles.pending, { backgroundColor: isLight ? '#e2dbc9' : colors.card2 }, kind === 'audio' && { aspectRatio: undefined, height: 72 }]}>
      {kind === 'image' ? <ImageOrbitLoader surface="feed" label="UPLOADING" radius={13} /> : <SparkleLoader surface="feed" label="UPLOADING" radius={13} />}
    </View>
  );
}

/** .post-ref link row */
function PostRef({ glyph, glyphColor, label, onPress }: { glyph: string; glyphColor: 'red' | 'gold'; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.ref, { backgroundColor: colors.card2, borderColor: colors.border }]}>
      <VText style={[styles.refT, { color: colors[glyphColor] }]}>{glyph}</VText>
      <VText numberOfLines={1} style={[styles.refT, { color: colors.dim, flexShrink: 1 }]}>
        {label}
      </VText>
      <VText style={[styles.refArr, { color: colors.muted }]}>↗</VText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: { marginHorizontal: 16, marginBottom: 12 },
  post: { borderRadius: 20, padding: 18 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avT: { fontFamily: FONTS.sansExtraBold, fontSize: 12 },
  meta: { flex: 1, minWidth: 0 },
  name: { fontFamily: FONTS.sansBold, fontSize: 12 },
  handle: { fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.06) },
  time: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.05), marginTop: 1 },
  typeIco: { fontSize: 11, marginTop: 2, flexShrink: 0 },
  more: { width: 28, height: 26, marginTop: -4, marginRight: -6, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  bodyWrap: { marginBottom: 12 },
  // Readable, unlike the 8px mono meta: it is the line that says what this reply means.
  replyTo: { fontFamily: FONTS.sans, fontSize: 12, lineHeight: 16, marginBottom: 6 },
  body: { fontFamily: FONTS.serifItalic, fontSize: 15.5, lineHeight: 15.5 * 1.45 },
  bodyTake: { fontFamily: FONTS.sansSemiBold, fontSize: 14, lineHeight: 14 * 1.5 },
  translating: { opacity: 0.5, fontSize: 11, fontFamily: FONTS.mono },
  trBadge: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.08), backgroundColor: 'rgba(124,58,237,0.1)' },
  acts: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  pa: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  paT: { fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.05) },
  pending: { width: '100%', aspectRatio: 16 / 9, marginBottom: 12, borderRadius: 13, overflow: 'hidden' },
  ref: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 11, borderWidth: 1, borderRadius: 3, marginBottom: 12 },
  refT: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.07) },
  refArr: { marginLeft: 'auto', fontSize: 9 },
});

export default PostCard;
