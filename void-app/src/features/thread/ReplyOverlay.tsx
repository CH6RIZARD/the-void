// #reply-overlay (patch3 §4.B, ref 8f) — the reply screen that slides up over the thread.
//
//   .ro-scrim{rgba(2,1,8,.55);opacity .28s ease}
//   .ro-sheet{top:88px;border-radius:26px 26px 0 0;background:var(--tc-sheet);
//             box-shadow:0 -14px 50px rgba(0,0,0,.65),inset 0 1px 0 var(--tc-hi);
//             transform:translateY(100%) -> 0 .28s cubic-bezier(.32,.72,.28,1)}
//   .ro-handle 32x3 var(--tc-handle)   .ro-head{padding:14px 20px 6px;gap:10px}
//   .ro-back 24x24 ml -5, chevron 15 nav-dim   .ro-label Syne Mono 8 .28em   .ro-count gold 8 .14em
//   .ro-body{padding:8px 18px 16px}  .swap: translateX(16px)->0  .back: translateX(-16px)->0  .22s ease-out
//   .ro-list{margin-left:22px;padding-top:10px}
//   compose pill margin 10px 14px 16px, placeholder "reply to <name>…"
//
// Controlled by the thread: `stack` is the drill-down path of comment ids (_roStack).
// Back pops one level; the scrim closes the whole stack.
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { findPost, type Comment } from '../../core';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../theme/ThemeProvider';
import { FONTS, em } from '../../theme/palettes';
import { Icon } from '../../ui/icons';
import { VText } from '../../ui/Text';
import { openCommentMenu } from '../feed/ModerationSheet';
import { CommentCard } from './CommentCard';
import { ComposePill } from './ComposePill';
import { getThreadComments, postReply, tcSort, tcTree, toggleCommentBolt, useThreadSort, useThreadVersion, viewerName } from './threadModel';
import { useThreadTokens } from './threadTheme';

const SHEET_EASE = Easing.bezier(0.32, 0.72, 0.28, 1);
const EASE_OUT = Easing.bezier(0, 0, 0.58, 1);

export interface ReplyOverlayProps {
  postId: string;
  stack: string[];
  /** open a nested level (tap a reply card) */
  onOpen: (commentId: string, focus?: boolean) => void;
  /** back chevron: pop one level */
  onBack: () => void;
  /** scrim / missing parent: close everything */
  onCloseAll: () => void;
  /** bump to focus the compose pill (REPLY on a deck card, or on the parent card) */
  focusKey?: number;
  /** skip the slide (the thread itself is closing) */
  instant?: boolean;
}

export function ReplyOverlay({ postId, stack, onOpen, onBack, onCloseAll, focusKey, instant }: ReplyOverlayProps) {
  const { colors } = useTheme();
  const tk = useThreadTokens();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  useThreadVersion(postId);
  const sort = useThreadSort();

  const open = stack.length > 0;
  const [mounted, setMounted] = useState(open);
  const shown = useSharedValue(0);
  const swap = useSharedValue(0); // -1 back, +1 swap, eased to 0
  const prevLen = useRef(stack.length);
  const input = useRef<TextInput>(null);
  const [text, setText] = useState('');
  const [newId, setNewId] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      shown.value = withTiming(1, { duration: 280, easing: SHEET_EASE, reduceMotion: ReduceMotion.System });
    } else if (mounted) {
      if (instant) {
        shown.value = 0;
        setMounted(false);
      } else
        shown.value = withTiming(0, { duration: 280, easing: SHEET_EASE, reduceMotion: ReduceMotion.System }, (done) => {
          if (done) runOnJS(setMounted)(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // swap / back animation between levels
  useEffect(() => {
    const was = prevLen.current;
    prevLen.current = stack.length;
    if (!was || !stack.length || was === stack.length) return;
    setText('');
    setNewId(null);
    swap.value = stack.length > was ? 1 : -1;
    swap.value = withTiming(0, { duration: 220, easing: EASE_OUT, reduceMotion: ReduceMotion.System });
    scroll.current?.scrollTo({ y: 0, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack.length, stack[stack.length - 1]]);

  useEffect(() => {
    if (!focusKey || !open) return;
    const t = setTimeout(() => input.current?.focus(), prevLen.current > 1 ? 0 : 290);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  const sheetTop = 88;
  const scrimStyle = useAnimatedStyle(() => ({ opacity: shown.value }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - shown.value) * (height - sheetTop) }] }));
  const bodyStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.abs(swap.value), transform: [{ translateX: swap.value * 16 }] }));

  const cid = stack[stack.length - 1];
  const all = getThreadComments(postId);
  const parent = cid ? all.find((c) => c.id === cid) : undefined;

  // Parent gone (reported / blocked / not found): pop, and close when nothing is left.
  useEffect(() => {
    if (open && cid && !parent) {
      if (stack.length > 1) onBack();
      else onCloseAll();
    }
  }, [open, cid, parent, stack.length, onBack, onCloseAll]);

  if (!mounted) return null;

  const post = findPost(postId);
  const author = (post && post._author) || 'void.world';
  const { kids } = tcTree(all);
  const list = parent ? tcSort((kids[parent.id] || []).slice(), sort) : [];

  const bolt = (c: Comment) => toggleCommentBolt(postId, c.id);
  const more = (c: Comment) => openCommentMenu(c, post);
  const submit = () => {
    if (!parent) return;
    const body = text;
    postReply(postId, viewerName(auth.user?.name), body, parent.id, (id) => {
      setText('');
      setNewId(id);
    });
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(2,1,8,0.55)' }, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCloseAll} accessibilityLabel="Close replies" />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          { top: sheetTop, backgroundColor: tk.sheet, boxShadow: `0px -14px 50px rgba(0,0,0,0.65), inset 0px 1px 0px ${tk.hi}` },
          sheetStyle,
        ]}
      >
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={sheetTop}>
          <View style={[styles.handle, { backgroundColor: tk.handle }]} />
          <View style={styles.head}>
            <Pressable onPress={onBack} style={styles.back} accessibilityLabel="Back" hitSlop={10}>
              <Icon name="back" size={15} color={colors.navDim} />
            </Pressable>
            <VText style={[styles.label, { color: colors.navDim }]}>REPLIES</VText>
            <VText style={[styles.count, { color: colors.gold }]}>{String(list.length)}</VText>
          </View>
          <ScrollView ref={scroll} style={styles.fill} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" overScrollMode="never" bounces={false}>
            <Animated.View style={bodyStyle}>
              {parent ? (
                <CommentCard c={parent} opAuthor={author} kidsN={0} parent onBolt={bolt} onMore={more} onReply={() => input.current?.focus()} />
              ) : null}
              <View style={styles.list}>
                {list.length ? (
                  list.map((c) => (
                    <CommentCard
                      key={c.id}
                      c={c}
                      nested
                      opAuthor={author}
                      kidsN={(kids[c.id] || []).length}
                      deal={c.id === newId}
                      onOpen={(x) => onOpen(x.id)}
                      onReply={(x) => onOpen(x.id, true)}
                      onBolt={bolt}
                      onMore={more}
                    />
                  ))
                ) : (
                  <VText style={[styles.empty, { color: colors.navDim }]}>NO REPLIES YET</VText>
                )}
              </View>
            </Animated.View>
          </ScrollView>
          <ComposePill
            ref={input}
            value={text}
            onChangeText={setText}
            onSubmit={submit}
            placeholder={`reply to ${String((parent && parent.author) || 'anon')}…`}
            style={{ marginTop: 10, marginHorizontal: 14, marginBottom: 16 + insets.bottom }}
          />
        </KeyboardAvoidingView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  handle: { width: 32, height: 3, borderRadius: 2, marginTop: 12, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 14, paddingHorizontal: 20, paddingBottom: 6 },
  back: { width: 24, height: 24, marginLeft: -5, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.28) },
  count: { marginLeft: 'auto', fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.14) },
  body: { paddingTop: 8, paddingHorizontal: 18, paddingBottom: 16 },
  list: { marginLeft: 22, paddingTop: 10 },
  empty: { textAlign: 'center', padding: 30, fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.12) },
});

export default ReplyOverlay;
