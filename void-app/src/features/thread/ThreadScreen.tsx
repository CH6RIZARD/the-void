// /thread/[id] — the thread overlay (patch3 §4.A + §4.C; void2-final.html openThread /
// closeThread / renderThreadComments / submitComment / translateThreadBody).
//
// Presented OVER the launching screen (route must be a transparent modal): a
// rgba(2,1,8,.7) + blur(3px) scrim, the OP CTA card, the replies divider with TOP/NEW,
// the comment deck and the compose pill. Opening from a PostCard FLIP-lifts the card
// into the OP slot (measured rects, Reanimated), gold ring fading in; the deck deals up
// with a 60ms stagger from T+120. Closing reverses it and hands the card back.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Dimensions, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VoidAPI, fediHost, shareUrl, findPost, loadRemoteReplies, repliesLoading, syncReplyCount, _remoteReplies, type Comment, type Post } from '../../core';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../theme/ThemeProvider';
import { FONTS, em } from '../../theme/palettes';
import { Icon } from '../../ui/icons';
import { VText } from '../../ui/Text';
import { voidToast } from '../../ui/Toast';
import { ago, avatarLetter, AVC, fmt, sourceLabel } from '../feed/format';
import { AudioPill } from '../feed/media/AudioPill';
import { PostCarousel } from '../feed/media/PostCarousel';
import { PostMedia } from '../feed/media/PostMedia';
import { ModerationHost, openAuthorSheet, openCommentMenu, openPostMenu } from '../feed/ModerationSheet';
import { boltCount, fireBolt, toggleRepost, usePostReaction } from '../feed/reactions';
import { currentFlip, endFlip, isPostHidden, setLifted, takeFlip, useModerationVersion, type Rect } from '../feed/stores';
import { toggleTranslate, useTranslation } from '../feed/translate';
import { VmodIcon } from '../feed/vmodIcons';
import { CommentCard } from './CommentCard';
import { ComposePill } from './ComposePill';
import { ReplyOverlay } from './ReplyOverlay';
import { getThreadComments, postReply, setThreadSort, tcSort, tcTree, toggleCommentBolt, useThreadSort, useThreadVersion, viewerName } from './threadModel';
import { useThreadTokens } from './threadTheme';

const FLIP_EASE = Easing.bezier(0.32, 0.72, 0.28, 1);
const EASE_OUT = Easing.bezier(0, 0, 0.58, 1);
const EASE_IN = Easing.bezier(0.42, 0, 1, 1);
const RM = ReduceMotion.System;

interface FlipVec {
  dx: number;
  dy: number;
  s: number;
}

export default function ThreadScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  let postId = String(params.id ?? '');
  try {
    postId = decodeURIComponent(postId);
  } catch {}
  const post = findPost(postId);
  if (!post) return <MissingThread />;
  return <Thread key={postId} post={post} />;
}

function MissingThread() {
  useEffect(() => {
    const t = setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/void' as any)), 0);
    return () => clearTimeout(t);
  }, []);
  return null;
}

function Thread({ post: p }: { post: Post }) {
  const { colors, isLight } = useTheme();
  const tk = useThreadTokens();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const modVersion = useModerationVersion();
  const version = useThreadVersion(p.id);
  const sort = useThreadSort();
  const r = usePostReaction(p.id);
  const tr = useTranslation('thread:' + p.id);

  // ─── open / close choreography ────────────────────────────────────────────
  const scrim = useSharedValue(0);
  const pop = useSharedValue(0); // popin (no source card)
  const chrome = useSharedValue(0); // divider + compose (tFadeIn .24s .12s when flipping)
  const flipP = useSharedValue(1); // 0 = on the card rect, 1 = at rest
  const closeP = useSharedValue(0); // close flip back onto the card
  const opFade = useSharedValue(1); // close without a card: fade + drop
  const ready = useSharedValue(0); // OP hidden until measured
  const from = useSharedValue<FlipVec>({ dx: 0, dy: 0, s: 1 });
  const to = useSharedValue<FlipVec>({ dx: 0, dy: 0, s: 1 });
  const flipping = useSharedValue(0);

  const opRef = useRef<View>(null);
  const measured = useRef(false);
  const [dealT0] = useState(() => Date.now());
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  // A hidden post never opens (web VMod openThread wrapper).
  useEffect(() => {
    if (isPostHidden(p) && !closingRef.current) {
      voidToast('HIDDEN · BLOCKED OR REPORTED');
      close(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modVersion]);

  // Replies warmed before the tap: OP count and divider agree at once; then pull.
  useEffect(() => {
    if (_remoteReplies[p.id]) syncReplyCount(p.id);
    loadRemoteReplies(p.id);
  }, [p.id]);

  useEffect(() => {
    scrim.value = withTiming(1, { duration: 240, easing: EASE_OUT, reduceMotion: RM });
    // However the route goes away (close, swipe-dismiss), the source card comes back.
    return () => endFlip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onOpLayout = useCallback(() => {
    if (measured.current) return;
    measured.current = true;
    const flip = takeFlip(p.id);
    const node = opRef.current;
    const popIn = () => {
      ready.value = 1;
      chrome.value = 1;
      pop.value = withTiming(1, { duration: 240, easing: EASE_OUT, reduceMotion: RM });
    };
    if (!flip || !flip.rect || !node) return popIn();
    node.measureInWindow((x, y, width, height) => {
      const a = flip.rect as Rect;
      if (!width || !a.width) return popIn();
      from.value = { dx: a.x + a.width / 2 - (x + width / 2), dy: a.y + a.height / 2 - (y + height / 2), s: a.width / width };
      setLifted(p.id); // the tapped card hides: its copy is the OP now
      pop.value = 1;
      flipP.value = 0;
      flipping.value = 1;
      ready.value = 1;
      flipP.value = withTiming(1, { duration: 300, easing: FLIP_EASE, reduceMotion: RM });
      chrome.value = 0;
      setTimeout(() => {
        chrome.value = withTiming(1, { duration: 240, easing: EASE_OUT, reduceMotion: RM });
      }, 120);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  const finish = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/void' as any);
    // the card shows again as the overlay goes away
    setTimeout(endFlip, 0);
  }, []);

  const [roStack, setRoStack] = useState<string[]>([]);
  const [roInstant, setRoInstant] = useState(false);

  const close = useCallback(
    (instant?: boolean) => {
      if (closingRef.current) return;
      closingRef.current = true;
      setRoInstant(true);
      setRoStack([]);
      if (instant) return finish();
      setClosing(true);
      const tops = topCount.current;
      const k = Math.min(tops, 6);
      let dur = 200 + Math.max(0, k - 1) * 30;
      chrome.value = withTiming(0, { duration: 180, easing: EASE_IN, reduceMotion: RM });
      scrim.value = withTiming(0, { duration: 240, easing: EASE_OUT, reduceMotion: RM });
      const flip = currentFlip(p.id);
      const node = opRef.current;
      const fallback = () => {
        opFade.value = withTiming(0, { duration: 200, easing: EASE_IN, reduceMotion: RM });
      };
      const run = (a: Rect | null) => {
        if (a && node) {
          node.measureInWindow((x, y, width, height) => {
            if (!width || !a.width) return fallback();
            to.value = { dx: a.x + a.width / 2 - (x + width / 2), dy: a.y + a.height / 2 - (y + height / 2), s: a.width / width };
            flipping.value = 1;
            closeP.value = withTiming(1, { duration: 260, easing: FLIP_EASE, reduceMotion: RM });
          });
          dur = Math.max(dur, 260);
        } else fallback();
        setTimeout(finish, dur);
      };
      if (flip && flip.measure) {
        flip.measure((rect) => {
          // only when the source card is still (partly) on screen
          const onScreen = rect && rect.width && rect.y + rect.height > 0 && rect.y < Dimensions.get('window').height;
          run(onScreen ? rect : null);
        });
      } else run(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.id, finish],
  );

  const closeReplies = useCallback(() => setRoStack((s) => s.slice(0, -1)), []);
  const closeAllReplies = useCallback(() => setRoStack([]), []);
  const [roFocus, setRoFocus] = useState(0);
  const openReplies = useCallback((cid: string, focus?: boolean) => {
    setRoInstant(false);
    setRoStack((s) => (s[s.length - 1] === cid ? s : s.concat(cid)));
    if (focus) setRoFocus((n) => n + 1);
  }, []);

  // Android back: pop the reply overlay first, then close the thread.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (roStackRef.current.length) {
        closeReplies();
        return true;
      }
      close();
      return true;
    });
    return () => sub.remove();
  }, [close, closeReplies]);
  const roStackRef = useRef(roStack);
  roStackRef.current = roStack;

  // ─── animated styles ─────────────────────────────────────────────────────
  const swipeOut = Gesture.Pan()
    .activeOffsetX([-9999, 24])
    .failOffsetY([-14, 14])
    .onEnd((e) => {
      'worklet';
      // A deliberate push to the right, not a stray drift while scrolling.
      if (e.translationX > 80 && e.velocityX > 0) runOnJS(close)();
    });
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const popStyle = useAnimatedStyle(() => ({ opacity: pop.value, transform: [{ translateY: (1 - pop.value) * 12 }] }));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chrome.value }));
  const opStyle = useAnimatedStyle(() => {
    let tx = 0,
      ty = 0,
      sc = 1;
    const f = flipP.value;
    if (f < 1) {
      const a = from.value;
      if (f < 0.78) {
        const k = f / 0.78;
        tx = a.dx * (1 - k);
        ty = a.dy * (1 - k);
        sc = a.s + (1.02 - a.s) * k;
      } else {
        const k = (f - 0.78) / 0.22;
        sc = 1.02 + (1 - 1.02) * k;
      }
    }
    const c = closeP.value;
    if (c > 0) {
      const b = to.value;
      tx = b.dx * c;
      ty = b.dy * c;
      sc = 1 + (b.s - 1) * c;
    }
    return {
      opacity: ready.value * opFade.value,
      transform: [{ translateX: tx }, { translateY: ty + (1 - opFade.value) * 12 }, { scale: sc }],
    };
  });
  // gold ring + deep shadow: _T_SH0 (none) -> _T_SH1 at .78 -> the card's resting shadow
  const ringStyle = useAnimatedStyle(() => {
    const f = flipP.value;
    const c = closeP.value;
    let o = 0;
    if (flipping.value) o = f < 0.78 ? f / 0.78 : 1 - (f - 0.78) / 0.22;
    if (c > 0) o = 0;
    return { opacity: o };
  });
  const restShadowStyle = useAnimatedStyle(() => {
    const f = flipP.value;
    return { opacity: (flipping.value ? Math.min(1, f) : 1) * (1 - closeP.value) };
  });

  // ─── comments ────────────────────────────────────────────────────────────
  const all = useMemo(() => getThreadComments(p.id), [p.id, version, modVersion]);
  const loading = repliesLoading(p.id);
  const author = p._author || 'void.world';
  const { ids, kids } = useMemo(() => tcTree(all), [all]);
  const tops = useMemo(() => tcSort(all.filter((c) => !c.parentId || c.parentId === c.id || !ids.has(c.parentId)), sort), [all, ids, sort]);
  const topCount = useRef(0);
  topCount.current = tops.length;

  // Deal window: the first ~700ms of renders deal from the open; replies that land into an
  // empty deck later deal in on their own 60ms stagger.
  const dealtIds = useRef(new Set<string>());
  const wasEmpty = useRef(true);
  const since = Date.now() - dealT0;
  const lateDeal = !(since < 700) && wasEmpty.current && tops.length > 0;
  useEffect(() => {
    wasEmpty.current = tops.length === 0;
  }, [tops.length]);

  const [newId, setNewId] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const input = useRef<TextInput>(null);
  const [text, setText] = useState('');

  const submit = () => {
    postReply(p.id, viewerName(auth.user?.name), text, null, (id) => {
      setText('');
      setNewId(id);
      // Under TOP it lands last (bolts 0): bring it into view.
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
    });
  };

  const share = async () => {
    const url = shareUrl(p);
    try {
      await Share.share(Platform.OS === 'ios' ? { url, message: p.body ? String(p.body).slice(0, 200) : undefined } : { message: url });
    } catch {}
    VoidAPI.share(p.id).catch(() => voidToast('SIGNAL LOST · RETRY'));
  };

  // news article / Lemmy link post: the story's own text + a card out to the article
  const tLink = p.source === 'news' ? p._url || p.sourceUrl || '' : p.source === 'lemmy' && p._link && p._link !== p._url && !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(p._link) ? p._link : '';
  const srcHref = p.sourceUrl || '';
  const col = p._isoColor || AVC[0];

  const countLabel = loading && !all.length ? 'LOADING REPLIES…' : `${all.length} REPL${all.length === 1 ? 'Y' : 'IES'}`;

  const opMedia = p._video || (p.style !== 'carousel' && p._img) ? (
    <PostMedia post={p} mode="thread" style={styles.opMedia} />
  ) : p.style === 'carousel' && (p._imgs?.length || p._img) ? (
    <PostCarousel post={p} style={styles.opMedia} />
  ) : p._audio ? (
    <AudioPill post={p} index={0} style={styles.opMedia} />
  ) : null;

  return (
    <View style={styles.fill}>
      {/* .thread-scrim */}
      <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]}>
        {Platform.OS === 'ios' ? <BlurView intensity={10} tint="dark" style={StyleSheet.absoluteFill} /> : null}
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(2,1,8,0.7)' }]} onPress={() => close()} accessibilityLabel="Close thread" />
      </Animated.View>

      {/* SWIPE RIGHT TO LEAVE.
          The route is declared gestureEnabled:false - it is a transparentModal
          with animation:'none', so the navigator's own back gesture would dismiss
          it with no animation and skip the close choreography that flips the
          thread back onto its card. This gesture runs that choreography instead.
          activeOffsetX keeps it off the vertical scroll, and failOffsetY means a
          finger that starts reading never starts leaving. */}
      <GestureDetector gesture={swipeOut}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none">
        <ScrollView
          ref={scroll}
          style={styles.fill}
          contentContainerStyle={[styles.body, { paddingTop: 26 + insets.top }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable onPress={() => close()} style={StyleSheet.absoluteFill} accessible={false} />
          <Animated.View style={popStyle}>
            {/* #thread-original.thread-op */}
            <Animated.View ref={opRef as any} collapsable={false} onLayout={onOpLayout} style={[styles.op, opStyle]}>
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 22, backgroundColor: tk.opbg }]} />
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  { borderRadius: 22, backgroundColor: 'transparent', boxShadow: `0px 18px 50px ${tk.opShadow}, 0px 0px 0px 1px ${tk.opRing}, inset 0px 1px 0px ${isLight ? tk.hi : 'rgba(255,255,255,0.07)'}` },
                  restShadowStyle,
                ]}
              />
              <Animated.View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, { borderRadius: 22, backgroundColor: 'transparent', boxShadow: '0px 18px 50px rgba(0,0,0,0.65), 0px 0px 0px 1px rgba(201,168,76,0.3), inset 0px 1px 0px rgba(255,255,255,0.07)' }, ringStyle]}
              />
              <View style={styles.opInner}>
                <View style={styles.head}>
                  <Pressable onPress={() => openAuthorSheet(p)} style={[styles.av, isLight ? styles.avLight : { backgroundColor: col }]}>
                    <VText style={{ fontFamily: FONTS.sansExtraBold, fontSize: 11, color: isLight ? '#4a4234' : '#fff' }}>{avatarLetter(p)}</VText>
                  </Pressable>
                  <Pressable onPress={() => openAuthorSheet(p)} style={styles.meta}>
                    <VText numberOfLines={1} style={[styles.name, { color: colors.white }]}>
                      {p._author || p.country || 'void'}
                    </VText>
                    <VText numberOfLines={1} style={[styles.time, { color: colors.navDim }]}>
                      {(p._handle || '@void') + ' · ' + ago(p.time)}
                    </VText>
                  </Pressable>
                  <Pressable onPress={() => toggleTranslate('thread:' + p.id, p.body || '')} style={[styles.tr, tr.text != null && { opacity: 0.7 }]} hitSlop={6}>
                    <Icon name="globe" size={12} color={colors.gold} />
                    <VText style={[styles.trT, { color: colors.gold }]}>TR</VText>
                  </Pressable>
                  {!p._user ? (
                    <Pressable onPress={() => openPostMenu(p)} style={styles.more} accessibilityLabel="More" hitSlop={4}>
                      <VmodIcon name="more" size={17} color={colors.navDim} />
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => close()} style={styles.x} accessibilityLabel="Close" hitSlop={6}>
                    <Icon name="x" size={15} color={colors.navDim} />
                  </Pressable>
                </View>

                <VText style={[styles.bodyText, { color: colors.white }]}>
                  {tr.text != null ? tr.text : p.body}
                  {tr.text != null ? <VText style={[styles.trBadge, { color: colors.purple }]}>{'  ↺ ' + tr.lang.toUpperCase() + ' '}</VText> : null}
                </VText>

                {opMedia}

                {p._desc ? (
                  <VText numberOfLines={8} style={[styles.desc, { color: tk.text }]}>
                    {p._desc}
                  </VText>
                ) : null}
                {/^https?:\/\//i.test(tLink) ? (
                  <Pressable
                    onPress={() => Linking.openURL(tLink).catch(() => {})}
                    style={[styles.article, { backgroundColor: tk.card, boxShadow: `inset 0px 1px 0px ${tk.hi}, 0px 0px 0px 1px ${colors.hairline}` }]}
                  >
                    <VText numberOfLines={1} style={[styles.artHost, { color: colors.gold }]}>
                      {(fediHost(tLink) || '').replace(/^www\./, '').toUpperCase()}
                    </VText>
                    <VText numberOfLines={1} style={[styles.artCta, { color: colors.navDim }]}>
                      READ THE FULL STORY
                    </VText>
                    <VText style={[styles.artArr, { color: colors.gold }]}>↗</VText>
                  </Pressable>
                ) : null}

                {/* .thread-acts */}
                <View style={styles.acts}>
                  <Pressable onPress={() => fireBolt(p.id)} style={styles.act} hitSlop={8}>
                    <Icon name={r.mf ? 'heartFill' : 'heart'} size={13} color={r.mf ? colors.gold : colors.navDim} />
                    <VText style={[styles.actT, { color: r.mf ? colors.gold : colors.navDim }]}>{fmt(boltCount(p.score, r))}</VText>
                  </Pressable>
                  <View style={styles.act}>
                    <Icon name="reply" size={13} color={colors.navDim} />
                    <VText style={[styles.actT, { color: colors.navDim }]}>{fmt(p.replies || 0)}</VText>
                  </View>
                  <Pressable onPress={() => toggleRepost(p.id)} style={styles.act} hitSlop={8}>
                    <Icon name="repost" size={13} color={r.mrp ? colors.gold : colors.navDim} />
                    <VText style={[styles.actT, { color: r.mrp ? colors.gold : colors.navDim }]}>{fmt(p.reposts || 0)}</VText>
                  </Pressable>
                  <Pressable onPress={share} style={[styles.act, { marginLeft: 'auto' }]} hitSlop={8} accessibilityLabel="Share">
                    <Icon name="share" size={13} color={colors.navDim} />
                  </Pressable>
                </View>

                {/* .thread-source-bar */}
                <View style={styles.sourceBar}>
                  <Pressable disabled={!srcHref} onPress={() => srcHref && Linking.openURL(srcHref).catch(() => {})} style={styles.sourceLink}>
                    <VText style={[styles.sourceT, { color: colors.dim }]}>{sourceLabel(p)}</VText>
                  </Pressable>
                </View>
              </View>
            </Animated.View>

            {/* .thread-divider */}
            <Animated.View style={[styles.divider, chromeStyle]}>
              <VText style={[styles.divT, { color: colors.gold }]}>{countLabel}</VText>
              <LinearGradient colors={['rgba(201,168,76,0.4)', 'rgba(201,168,76,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.hair} />
              <View style={styles.sorts}>
                {(['top', 'new'] as const).map((s) => (
                  <Pressable key={s} onPress={() => setThreadSort(s)} hitSlop={8}>
                    <VText style={[styles.sortT, { color: sort === s ? colors.white : colors.navDim }]}>{s.toUpperCase()}</VText>
                  </Pressable>
                ))}
              </View>
            </Animated.View>

            {/* #thread-comments */}
            <View>
              {tops.length ? (
                tops.map((c, i) => {
                  const first = !dealtIds.current.has(c.id);
                  if (first) dealtIds.current.add(c.id);
                  const inWindow = since < 700;
                  const deal = first && (inWindow || lateDeal || c.id === newId);
                  const delay = c.id === newId ? 0 : lateDeal ? Math.min(i, 8) * 60 : Math.round(120 + Math.min(i, 8) * 60 - since);
                  const k = Math.min(tops.length, 6);
                  return (
                    <CommentCard
                      key={c.id}
                      c={c}
                      opAuthor={author}
                      kidsN={(kids[c.id] || []).length}
                      deal={deal}
                      delay={delay}
                      closing={closing}
                      closeDelay={i < k ? (k - 1 - i) * 30 : 0}
                      onOpen={(x) => openReplies(x.id)}
                      onReply={(x) => openReplies(x.id, true)}
                      onBolt={(x) => toggleCommentBolt(p.id, x.id)}
                      onMore={(x: Comment) => openCommentMenu(x, p)}
                    />
                  );
                })
              ) : (
                <Animated.View style={chromeStyle}>
                  <VText style={[styles.empty, { color: colors.navDim }]}>{loading ? 'PULLING REPLIES…' : 'BE FIRST TO ENTER THE THREAD'}</VText>
                </Animated.View>
              )}
            </View>
          </Animated.View>
        </ScrollView>

        {/* .thread-compose */}
        <Animated.View style={[chromeStyle]}>
          <Animated.View style={popStyle}>
            <ComposePill
              ref={input}
              value={text}
              onChangeText={setText}
              onSubmit={submit}
              placeholder="add to the thread…"
              avatar={viewerName(auth.user?.name)[0]?.toUpperCase() || '◎'}
              style={{ marginTop: 8, marginHorizontal: 18, marginBottom: 16 + insets.bottom }}
            />
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
      </GestureDetector>

      <ReplyOverlay postId={p.id} stack={roStack} onOpen={openReplies} onBack={closeReplies} onCloseAll={closeAllReplies} focusKey={roFocus} instant={roInstant} />
      <ModerationHost />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { paddingHorizontal: 18, paddingBottom: 24, flexGrow: 1 },
  op: { position: 'relative', borderRadius: 22 },
  opInner: { paddingTop: 18, paddingHorizontal: 18, paddingBottom: 15 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 11 },
  av: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avLight: { backgroundColor: '#ded7c5', boxShadow: 'inset 0px 0px 0px 1px rgba(26,20,36,0.12), 0px 2px 6px rgba(26,20,36,0.12)' },
  meta: { flex: 1, minWidth: 0 },
  name: { fontFamily: FONTS.sansBold, fontSize: 12 },
  time: { fontFamily: FONTS.mono, fontSize: 8 },
  tr: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 4 },
  trT: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.1) },
  more: { width: 28, height: 26, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  x: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  bodyText: { fontFamily: FONTS.serifItalic, fontSize: 19, lineHeight: 19 * 1.42 },
  trBadge: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.08), backgroundColor: 'rgba(124,58,237,0.1)' },
  opMedia: { marginTop: 12, marginBottom: 0 },
  desc: { fontFamily: FONTS.sans, fontSize: 12.5, lineHeight: 12.5 * 1.55, marginTop: 10 },
  article: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 13 },
  artHost: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.14), maxWidth: '45%' },
  artCta: { flex: 1, minWidth: 0, fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.18) },
  artArr: { fontSize: 13, lineHeight: 13 },
  acts: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 12 },
  act: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actT: { fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: em(8.5, 0.05) },
  sourceBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  sourceLink: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.04)' },
  sourceT: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.08) },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 18, paddingHorizontal: 2, paddingBottom: 14 },
  divT: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.25) },
  hair: { flex: 1, height: 1 },
  sorts: { flexDirection: 'row', gap: 12, flexShrink: 0 },
  sortT: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.2) },
  empty: { textAlign: 'center', padding: 30, fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.12) },
});
