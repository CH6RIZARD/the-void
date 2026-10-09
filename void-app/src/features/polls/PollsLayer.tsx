// Polls (handoff THE-VOID-22b §4): slides in from the right over the feed (.32s).
//   Board   THE⬡VOID live card (LET'S TALK, the question, voices + replies, tap ->
//           topic), Top / New sort, Mine (your published questions, tPopIn), the floor
//           (two staggered columns, 196 / 160px tiles, odd tiles 22px down; rank
//           number, question, @by + PersonPfp + age, up / down, agreement bar), the
//           Archive (No. n … 01), and the Suggest pill.
//   Topic   slides in over the board: LET'S TALK or THE VOID ARCHIVE · NO. n, the
//           question, age, voices, replies, chip. Replies ("chime") Top / New, like
//           toggles, reply pre-fills @handle, Enter or send posts as you.
// Votes are {+1, 0, −1}; the same side again clears it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../theme/ThemeProvider';
import { FONTS, em } from '../../theme/palettes';
import { WEB } from '../../theme/motion';
import { DealIn } from '../../ui/DealIn';
import { Icon } from '../../ui/icons';
import { PersonPfp } from '../../ui/Pfp';
import { VText } from '../../ui/Text';
import { ComposePill } from '../thread/ComposePill';
import { viewerName } from '../thread/threadModel';
import { ago, fmt } from '../feed/format';
import { voidToast } from '../../ui/Toast';
import { chime, chimesOf, liked, likesOf, liveTopic, loadChimes, pullPolls, setPollsFailHandler, rankFloor, replyCount, tally, toggleLike, topics, usePolls, vote, voteOf, type FloorQ, type Topic } from './pollsStore';
import { SuggestSheet } from './SuggestSheet';

const GOLD = '#c9a84c';
const MUTED = '#8d7cc0';
const SLIDE = { duration: 320, easing: WEB.SHEET, reduceMotion: ReduceMotion.System };
setPollsFailHandler(() => voidToast('SIGNAL LOST · RETRY'));

export interface PollsLayerProps {
  open: boolean;
  width: number;
  /** topic page or suggest sheet open -> the masthead hides */
  onCover: (covered: boolean) => void;
  /** Android back: the layer handles its own topic / sheet first; returns true if it did */
  backRef: React.MutableRefObject<() => boolean>;
}

export function PollsLayer({ open, width, onCover, backRef }: PollsLayerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const st = usePolls();
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const [seq, setSeq] = useState(0); // re-deal
  const [topic, setTopic] = useState<Topic | null>(null);
  const [topicOpen, setTopicOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [draft, setDraft] = useState('');

  const x = useSharedValue(open ? 0 : 1);
  const back = useSharedValue(0); // topic open -> board recedes
  useEffect(() => {
    x.value = withTiming(open ? 0 : 1, SLIDE);
    if (open) {
      setSeq((n) => n + 1);
      pullPolls();
    }
  }, [open, x]);
  useEffect(() => {
    back.value = withTiming(topicOpen ? 1 : 0, SLIDE);
    onCover(topicOpen || sheet);
  }, [topicOpen, sheet, back, onCover]);
  backRef.current = () => {
    if (sheet) {
      setSheet(false);
      return true;
    }
    if (topicOpen) {
      setTopicOpen(false);
      return true;
    }
    return false;
  };
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: (width + 90) * x.value - width * 0.28 * back.value }] }));
  const dim = useAnimatedStyle(() => ({ opacity: 0.55 * back.value }));

  const openTopic = (t: Topic) => {
    setTopic(t);
    setTopicOpen(true);
  };
  const LIVE = liveTopic();
  const floor = rankFloor(sort);
  const mine = st.floor.filter((f) => f.mine);
  const resort = (s: 'top' | 'new') => {
    setSort(s);
    setSeq((n) => n + 1);
  };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.layer, { backgroundColor: colors.bg }, slide]} pointerEvents={open ? 'auto' : 'none'}>
      <ScrollView contentContainerStyle={{ paddingTop: 44 + insets.top + 8, paddingBottom: 90 + 70 + insets.bottom, paddingHorizontal: 18 }} showsVerticalScrollIndicator={false}>
        {/* live card */}
        <Pressable onPress={() => openTopic(LIVE)} style={[styles.live, { backgroundColor: colors.card }]}>
          <VText style={[styles.kicker, { color: GOLD }]}>THE⬡VOID · LET’S TALK</VText>
          <VText style={[styles.liveQ, { color: colors.white }]}>{LIVE.q}</VText>
          <VText style={[styles.meta, { color: MUTED }]}>{fmt(replyCount(LIVE.id)) + ' replies · ' + ago(LIVE.t)}</VText>
        </Pressable>

        {/* sort */}
        <View style={styles.sortRow}>
          <VText style={[styles.kicker, { color: MUTED }]}>{'THE FLOOR · ' + st.floor.length}</VText>
          <View style={styles.seg}>
            {(['top', 'new'] as const).map((s) => (
              <Pressable key={s} onPress={() => resort(s)} style={[styles.segBtn, sort === s && styles.segOn]}>
                <VText style={[styles.segT, { color: sort === s ? GOLD : colors.dim }]}>{s.toUpperCase()}</VText>
              </Pressable>
            ))}
          </View>
        </View>

        {/* mine */}
        {mine.length ? (
          <View style={styles.mine}>
            <VText style={[styles.kicker, { color: MUTED }]}>MINE</VText>
            {mine.map((f) => {
              const t = tally(f);
              return (
                <DealIn key={f.id} pop>
                  <View style={[styles.mineRow, { backgroundColor: colors.card }]}>
                    <VText style={[styles.mineQ, { color: colors.white }]}>{f.q}</VText>
                    <VText style={[styles.meta, { color: MUTED }]}>{fmt(t.up) + ' / ' + fmt(t.down)}</VText>
                  </View>
                </DealIn>
              );
            })}
          </View>
        ) : null}

        {/* the floor */}
        {floor.length ? (
          <View key={seq} style={styles.floor}>
            {[0, 1].map((col) => (
              <View key={col} style={[styles.col, col === 1 && { marginTop: 22 }]}>
                {floor.map((f, i) => (i % 2 === col ? <Tile key={f.id} f={f} i={i} /> : null))}
              </View>
            ))}
          </View>
        ) : (
          <VText style={[styles.empty, { color: colors.navDim }]}>THE FLOOR IS EMPTY · SUGGEST THE FIRST QUESTION</VText>
        )}

        {/* archive */}
        <VText style={[styles.kicker, { color: MUTED, marginTop: 28, marginBottom: 10 }]}>THE VOID ARCHIVE</VText>
        {topics().filter((t) => !t.live).map((t) => (
          <Pressable key={t.id} onPress={() => openTopic(t)} style={[styles.arch, { borderBottomColor: 'rgba(201,168,76,0.10)' }]}>
            <VText style={[styles.archNo, { color: GOLD }]}>{String(t.no).padStart(2, '0')}</VText>
            <VText style={[styles.archQ, { color: colors.white }]}>{t.q}</VText>
          </Pressable>
        ))}
      </ScrollView>

      {/* suggest pill */}
      <Pressable onPress={() => setSheet(true)} style={[styles.suggest, { bottom: 88 + insets.bottom, backgroundColor: colors.card }]}>
        <VText numberOfLines={1} style={[styles.suggestT, { color: draft ? '#c9bfe8' : MUTED }]}>{draft || 'Suggest a question for The Void'}</VText>
        <Icon name="pen" size={14} color={GOLD} />
      </Pressable>

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, dim]} />
      <TopicPage topic={topic} open={topicOpen} width={width} onClose={() => setTopicOpen(false)} />
      <SuggestSheet visible={sheet} onClose={() => setSheet(false)} draft={draft} setDraft={setDraft} />
    </Animated.View>
  );
}

function Tile({ f, i }: { f: FloorQ; i: number }) {
  const { colors } = useTheme();
  const v = voteOf(f.id);
  const t = tally(f);
  const tall = i % 4 === 0 || i % 4 === 3;
  return (
    <DealIn delay={120 + Math.min(i, 8) * 50}>
      <View style={[styles.tile, { height: tall ? 196 : 160, backgroundColor: colors.card }]}>
        <VText style={[styles.no, { color: GOLD }]}>{String(i + 1).padStart(2, '0')}</VText>
        <VText numberOfLines={tall ? 5 : 3} style={[styles.tileQ, { color: colors.white }]}>
          {f.q}
        </VText>
        <View style={styles.by}>
          <View style={styles.av}>
            <PersonPfp handle={f.by} label={f.by} size={16} />
          </View>
          <VText numberOfLines={1} style={[styles.meta, { color: MUTED, flex: 1 }]}>{'@' + f.by + ' · ' + ago(f.t)}</VText>
        </View>
        <View style={styles.votes}>
          <Pressable onPress={() => vote(f.id, 1)} hitSlop={6} style={[styles.vBtn, v === 1 && styles.vUp]} accessibilityLabel="Up">
            <Icon name="arrowUp" size={13} color={v === 1 ? '#1a1030' : GOLD} />
            <VText style={[styles.vT, { color: v === 1 ? '#1a1030' : GOLD }]}>{fmt(t.up)}</VText>
          </Pressable>
          <Pressable onPress={() => vote(f.id, -1)} hitSlop={6} style={[styles.vBtn, v === -1 && styles.vDown]} accessibilityLabel="Down">
            <Icon name="arrowDown" size={13} color={v === -1 ? '#f4f0ff' : MUTED} />
            <VText style={[styles.vT, { color: v === -1 ? '#f4f0ff' : MUTED }]}>{fmt(t.down)}</VText>
          </Pressable>
        </View>
        <View style={[styles.bar, { opacity: v === -1 ? 0.35 : 1 }]}>
          <View style={[styles.barUp, { width: `${t.pct}%`, backgroundColor: GOLD }]} />
        </View>
      </View>
    </DealIn>
  );
}

function TopicPage({ topic, open, width, onClose }: { topic: Topic | null; open: boolean; width: number; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  usePolls();
  const [csort, setCsort] = useState<'top' | 'new'>('top');
  const [seq, setSeq] = useState(0);
  const [text, setText] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const input = useRef<TextInput>(null);
  const x = useSharedValue(open ? 0 : 1);
  useEffect(() => {
    x.value = withTiming(open ? 0 : 1, SLIDE);
    if (open) {
      setSeq((n) => n + 1);
      setText('');
      if (topic) loadChimes(topic.id);
    }
  }, [open, x, topic]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: (width + 90) * x.value }] }));
  const send = useCallback(() => {
    if (!topic) return;
    const c = chime(topic.id, text, auth.session?.user?.id || null);
    if (!c) return;
    setFresh(c.id);
    setText('');
  }, [topic, text, auth]);
  if (!topic) return null;
  const reps = chimesOf(topic.id, csort);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.topic, { backgroundColor: colors.bg }, slide]} pointerEvents={open ? 'auto' : 'none'}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.topicHead, { paddingTop: insets.top + 6 }]}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.backBtn} accessibilityLabel="Back">
            <Icon name="back" size={18} color={colors.white} />
          </Pressable>
          <VText style={[styles.kicker, { color: GOLD }]}>{topic.live ? 'LET’S TALK' : 'THE VOID ARCHIVE · NO. ' + topic.no}</VText>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 24 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <VText style={[styles.topicQ, { color: colors.white }]}>{topic.q}</VText>
          <VText style={[styles.meta, { color: MUTED, marginTop: 8 }]}>{ago(topic.t) + ' · ' + fmt(reps.length) + ' replies'}</VText>
          <View style={[styles.chip, { backgroundColor: 'rgba(255,255,255,0.04)' }]}>
            <VText style={[styles.chipT, { color: topic.by ? GOLD : MUTED }]}>{topic.by ? 'FROM @' + topic.by.toUpperCase() : 'SET BY THE VOID'}</VText>
          </View>
          <View style={styles.sortRow}>
            <VText style={[styles.kicker, { color: MUTED }]}>CHIME IN</VText>
            <View style={styles.seg}>
              {(['top', 'new'] as const).map((s) => (
                <Pressable
                  key={s}
                  onPress={() => {
                    setCsort(s);
                    setSeq((n) => n + 1);
                  }}
                  style={[styles.segBtn, csort === s && styles.segOn]}
                >
                  <VText style={[styles.segT, { color: csort === s ? GOLD : colors.dim }]}>{s.toUpperCase()}</VText>
                </Pressable>
              ))}
            </View>
          </View>
          <View key={seq}>
            {reps.length ? (
              reps.map((c, i) => {
                const on = liked(c.id);
                return (
                  <DealIn key={c.id} delay={c.id === fresh ? 0 : 120 + Math.min(i, 8) * 60}>
                    <View style={[styles.rep, { backgroundColor: colors.card }]}>
                      <View style={styles.repHead}>
                        <View style={styles.av26}>
                          <PersonPfp uid={c.authorId} handle={c.handle} label={c.author} size={26} />
                        </View>
                        <VText numberOfLines={1} style={[styles.repName, { color: colors.white }]}>
                          {c.author}
                          <VText style={[styles.meta, { color: MUTED }]}>{' · ' + ago(c.t)}</VText>
                        </VText>
                      </View>
                      <VText style={[styles.repText, { color: '#c9bfe8' }]}>{c.text}</VText>
                      <View style={styles.repActs}>
                        <Pressable onPress={() => toggleLike(c.id)} hitSlop={8} style={styles.act}>
                          <Icon name={on ? 'heartFill' : 'heart'} size={11} color={on ? GOLD : colors.navDim} />
                          <VText style={[styles.actT, { color: on ? GOLD : colors.navDim }]}>{fmt(likesOf(c))}</VText>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            setText('@' + c.handle + ' ');
                            input.current?.focus();
                          }}
                          hitSlop={8}
                          style={styles.act}
                        >
                          <VText style={[styles.actT, { color: colors.navDim }]}>REPLY</VText>
                        </Pressable>
                      </View>
                    </View>
                  </DealIn>
                );
              })
            ) : (
              <VText style={[styles.empty, { color: colors.navDim }]}>NO ONE HAS CHIMED IN YET · GO FIRST</VText>
            )}
          </View>
        </ScrollView>
        <ComposePill ref={input} value={text} onChangeText={setText} onSubmit={send} placeholder="chime in…" avatar={viewerName(auth.user?.name)[0]?.toUpperCase() || '◎'} style={{ marginHorizontal: 18, marginBottom: 16 + insets.bottom }} />
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  layer: { zIndex: 57 },
  topic: { zIndex: 59 },
  kicker: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.25) },
  meta: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.08) },
  live: { borderRadius: 20, padding: 18, gap: 10, boxShadow: '0px 0px 0px 1px rgba(201,168,76,0.28), inset 0px 1px 0px rgba(255,230,160,0.12)' },
  liveQ: { fontFamily: FONTS.serif, fontSize: 22, lineHeight: 28 },
  sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 12 },
  seg: { flexDirection: 'row', gap: 4 },
  segBtn: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 12 },
  segOn: { backgroundColor: '#1f1648', boxShadow: 'inset 0px 0px 0px 1px rgba(201,168,76,0.35)' },
  segT: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.2) },
  mine: { gap: 8, marginBottom: 14 },
  mineRow: { borderRadius: 14, padding: 14, gap: 6 },
  mineQ: { fontFamily: FONTS.serif, fontSize: 16, lineHeight: 21 },
  floor: { flexDirection: 'row', gap: 12 },
  col: { flex: 1, gap: 12 },
  tile: { borderRadius: 18, padding: 14, boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.05)' },
  no: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.2) },
  tileQ: { fontFamily: FONTS.serif, fontSize: 15, lineHeight: 20, marginTop: 6, flex: 1 },
  by: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  av: { width: 16, height: 16, borderRadius: 8, overflow: 'hidden' },
  votes: { flexDirection: 'row', marginTop: 8, borderRadius: 14, overflow: 'hidden', backgroundColor: '#1b1336', boxShadow: 'inset 0px 0px 0px 1px rgba(201,168,76,0.28)' },
  vBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 6 },
  vUp: { backgroundColor: '#ecd27e' },
  vDown: { backgroundColor: '#0a0618' },
  vT: { fontFamily: FONTS.mono, fontSize: 8 },
  bar: { height: 2, borderRadius: 1, marginTop: 8, backgroundColor: 'rgba(201,191,232,0.18)', overflow: 'hidden' },
  barUp: { height: 2 },
  empty: { textAlign: 'center', padding: 30, fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.15) },
  arch: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1 },
  archNo: { fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.2) },
  archQ: { flex: 1, fontFamily: FONTS.serif, fontSize: 15, lineHeight: 20 },
  suggest: { position: 'absolute', left: 18, right: 18, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 18, borderRadius: 24, boxShadow: '0px -6px 24px rgba(0,0,0,0.4), inset 0px 0px 0px 1px rgba(201,168,76,0.22)' },
  suggestT: { flex: 1, fontFamily: FONTS.sans, fontSize: 13 },
  topicHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 14 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  topicQ: { fontFamily: FONTS.serif, fontSize: 26, lineHeight: 32 },
  chip: { alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 12, borderRadius: 20, marginTop: 10 },
  chipT: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.12) },
  rep: { borderRadius: 16, padding: 14, marginBottom: 12, boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.05)' },
  repHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7 },
  av26: { width: 26, height: 26, borderRadius: 13, overflow: 'hidden' },
  repName: { flex: 1, fontFamily: FONTS.sansBold, fontSize: 11 },
  repText: { fontFamily: FONTS.sans, fontSize: 12.5, lineHeight: 19 },
  repActs: { flexDirection: 'row', gap: 16, marginTop: 9 },
  act: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actT: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.08) },
});
export default PollsLayer;
