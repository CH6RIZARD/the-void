// Mail (handoff THE-VOID-22b §3): a full-screen layer that slides in from the right
// over Feed or Polls (.32s). `MAIL · N new`, "Notifications", then New / Today /
// This week, empty sections not rendered. Rows deal in (tcDealIn, 60 + 45i ms).
//
// Icon rows (bolt / follow): kind icon, up to three PersonPfps, who + action + time,
// the quoted drop in muted under it, a 46px thumbnail of the drop at right.
// Post rows (reply / mention): 38px PersonPfp, Name @handle · time, context line,
// the full text, thumbnail of the parent drop. Follow rows carry Follow back.
// A tap follows the row's `go`: the thread (opened on the reply), the person, or the
// Polls topic page (through onTopic, which the feed screen owns).
import React, { memo, useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { useInk } from '../../theme/ink';
import { FONTS, em } from '../../theme/palettes';
import { WEB } from '../../theme/motion';
import { DealIn } from '../../ui/DealIn';
import { Icon, type IconName } from '../../ui/icons';
import { PersonPfp } from '../../ui/Pfp';
import { VText } from '../../ui/Text';
import { ago } from '../feed/format';
import { openThreadRoute, openUser } from '../feed/navigation';
import { pullNotifs, sectionOf, toggleFollow, useFollowing, useNotifs, type Go, type Notif } from './notifs';

const MUTED = '#8d7cc0';
const HAIR = 'rgba(201,168,76,0.10)';
const SECTIONS: Array<['new' | 'today' | 'week', string]> = [
  ['new', 'New'],
  ['today', 'Today'],
  ['week', 'This week'],
];
const ACT: Record<Notif['kind'], string> = { bolt: 'bolted your drop', reply: 'replied to your drop', follow: 'started following you', void: 'took your question up · it is live', repost: 'reposted your drop', mention: 'mentioned you', chime: 'chimed in on your question', chimeBolt: 'bolted your chime' };
const CTX: Record<Notif['kind'], string> = { bolt: 'Bolted your drop', reply: 'Replying to you', follow: 'Started following you', void: 'The Void · on the floor', repost: 'Reposted your drop', mention: 'Mentioned you', chime: 'Chimed in on your question', chimeBolt: 'Bolted your chime' };
const KICON: Record<Notif['kind'], IconName> = { bolt: 'boltFill', reply: 'reply', repost: 'repost', follow: 'userPlus', mention: 'at', void: 'home', chime: 'reply', chimeBolt: 'boltFill' };

export function MailLayer({ open, width, onTopic }: { open: boolean; width: number; onTopic: (questionId: string) => void }) {
  const { colors } = useTheme();
  const ink = useInk();
  const insets = useSafeAreaInsets();
  const { items, unread } = useNotifs();
  const x = useSharedValue(open ? 0 : 1);
  useEffect(() => {
    x.value = withTiming(open ? 0 : 1, { duration: 320, easing: WEB.SHEET, reduceMotion: ReduceMotion.System });
    if (open) pullNotifs();
  }, [open, x]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: (width + 90) * x.value }] }));

  const now = Date.now();
  const groups = SECTIONS.map(([k, label]) => ({ k, label, rows: items.filter((n) => sectionOf(n, now) === k) })).filter((g) => g.rows.length);
  let i = 0;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.layer, { backgroundColor: colors.bg }, slide]} pointerEvents={open ? 'auto' : 'none'}>
      <ScrollView contentContainerStyle={{ paddingTop: 44 + insets.top + 10, paddingBottom: 90 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <VText style={[styles.kicker, { color: colors.gold }]}>{'MAIL · ' + unread + ' NEW'}</VText>
          <VText style={[styles.title, { color: colors.white }]}>Notifications</VText>
        </View>
        {open && !groups.length ? <VText style={[styles.empty, { color: colors.navDim }]}>NOTHING YET · BOLTS, REPLIES, MENTIONS, FOLLOWS AND CHIMES LAND HERE</VText> : null}
        {open
          ? groups.map((g) => (
              <View key={g.k}>
                <VText style={[styles.section, { color: MUTED }]}>{g.label.toUpperCase()}</VText>
                {g.rows.map((n) => (
                  <DealIn key={n.id} delay={60 + i++ * 45}>
                    <Row n={n} onTopic={onTopic} />
                  </DealIn>
                ))}
              </View>
            ))
          : null}
      </ScrollView>
    </Animated.View>
  );
}

function follow(go: Go | undefined, onTopic: (id: string) => void): (() => void) | undefined {
  if (!go) return undefined;
  if ('thread' in go) return () => openThreadRoute(go.thread, go.focus);
  if ('user' in go) return () => void openUser(go.user);
  return () => onTopic(go.topic);
}

const Row = memo(function Row({ n, onTopic }: { n: Notif; onTopic: (id: string) => void }) {
  const { colors } = useTheme();
  const ink = useInk();
  const isVoid = n.kind === 'void';
  const isGold = n.kind === 'bolt' || n.kind === 'chimeBolt' || isVoid;
  const hs = n.by.map((a) => '@' + a.handle);
  const who = isVoid ? 'The Void' : n.others ? hs.slice(0, 2).join(', ') + ' and ' + n.others + ' others' : hs.length > 1 ? hs.slice(0, -1).join(', ') + ' and ' + hs[hs.length - 1] : hs[0] || 'someone';
  const isPost = n.kind === 'reply' || n.kind === 'mention' || n.kind === 'chime';
  const toThread = follow(n.go, onTopic);
  const bg = n.unread ? 'rgba(201,168,76,0.045)' : 'transparent';

  if (isPost) {
    const a = n.by[0];
    return (
      <Pressable onPress={toThread} style={[styles.row, { backgroundColor: bg }]}>
        <Pressable onPress={() => a && openUser(a.handle)} style={styles.av38}>
          <PersonPfp uid={a?.id} handle={a?.handle} label={a?.name} size={38} />
        </Pressable>
        <View style={styles.body}>
          <VText numberOfLines={1} style={[styles.name, { color: colors.white }]}>
            {a?.name || 'anon'}
            <VText style={[styles.handle, { color: MUTED }]}>{'  @' + (a?.handle || 'anon') + ' · ' + ago(n.time)}</VText>
          </VText>
          <VText style={[styles.ctx, { color: MUTED }]}>{CTX[n.kind]}</VText>
          <VText style={[styles.text, { color: colors.white }]}>{n.text}</VText>
        </View>
        <Thumb post={n.post} />
      </Pressable>
    );
  }
  return (
    <Pressable onPress={toThread} disabled={!toThread} style={[styles.row, { backgroundColor: bg }]}>
      <View style={styles.kind}>
        <Icon name={KICON[n.kind]} size={24} color={isGold ? colors.gold : ink.lilac} />
      </View>
      <View style={styles.body}>
        {!isVoid && n.by.length ? (
          <View style={styles.avRow}>
            {n.by.slice(0, 3).map((a, j) => (
              <Pressable key={a.id} onPress={() => openUser(a.handle)} style={[styles.av26, j > 0 && { marginLeft: -6 }]}>
                <PersonPfp uid={a.id} handle={a.handle} label={a.name} size={26} />
              </Pressable>
            ))}
          </View>
        ) : null}
        <VText style={[styles.line, { color: colors.white }]}>
          <VText style={styles.who}>{who}</VText>
          {' ' + ACT[n.kind] + ' '}
          <VText style={{ color: MUTED }}>{ago(n.time)}</VText>
        </VText>
        {n.kind === 'chimeBolt' && n.text ? (
          <VText numberOfLines={2} style={[styles.quote, { color: MUTED }]}>
            {n.text}
          </VText>
        ) : n.post && (n.kind === 'bolt' || n.kind === 'repost' || isVoid) ? (
          <VText numberOfLines={2} style={[styles.quote, { color: MUTED }]}>
            {n.post.body}
          </VText>
        ) : null}
        {n.kind === 'follow' ? (
          <View style={styles.follows}>
            {n.by.map((a) => (
              <FollowBack key={a.id} handle={a.handle} />
            ))}
          </View>
        ) : null}
      </View>
      <Thumb post={n.post} />
    </Pressable>
  );
});

/** 46px: the drop's image if it has one, else the text card (dark, gold hairline, 6.5px text). */
function Thumb({ post }: { post?: Notif['post'] }) {
  const { colors } = useTheme();
  const ink = useInk();
  if (!post) return null;
  return (
    <View style={[styles.thumb, { backgroundColor: colors.card }]}>
      {post.img ? <Image source={{ uri: post.img }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <VText numberOfLines={4} style={[styles.thumbT, { color: colors.white }]}>{post.body}</VText>}
    </View>
  );
}

function FollowBack({ handle }: { handle: string }) {
  const on = useFollowing(handle);
  return (
    <Pressable onPress={() => toggleFollow(handle)} style={[styles.pill, on ? styles.pillGhost : styles.pillGold]} accessibilityLabel={on ? 'Following' : 'Follow back'}>
      <VText style={[styles.pillT, { color: on ? '#c9a84c' : '#1a1030' }]}>{on ? 'Following' : 'Follow back'}</VText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 58 },
  head: { paddingHorizontal: 18, paddingBottom: 10 },
  kicker: { fontFamily: FONTS.mono, fontSize: 10, letterSpacing: em(10, 0.18) },
  title: { fontFamily: FONTS.serif, fontSize: 30, lineHeight: 36, marginTop: 4 },
  section: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.25), paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 },
  empty: { textAlign: 'center', padding: 36, fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.15) },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: HAIR },
  kind: { width: 24, height: 24, marginTop: 2 },
  body: { flex: 1, minWidth: 0, gap: 6 },
  avRow: { flexDirection: 'row', alignItems: 'center' },
  av26: { width: 26, height: 26, borderRadius: 13, overflow: 'hidden' },
  av38: { width: 38, height: 38, borderRadius: 19, overflow: 'hidden' },
  line: { fontFamily: FONTS.sans, fontSize: 13, lineHeight: 18 },
  who: { fontFamily: FONTS.sansBold },
  quote: { fontFamily: FONTS.sans, fontSize: 13, lineHeight: 18 },
  name: { fontFamily: FONTS.sansBold, fontSize: 13 },
  handle: { fontFamily: FONTS.mono, fontSize: 9 },
  ctx: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.1) },
  text: { fontFamily: FONTS.sans, fontSize: 14, lineHeight: 20 },
  thumb: { width: 46, height: 46, borderRadius: 8, overflow: 'hidden', padding: 4, boxShadow: '0px 0px 0px 1px rgba(201,168,76,0.3)' },
  thumbT: { fontFamily: FONTS.serifItalic, fontSize: 6.5, lineHeight: 8.5 },
  follows: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  pill: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 16 },
  pillGold: { backgroundColor: '#c9a84c' },
  pillGhost: { backgroundColor: 'transparent', boxShadow: 'inset 0px 0px 0px 1px rgba(201,168,76,0.4)' },
  pillT: { fontFamily: FONTS.sansBold, fontSize: 11 },
});
export default MailLayer;
