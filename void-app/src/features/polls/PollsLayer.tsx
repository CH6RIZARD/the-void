// Polls (handoff THE-VOID-22b §4): slides in from the right over the feed (.32s).
//   Board   as the web build's v22 polls: the live question beside its big serif
//           number (LET'S TALK), THE VOID ARCHIVE as a horizontal row of talking-point
//           cards, YOURS, THE FLOOR (two staggered columns, 196 / 160px tiles; @by +
//           PersonPfp, rank, question, serif UP / DOWN counts, agreement bar) and the
//           WRITE line at the bottom.
//   Topic   slides in over the board: LET'S TALK or THE VOID ARCHIVE · NO. n, the
//           question, age, voices, replies, chip. Replies ("chime") Top / New, like
//           toggles, reply pre-fills @handle, Enter or send posts as you.
// Votes are {+1, 0, −1}; the same side again clears it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, { ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NAV_PILL_HEIGHT, useBottomNavOffset } from '../../nav/layout';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../theme/ThemeProvider';
import { FONTS, em } from '../../theme/palettes';
import { FLICK_VELOCITY, WEB } from '../../theme/motion';
import { DealIn } from '../../ui/DealIn';
import { Icon } from '../../ui/icons';
import { PersonPfp } from '../../ui/Pfp';
import { GoldText } from '../../ui/GoldText';
import { VText } from '../../ui/Text';
import { CommentCard } from '../thread/CommentCard';
import { ComposePill } from '../thread/ComposePill';
import { viewerName } from '../thread/threadModel';
import { ago, fmt } from '../feed/format';
import { voidToast } from '../../ui/Toast';
import { clearTopicRequest, useTopicRequest } from './pollsStore';
import { chime, chimesOf, liked, likesOf, liveTopic, loadChimes, pullPolls, setPollsFailHandler, rankFloor, replyCount, tally, toggleLike, topics, usePolls, vote, voteOf, type FloorQ, type Topic } from './pollsStore';
import { SuggestSheet } from './SuggestSheet';

const GOLD = '#c9a84c';
const MUTED = '#8d7cc0';
const DIM = '#6a58a0';
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
  const navTop = useBottomNavOffset() + NAV_PILL_HEIGHT; // the write line sits on the nav pill
  const st = usePolls();
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const [seq, setSeq] = useState(0); // re-deal
  const [topic, setTopic] = useState<Topic | null>(null);
  const [topicOpen, setTopicOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [draft, setDraft] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await pullPolls();
    setRefreshing(false);
    setSeq((n) => n + 1);
  }, []);

  const x = useSharedValue(open ? 0 : 1);
  const back = useSharedValue(0); // topic open -> board recedes
  useEffect(() => {
    x.value = withTiming(open ? 0 : 1, SLIDE);
    if (open) {
      setSeq((n) => n + 1);
      pullPolls();
    } else {
      // closed from outside (Home tab): the next open starts on the board
      setTopicOpen(false);
      setSheet(false);
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
  // Mail asked for a topic: open it once the board has it (a pull may still be landing)
  const req = useTopicRequest();
  useEffect(() => {
    if (!req || !open) return;
    const t = st.topics.find((x) => x.id === req);
    if (t) {
      setSheet(false);
      openTopic(t);
      clearTopicRequest();
    }
  }, [req, open, st.topics]);
  const LIVE = liveTopic();
  const floor = rankFloor(sort);
  const mine = st.floor.filter((f) => f.mine);
  const past = topics().filter((t) => !t.live);
  const resort = (s: 'top' | 'new') => {
    setSort(s);
    setSeq((n) => n + 1);
  };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.layer, { backgroundColor: colors.bg }, slide]} pointerEvents={open ? 'auto' : 'none'}>
      <ScrollView
        contentContainerStyle={{ paddingTop: 44 + insets.top + 10, paddingBottom: navTop + 90, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={GOLD} colors={[GOLD]} progressBackgroundColor="#1b1336" progressViewOffset={44 + insets.top} />}
      >
        {/* live: big number, LET'S TALK, the question */}
        <Pressable onPress={() => openTopic(LIVE)} style={styles.live}>
          <GoldText text={String(LIVE.no)} size={64} family={FONTS.serif} letterSpacing={-2.5} height={58} />
          <View style={styles.liveBody}>
            <VText style={[styles.kicker9, { color: GOLD }]}>LET’S TALK</VText>
            <VText style={[styles.liveQ, { color: colors.white }]}>{LIVE.q}</VText>
            <VText style={[styles.meta11, { color: MUTED }]}>{fmt(replyCount(LIVE.id)) + ' replies · ' + ago(LIVE.t)}</VText>
          </View>
        </Pressable>

        {/* archive: talking points so far */}
        <View style={styles.secRow}>
          <VText style={[styles.sec, { color: GOLD }]}>ACCEPTED</VText>
          <VText style={[styles.meta11, { color: DIM }]}>Talking points so far</VText>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.archScroll} contentContainerStyle={styles.archRow}>
          {past.length ? (
            past.map((t) => (
              <Pressable key={t.id} onPress={() => openTopic(t)} style={styles.arch}>
                <View style={styles.archHead}>
                  {t.by ? (
                    <View style={styles.av18}>
                      <PersonPfp handle={t.by} label={t.by} size={18} />
                    </View>
                  ) : null}
                  <VText numberOfLines={1} style={[styles.meta10, { color: MUTED, flexShrink: 1 }]}>{t.by ? '@' + t.by : 'SET BY THE VOID'}</VText>
                  <View style={styles.archNo}>
                    <GoldText text={String(t.no).padStart(2, '0')} size={14} family={FONTS.serif} height={15} />
                  </View>
                </View>
                <VText style={styles.archQ}>{t.q}</VText>
              </Pressable>
            ))
          ) : (
            <VText style={[styles.empty, { color: colors.navDim, padding: 14 }]}>NOTHING ACCEPTED YET</VText>
          )}
        </ScrollView>

        {/* yours */}
        {mine.map((f) => {
          return (
            <DealIn key={f.id} pop>
              <View style={styles.mine}>
                <VText style={[styles.kicker9, { color: GOLD }]}>YOURS · IN REVIEW</VText>
                <VText style={[styles.mineQ, { color: colors.white }]}>{f.q}</VText>
              </View>
            </DealIn>
          );
        })}

        {/* the floor */}
        <View style={[styles.secRow, { marginTop: 26, marginBottom: 10 }]}>
          <VText style={[styles.sec, { color: GOLD }]}>THE FLOOR</VText>
          <View style={styles.sortBtns}>
            {(['top', 'new'] as const).map((s) => (
              <Pressable key={s} onPress={() => resort(s)} hitSlop={8}>
                <VText style={[styles.sec, { color: sort === s ? '#f4f0ff' : DIM }]}>{s.toUpperCase()}</VText>
              </Pressable>
            ))}
          </View>
        </View>
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
        <VText style={[styles.note, { color: DIM }]}>Up and down votes are public. The Void reads every suggestion and decides what runs.</VText>
      </ScrollView>

      {/* suggest: the write line */}
      <Pressable onPress={() => setSheet(true)} style={[styles.suggest, { bottom: navTop }]}>
        <LinearGradient colors={['rgba(5,3,15,0)', colors.bg]} locations={[0, 0.34]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={styles.suggestLine}>
          <VText numberOfLines={1} style={[styles.suggestT, { color: draft ? '#c9bfe8' : MUTED }]}>{draft || 'Suggest a question for The Void'}</VText>
          <LinearGradient colors={['rgba(201,168,76,0)', GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.rule} />
          <View style={styles.write}>
            <GoldText text="WRITE" size={9.5} family={FONTS.sansBold} letterSpacing={em(9.5, 0.22)} em={0.8} height={12} />
          </View>
        </View>
      </Pressable>

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, dim]} />
      <TopicPage topic={topic} open={topicOpen} width={width} recede={back} onClose={() => setTopicOpen(false)} />
      <SuggestSheet visible={sheet} onClose={() => setSheet(false)} draft={draft} setDraft={setDraft} />
    </Animated.View>
  );
}

function Tile({ f, i }: { f: FloorQ; i: number }) {
  // ponytail: no rank numeral on tiles, as the mock; the floor is read by sort order
  const { colors } = useTheme();
  const v = voteOf(f.id);
  const t = tally(f);
  const tall = i % 4 === 0 || i % 4 === 3;
  return (
    <DealIn delay={120 + Math.min(i, 8) * 50}>
      <LinearGradient colors={['#120b2c', '#0b0620']} style={[styles.tile, { minHeight: tall ? 196 : 160 }]}>
        <View style={styles.tileHead}>
          <View style={styles.av}>
            <PersonPfp handle={f.by} label={f.by} size={16} />
          </View>
          <VText numberOfLines={1} style={[styles.by, { color: DIM, flex: 1 }]}>{'@' + f.by}</VText>
        </View>
        <VText style={[styles.tileQ, { color: colors.white }]}>{f.q}</VText>
        <View style={styles.votes}>
          <Pressable onPress={() => vote(f.id, 1)} hitSlop={8} style={styles.vBtn} accessibilityLabel="Up">
            <VText style={[styles.vUpN, { color: v === 1 ? '#e2c56a' : GOLD }, v === 1 && styles.under]}>{fmt(t.up)}</VText>
            <VText style={[styles.vLbl, { color: v === 1 ? '#e2c56a' : GOLD }]}>UP</VText>
          </Pressable>
          <Pressable onPress={() => vote(f.id, -1)} hitSlop={8} style={styles.vBtn} accessibilityLabel="Down">
            <VText style={[styles.vDownN, { color: v === -1 ? '#f4f0ff' : MUTED }, v === -1 && styles.under]}>{fmt(t.down)}</VText>
            <VText style={[styles.vLbl, { color: v === -1 ? '#f4f0ff' : MUTED }]}>DOWN</VText>
          </Pressable>
        </View>
        <View style={[styles.bar, { opacity: v === -1 ? 0.35 : 1 }]}>
          <View style={[styles.barUp, { width: `${t.pct}%`, backgroundColor: GOLD }]} />
        </View>
      </LinearGradient>
    </DealIn>
  );
}

function TopicPage({ topic, open, width, recede, onClose }: { topic: Topic | null; open: boolean; width: number; recede: SharedValue<number>; onClose: () => void }) {
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
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: (width + 90) * x.value + width * 0.28 * recede.value }] }));
  // swipe right to leave, as the thread: a deliberate push right, never a drift while scrolling
  const swipeOut = Gesture.Pan()
    .activeOffsetX([-9999, 24])
    .failOffsetY([-14, 14])
    .onEnd((e) => {
      'worklet';
      if ((e.translationX > 80 && e.velocityX > 0) || e.velocityX > FLICK_VELOCITY) runOnJS(onClose)();
    });
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
      <GestureDetector gesture={swipeOut}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.topicHead, { paddingTop: insets.top + 14 }]}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.backBtn} accessibilityLabel="Back">
            <Icon name="back" size={16} color={GOLD} />
          </Pressable>
          <GoldText text={topic.live ? 'LET’S TALK' : 'THE VOID ARCHIVE · NO. ' + topic.no} size={10} family={FONTS.sansBold} letterSpacing={em(10, 0.12)} em={0.8} height={13} />
          {topic.live ? <VText style={[styles.meta10, { color: '#c9bfe8', marginLeft: 'auto', letterSpacing: em(10, 0.06) }]}>Live</VText> : null}
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <LinearGradient colors={['#140c30', '#0b0620']} style={styles.topicCard}>
            <VText style={[styles.topicQ, { color: colors.white }]}>{topic.q}</VText>
            <VText style={[styles.meta11, { color: MUTED, fontSize: 11.5, marginTop: 12 }]}>{fmt(reps.length) + ' replies · ' + ago(topic.t)}</VText>
            <View style={styles.chip}>
              <VText style={[styles.chipT, { color: topic.by ? GOLD : MUTED }]}>{topic.by ? 'FROM @' + topic.by.toUpperCase() : 'SET BY THE VOID'}</VText>
            </View>
          </LinearGradient>
          <View style={[styles.secRow, { marginTop: 20, marginBottom: 10 }]}>
            <VText style={[styles.sec, { color: GOLD, letterSpacing: em(10, 0.12) }]}>REPLIES</VText>
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
                  <VText style={[styles.segT, { color: csort === s ? '#f4f0ff' : DIM }]}>{s === 'top' ? 'Top' : 'New'}</VText>
                </Pressable>
              ))}
            </View>
          </View>
          <View key={seq}>
            {reps.length ? (
              // the thread's own reply card (CommentCard), so poll replies read exactly like thread replies
              reps.map((c, i) => (
                <CommentCard
                  key={c.id}
                  c={{ id: c.id, author: c.author, handle: c.handle, authorId: c.authorId, text: c.text, time: c.t, bolts: likesOf(c), mine: liked(c.id), parentId: null }}
                  opAuthor=""
                  kidsN={0}
                  deal
                  delay={c.id === fresh ? 0 : 120 + Math.min(i, 8) * 60}
                  onBolt={() => toggleLike(c.id)}
                  onReply={() => {
                    setText('@' + c.handle + ' ');
                    input.current?.focus();
                  }}
                />
              ))
            ) : (
              <VText style={[styles.empty, { color: colors.navDim }]}>NO ONE HAS CHIMED IN YET · GO FIRST</VText>
            )}
          </View>
        </ScrollView>
        <ComposePill ref={input} value={text} onChangeText={setText} onSubmit={send} placeholder="Add your reply…" avatar={viewerName(auth.user?.name)[0]?.toUpperCase() || '◎'} style={{ marginHorizontal: 16, marginBottom: 14 + insets.bottom }} />
      </KeyboardAvoidingView>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  layer: { zIndex: 57 },
  topic: { zIndex: 59 },
  // type
  kicker9: { fontFamily: FONTS.sansBold, fontSize: 9, letterSpacing: em(9, 0.22) },
  sec: { fontFamily: FONTS.sansBold, fontSize: 10, letterSpacing: em(10, 0.14) },
  meta10: { fontFamily: FONTS.sans, fontSize: 10 },
  meta11: { fontFamily: FONTS.sans, fontSize: 11 },
  empty: { textAlign: 'center', padding: 30, fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.15) },
  // live
  live: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingTop: 6 },
  liveBody: { flex: 1, paddingTop: 4 },
  liveQ: { fontFamily: FONTS.serif, fontSize: 19, lineHeight: 23, marginTop: 5 },
  // archive
  secRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22, marginBottom: 8, paddingHorizontal: 2 },
  archScroll: { marginHorizontal: -16 },
  archRow: { gap: 8, paddingHorizontal: 16, paddingBottom: 4 },
  arch: { width: 196, borderRadius: 14, backgroundColor: 'rgba(201,191,232,0.05)', paddingVertical: 11, paddingHorizontal: 12 },
  archHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  archNo: { marginLeft: 'auto' },
  archQ: { fontFamily: FONTS.serif, fontSize: 13.5, lineHeight: 17.5, marginTop: 8, color: '#c9bfe8' },
  // yours
  mine: { marginTop: 18, borderRadius: 16, backgroundColor: 'rgba(201,168,76,0.07)', boxShadow: 'inset 0px 0px 0px 1px rgba(201,168,76,0.3)', paddingVertical: 12, paddingHorizontal: 14 },
  mineQ: { fontFamily: FONTS.serif, fontSize: 15, lineHeight: 19.5, marginTop: 5 },
  // floor
  sortBtns: { marginLeft: 'auto', flexDirection: 'row', gap: 14 },
  floor: { flexDirection: 'row', gap: 10, paddingBottom: 22 },
  col: { flex: 1, gap: 8 },
  tile: { borderRadius: 18, paddingTop: 13, paddingHorizontal: 13, paddingBottom: 11, boxShadow: 'inset 0px 0px 0px 1px rgba(201,168,76,0.18), 0px 10px 24px rgba(0,0,0,0.5)' },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  av: { width: 16, height: 16, borderRadius: 8, overflow: 'hidden' },
  by: { fontFamily: FONTS.sans, fontSize: 9.5 },
  av18: { width: 18, height: 18, borderRadius: 9, overflow: 'hidden' },
  tileQ: { fontFamily: FONTS.serif, fontSize: 15, lineHeight: 19, marginTop: 7, flex: 1 },
  votes: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 12, paddingTop: 9, borderTopWidth: 1, borderTopColor: 'rgba(201,168,76,0.14)' },
  vBtn: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  vUpN: { fontFamily: FONTS.serif, fontSize: 19, lineHeight: 19 },
  vDownN: { fontFamily: FONTS.serif, fontSize: 15, lineHeight: 15 },
  vLbl: { fontFamily: FONTS.sansBold, fontSize: 8.5, letterSpacing: em(8.5, 0.14) },
  under: { textDecorationLine: 'underline' },
  bar: { height: 2, borderRadius: 1, marginTop: 8, backgroundColor: 'rgba(201,191,232,0.18)', overflow: 'hidden' },
  barUp: { height: 2 },
  note: { paddingTop: 14, paddingHorizontal: 2, fontFamily: FONTS.sans, fontSize: 11, lineHeight: 16.5 },
  // write line
  suggest: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 },
  suggestLine: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 46, borderTopWidth: 1, borderTopColor: 'rgba(201,168,76,0.3)' },
  suggestT: { flex: 1, fontFamily: FONTS.serifItalic, fontSize: 16 },
  rule: { width: 22, height: 1 },
  write: { marginLeft: -4 },
  // topic
  topicHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  backBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1b1336', boxShadow: 'inset 0px 0px 0px 1px rgba(201,168,76,0.28), inset 0px 1px 0px rgba(255,230,160,0.12), 0px 3px 8px rgba(0,0,0,0.6)' },
  topicCard: { borderRadius: 20, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 15, boxShadow: 'inset 0px 0px 0px 1px rgba(201,168,76,0.32), inset 0px 1px 0px rgba(255,230,160,0.16), 0px 14px 30px rgba(0,0,0,0.6)' },
  topicQ: { fontFamily: FONTS.serif, fontSize: 26, lineHeight: 30.5, letterSpacing: -0.26 },
  chip: { alignSelf: 'flex-start', marginTop: 11, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 12, backgroundColor: '#0b0620', boxShadow: 'inset 0px 0px 0px 1px rgba(201,168,76,0.2)' },
  chipT: { fontFamily: FONTS.sansBold, fontSize: 10, letterSpacing: em(10, 0.08) },
  seg: { marginLeft: 'auto', flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: '#07041a', boxShadow: 'inset 0px 2px 4px rgba(0,0,0,0.75), inset 0px 0px 0px 1px rgba(201,168,76,0.12)' },
  segBtn: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 9 },
  segOn: { backgroundColor: '#1b1336', boxShadow: 'inset 0px 0px 0px 1px rgba(201,168,76,0.28)' },
  segT: { fontFamily: FONTS.sansBold, fontSize: 11.5 },
});
export default PollsLayer;
