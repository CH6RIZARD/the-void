// /thread/[id] — the thread overlay (patch3 §4.A + §4.C; void2-final.html openThread /
// closeThread / renderThreadComments / submitComment / translateThreadBody).
//
// Presented OVER the launching screen (route must be a transparent modal): a
// rgba(2,1,8,.7) + blur(3px) scrim, the OP CTA card, the replies divider with TOP/NEW,
// the comment deck and the compose pill.
//
// The deck is PEEK-FAN (handoff THE-VOID-22b §5): a reply with children shows a peek
// of its first child and `+N MORE`; tap it and it becomes the parent row with its
// children fanned out beneath (`N REPLIES`); tap a child with children to go a level
// deeper (`UNDER AUTHOR · N REPLIES`, with back); tap the parent again to fold (200ms).
// Reply on any card pins it (`REPLYING TO AUTHOR`, clearable); sending posts under it
// and unfolds it. No reply sheet any more. Opening from a PostCard FLIP-lifts the card
// into the OP slot (measured rects, Reanimated), gold ring fading in; the deck deals up
// with a 60ms stagger from T+120. Closing reverses it and hands the card back.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Dimensions, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { EASE_OUT as UI_EASE_OUT, FLICK_VELOCITY, WEB } from '../../theme/motion';
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
import { ago, fmt, sourceLabel } from '../feed/format';
import { PersonPfp } from '../../ui/Pfp';
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
import { getThreadComments, postReply, setThreadSort, tcSort, tcTree, toggleCommentBolt, useThreadSort, useThreadVersion, viewerName } from './threadModel';
import { useThreadTokens } from './threadTheme';

const FLIP_EASE = WEB.SHEET;
const EASE_OUT = WEB.EASE_OUT;
// REDUCED MOTION DROPS THE MOVEMENT, NOT THE FADES. The flip (translate + scale)
// follows the system setting; the scrim, chrome and pop opacity always run - with
// everything on System, opening a thread under reduced motion was a hard cut.
const RM = ReduceMotion.System;
const FADE = ReduceMotion.Never;

interface FlipVec {
  dx: number;
  dy: number;
  s: number;
}

export default function ThreadScreen() {
  const params = useLocalSearchParams<{ id: string; focus?: string }>();
  let postId = String(params.id ?? '');
  try {
    postId = decodeURIComponent(postId);
  } catch {}
  const post = findPost(postId);
  if (!post) return <MissingThread />;
  return <Thread key={postId} post={post} focus={params.focus ? String(params.focus) : undefined} />;
}

function MissingThread() {
  useEffect(() => {
    const t = setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/void' as any)), 0);
    return () => clearTimeout(t);
  }, []);
  return null;
}

function Thread({ post: p, focus }: { post: Post; focus?: string }) {
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
    scrim.value = withTiming(1, { duration: 240, easing: EASE_OUT, reduceMotion: FADE });
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
      pop.value = withTiming(1, { duration: 240, easing: EASE_OUT, reduceMotion: FADE });
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
        chrome.value = withTiming(1, { duration: 240, easing: EASE_OUT, reduceMotion: FADE });
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

  // ─── peek-fan state ──────────────────────────────────────────────────────
  const [unfolded, setUnfolded] = useState<Record<string, true>>({});
  const [folding, setFolding] = useState<Record<string, true>>({});
  const [fanPath, setFanPath] = useState<Record<string, string[]>>({});
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const input = useRef<TextInput>(null);
  const openFold = useCallback((id: string) => {
    setUnfolded((u) => (u[id] ? u : { ...u, [id]: true }));
    setFolding((f) => {
      if (!f[id]) return f;
      const n = { ...f };
      delete n[id];
      return n;
    });
  }, []);
  const toggleFold = useCallback(
    (id: string) => {
      if (unfolded[id] && !folding[id]) {
        setFolding((f) => ({ ...f, [id]: true }));
        timers.current.push(
          setTimeout(() => {
            setUnfolded((u) => {
              const n = { ...u };
              delete n[id];
              return n;
            });
            setFolding((f) => {
              const n = { ...f };
              delete n[id];
              return n;
            });
          }, 200),
        );
        return;
      }
      openFold(id);
      setFanPath((fp) => ({ ...fp, [id]: [] }));
    },
    [unfolded, folding, openFold],
  );
  const pin = useCallback((c: Comment) => {
    setReplyTo({ id: c.id, name: c.author || 'anon' });
    setTimeout(() => input.current?.focus(), 0);
  }, []);
  /** unfold the chain from a top-level card down to `id` */
  const revealChain = useCallback(
    (id: string, list: Comment[]) => {
      const byId = new Map(list.map((c) => [c.id, c]));
      if (!byId.has(id)) return;
      const chain: string[] = [id];
      let cur = byId.get(id);
      while (cur && cur.parentId && cur.parentId !== cur.id && byId.has(cur.parentId)) {
        chain.unshift(cur.parentId);
        cur = byId.get(cur.parentId);
      }
      // chain[0] is top-level; the fan path is the ids between it and the target's parent
      const top = chain[0];
      const path = chain.slice(1, -1);
      if (chain.length === 1) return; // a top-level reply itself: nothing to unfold
      openFold(top);
      setFanPath((f) => ({ ...f, [top]: path }));
    },
    [openFold],
  );

  const close = useCallback(
    (instant?: boolean) => {
      if (closingRef.current) return;
      closingRef.current = true;
      if (instant) return finish();
      setClosing(true);
      const tops = topCount.current;
      const k = Math.min(tops, 6);
      let dur = 200 + Math.max(0, k - 1) * 30;
      chrome.value = withTiming(0, { duration: 180, easing: UI_EASE_OUT, reduceMotion: FADE });
      scrim.value = withTiming(0, { duration: 240, easing: EASE_OUT, reduceMotion: FADE });
      const flip = currentFlip(p.id);
      const node = opRef.current;
      const fallback = () => {
        opFade.value = withTiming(0, { duration: 200, easing: UI_EASE_OUT, reduceMotion: FADE });
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

  // Opened from a profile reply (?focus=<replyId>): once it has loaded, unfold the
  // chain down to it. Once only, so folding it sticks.
  const focused = useRef(false);
  useEffect(() => {
    if (!focus || focused.current) return;
    const list = getThreadComments(p.id);
    if (!list.some((c) => c.id === focus)) return;
    focused.current = true;
    revealChain(focus, list);
  }, [focus, version, p.id, revealChain]);

  // Android back: clear a pinned reply first, then close the thread.
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (replyToRef.current) {
        setReplyTo(null);
        return true;
      }
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  // ─── animated styles ─────────────────────────────────────────────────────
  const rise = useReducedMotion() ? 0 : 12; // the pop / fallback's 12px rise
  const swipeOut = Gesture.Pan()
    .activeOffsetX([-9999, 24])
    .failOffsetY([-14, 14])
    .onEnd((e) => {
      'worklet';
      // A deliberate push to the right, not a stray drift while scrolling.
      if ((e.translationX > 80 && e.velocityX > 0) || e.velocityX > FLICK_VELOCITY) runOnJS(close)();
    });
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const popStyle = useAnimatedStyle(() => ({ opacity: pop.value, transform: [{ translateY: (1 - pop.value) * rise }] }));
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
      transform: [{ translateX: tx }, { translateY: ty + (1 - opFade.value) * rise }, { scale: sc }],
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
  const [text, setText] = useState('');

  const submit = () => {
    const target = replyTo?.id || null;
    postReply(p.id, viewerName(auth.user?.name), text, target, (id) => {
      setText('');
      setNewId(id);
      setReplyTo(null);
      if (target) revealChain(id, getThreadComments(p.id));
      // Under TOP it lands last (bolts 0): bring it into view.
      else setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
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
                  <Pressable onPress={() => openAuthorSheet(p)} style={[styles.av, isLight ? styles.avLight : null, { overflow: 'hidden' }]}>
                    <PersonPfp uid={p.author_id || p._authorId} handle={p._handle} label={p._author} size={32} />
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
                    <VText style={[styles.actT, { color: r.mrp ? colors.gold : colors.navDim }]}>{fmt(p.reposts || p._reposts || 0)}</VText>
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

            {/* #thread-comments — peek-fan */}
            <View>
              {tops.length ? (
                tops.map((c, i) => {
                  const first = !dealtIds.current.has(c.id);
                  if (first) dealtIds.current.add(c.id);
                  const inWindow = since < 700;
                  const deal = first && (inWindow || lateDeal || c.id === newId);
                  const delay = c.id === newId ? 0 : lateDeal ? Math.min(i, 8) * 60 : Math.round(120 + Math.min(i, 8) * 60 - since);
                  const k = Math.min(tops.length, 6);
                  const kidsList = tcSort((kids[c.id] || []).slice(), sort);
                  const kn = kidsList.length;
                  const open = !!unfolded[c.id];
                  const isOpen = open && !folding[c.id];
                  // the fan: walk fanPath down from c
                  let cur: Comment = c;
                  let fan = kidsList;
                  const path = fanPath[c.id] || [];
                  for (const id of path) {
                    const n = all.find((x) => x.id === id);
                    if (!n) break;
                    cur = n;
                    fan = tcSort((kids[n.id] || []).slice(), sort);
                  }
                  const lbl = (n: number) => n + (n === 1 ? ' REPLY' : ' REPLIES');
                  return (
                    <View key={c.id}>
                      <CommentCard
                        c={c}
                        opAuthor={author}
                        kidsN={kn}
                        noEdges
                        parent={isOpen}
                        deal={deal}
                        delay={delay}
                        closing={closing}
                        closeDelay={i < k ? (k - 1 - i) * 30 : 0}
                        peekOf={kn && !open ? kidsList[0] : null}
                        peekMore={kn - 1}
                        kidsLabel={kn ? (isOpen ? '▴ ' : '▾ ') + lbl(kn) : undefined}
                        kidsOn={isOpen}
                        onOpen={kn ? (x) => toggleFold(x.id) : undefined}
                        onReply={pin}
                        onBolt={(x) => toggleCommentBolt(p.id, x.id)}
                        onMore={(x: Comment) => openCommentMenu(x, p)}
                      />
                      {open ? (
                        <View style={styles.fan}>
                          <View style={styles.fanHead}>
                            {path.length ? (
                              <Pressable onPress={() => setFanPath((f) => ({ ...f, [c.id]: (f[c.id] || []).slice(0, -1) }))} hitSlop={8} style={styles.fanBack} accessibilityLabel="Back">
                                <Icon name="back" size={12} color={colors.navDim} />
                              </Pressable>
                            ) : null}
                            <VText style={[styles.fanLbl, { color: colors.gold }]}>{(path.length ? 'UNDER ' + (cur.author || 'anon').toUpperCase() + ' · ' : '') + lbl(fan.length)}</VText>
                          </View>
                          {fan.map((kid, j) => {
                            const kk = (kids[kid.id] || []).length;
                            return (
                              <CommentCard
                                key={kid.id}
                                c={kid}
                                nested
                                noEdges
                                opAuthor={author}
                                kidsN={kk}
                                deal
                                delay={kid.id === newId ? 0 : j * 60}
                                closing={closing || !!folding[c.id]}
                                kidsLabel={kk ? '▾ ' + lbl(kk) : undefined}
                                onOpen={kk ? (x) => setFanPath((f) => ({ ...f, [c.id]: (f[c.id] || []).concat(x.id) })) : undefined}
                                onReply={pin}
                                onBolt={(x) => toggleCommentBolt(p.id, x.id)}
                                onMore={(x: Comment) => openCommentMenu(x, p)}
                              />
                            );
                          })}
                          {!fan.length ? <VText style={[styles.empty, { color: colors.navDim }]}>NO REPLIES YET</VText> : null}
                        </View>
                      ) : null}
                    </View>
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
            {replyTo ? (
              <View style={styles.pin}>
                <VText style={[styles.pinT, { color: colors.gold }]}>{'REPLYING TO ' + replyTo.name.toUpperCase()}</VText>
                <Pressable onPress={() => setReplyTo(null)} hitSlop={8} accessibilityLabel="Clear">
                  <Icon name="x" size={11} color={colors.navDim} />
                </Pressable>
              </View>
            ) : null}
            <ComposePill
              ref={input}
              value={text}
              onChangeText={setText}
              onSubmit={submit}
              placeholder={replyTo ? 'reply to ' + replyTo.name + '…' : 'add to the thread…'}
              avatar={viewerName(auth.user?.name)[0]?.toUpperCase() || '◎'}
              style={{ marginTop: 8, marginHorizontal: 18, marginBottom: 16 + insets.bottom }}
            />
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
      </GestureDetector>

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
  fan: { marginLeft: 22, marginBottom: 10 },
  fanHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 10 },
  fanBack: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginLeft: -4 },
  fanLbl: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.25) },
  pin: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 30, marginTop: 8 },
  pinT: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.2) },
});
