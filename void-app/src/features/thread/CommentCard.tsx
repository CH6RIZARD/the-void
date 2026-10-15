// _tcCard(c, opAuthor, kidsN, o) — one comment card with 0/1/2 reply stack edges
// (patch3 §4.A, ref 8b) and the deal-up animation (§4.C: 60ms stagger, spring).
//
//   .tc-wrap{margin-bottom:16px}  .s1,.s2{margin-bottom:26px}
//   .tc-edge.e1{left:5;right:5;bottom:-5;h30;r17;--tc-edge1;inset 0 1px 0 rgba(255,255,255,.04)}
//   .tc-edge.e2{left:10;right:10;bottom:-10;h30;r16;--tc-edge2;inset 0 1px 0 rgba(255,255,255,.03)}
//   .tc-card{r18;--tc-card;0 10px 28px var(--tc-shadow),inset 0 1px 0 var(--tc-hi);padding:14px 15px 12px}
//   .tc-card.parent{+0 0 0 1px rgba(201,168,76,.22)}  .tc-parent-tag{Syne Mono 7 .14em gold}
//   .ro-list variants: r16, --tc-reply, 0 8px 20px rgba(0,0,0,.45), padding 12 14 11, av 20, name 10.5, text 11.5
//   @keyframes tcDealIn{from{opacity:0;translateY(24px)}} .46s cubic-bezier(.34,1.32,.64,1)
//   @keyframes tcDealOut{to{opacity:0;translateY(24px)}} .2s cubic-bezier(.4,0,1,1)
import React, { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Image } from 'expo-image';
import type { Comment } from '../../core';
import { useTheme } from '../../theme/ThemeProvider';
import { FONTS, em } from '../../theme/palettes';
import { Icon } from '../../ui/icons';
import { ImageOrbitLoader } from '../../ui/ImageOrbitLoader';
import { VText } from '../../ui/Text';
import { ago, fmt } from '../feed/format';
import { PersonPfp } from '../../ui/Pfp';
import { openUser } from '../feed/navigation';
import { VmodIcon } from '../feed/vmodIcons';
import { useThreadTokens } from './threadTheme';

const DEAL_IN = Easing.bezier(0.34, 1.32, 0.64, 1);
const DEAL_OUT = Easing.bezier(0.4, 0, 1, 1);
const DEAL_MS = 460;

export interface DealProps {
  /** deal in on mount */
  deal?: boolean;
  /** ms; negative = already that far into the deal (resume mid-deal) */
  delay?: number;
  /** deal down/out */
  closing?: boolean;
  closeDelay?: number;
}

export interface CommentCardProps extends DealProps {
  c: Comment;
  opAuthor: string;
  kidsN: number;
  parent?: boolean;
  /** inside the reply overlay list (.ro-list) */
  nested?: boolean;
  onOpen?: (c: Comment) => void;
  onReply?: (c: Comment) => void;
  onBolt: (c: Comment) => void;
  onMore?: (c: Comment) => void;
  /** peek-fan (handoff 22b §5): first child previewed under the card, `+N MORE`; no stack edges */
  peekOf?: Comment | null;
  peekMore?: number;
  /** `▾ 3 REPLIES` / `▴ 3 REPLIES` at the head's right; gold while open */
  kidsLabel?: string;
  kidsOn?: boolean;
  noEdges?: boolean;
  /** a card in the horizontal fan (22b): fixed width, equal heights, no bottom margin */
  width?: number;
}

export const CommentCard = memo(function CommentCard({ c, opAuthor, kidsN, parent, nested, onOpen, onReply, onBolt, onMore, deal, delay = 0, closing, closeDelay = 0, peekOf, peekMore = 0, kidsLabel, kidsOn, noEdges, width }: CommentCardProps) {
  const { colors, isLight, name: themeName } = useTheme();
  const tk = useThreadTokens();
  const v = useSharedValue(deal ? 0 : 1);
  const [imgShown, setImgShown] = useState(false);
  const [imgDead, setImgDead] = useState(false);

  useEffect(() => {
    if (!deal) return;
    const lead = Math.max(0, -delay);
    v.value = 0; // a resumed deal (negative delay) just runs shorter
    v.value = withDelay(Math.max(0, delay), withTiming(1, { duration: Math.max(120, DEAL_MS - lead), easing: DEAL_IN, reduceMotion: ReduceMotion.System }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!closing) return;
    v.value = withDelay(closeDelay, withTiming(0, { duration: 200, easing: DEAL_OUT, reduceMotion: ReduceMotion.System }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, v.value)), transform: [{ translateY: (1 - v.value) * 24 }] }));

  const isOp = (c.author || '') === opAuthor;
  const edges = noEdges ? 0 : kidsN >= 2 ? 2 : kidsN === 1 ? 1 : 0;
  const mb = width ? 0 : nested ? (edges ? 18 : 8) : edges ? 26 : 16;
  const canMore = !!onMore && (c.remote || !!c.authorId);
  const toUser = c.authorId ? c.handle : null; // Void accounts only; remote handles have no /u page

  const cardStyle = nested
    ? { borderRadius: 16, backgroundColor: tk.reply, boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.05), 0px 8px 20px rgba(0,0,0,0.45)', paddingTop: 12, paddingHorizontal: 14, paddingBottom: 11 }
    : {
        borderRadius: 18,
        backgroundColor: tk.card,
        boxShadow: `0px 10px 28px ${tk.shadow}${parent ? ', 0px 0px 0px 1px rgba(201,168,76,0.22)' : ''}, inset 0px 1px 0px ${tk.hi}`,
        paddingTop: 14,
        paddingHorizontal: 15,
        paddingBottom: 12,
      };
  const av = nested ? 20 : 26;
  const avStyle = isLight ? { boxShadow: 'inset 0px 0px 0px 1px rgba(26,20,36,0.12), 0px 2px 6px rgba(26,20,36,0.12)' } : null;

  const body = (
    <View style={[cardStyle, styles.cardZ, width ? { flex: 1 } : null]}>
      <View style={[styles.head, { gap: nested ? 7 : 8, marginBottom: nested ? 6 : 8 }]}>
        <Pressable disabled={!toUser} onPress={() => openUser(toUser)} style={[styles.av, { width: av, height: av, borderRadius: av / 2 }, avStyle]}>
          <PersonPfp uid={c.authorId} handle={c.handle} label={c.author} size={av} />
        </Pressable>
        <VText onPress={toUser ? () => openUser(toUser) : undefined} style={[styles.name, { fontSize: nested ? 10.5 : 11, color: colors.white }]}>
          {c.author || 'anon'}
          {isOp ? ' ' : ''}
          {isOp ? <VText style={[styles.op, (isLight || themeName === 'creamDark') && { color: colors.purple, backgroundColor: colors.pdim }]}>{' OP '}</VText> : null}
          <VText style={[styles.time, { color: colors.navDim }]}>{' · ' + ago(c.time)}</VText>
        </VText>
        {kidsLabel ? <VText style={[styles.parentTag, { color: kidsOn ? colors.gold : colors.navDim }]}>{kidsLabel}</VText> : parent ? <VText style={[styles.parentTag, { color: colors.gold }]}>PARENT</VText> : null}
      </View>
      <VText style={[styles.text, { fontSize: nested ? 11.5 : 12.5, lineHeight: (nested ? 11.5 : 12.5) * 1.5, color: tk.text }]}>{c.text || ''}</VText>
      {c.img && !imgDead ? (
        <View style={[styles.img, imgShown ? null : { minHeight: 120 }]}>
          <Image
            source={{ uri: c.img }}
            style={imgShown ? { width: '100%', height: width ? 110 : nested ? 140 : 160 } : StyleSheet.absoluteFill}
            contentFit="cover"
            onDisplay={() => setImgShown(true)}
            onError={() => setImgDead(true)}
          />
          {!imgShown ? <ImageOrbitLoader surface="feed" radius={12} /> : null}
        </View>
      ) : null}
      <View style={[styles.acts, { marginTop: nested ? 8 : 9 }]}>
        <Pressable onPress={() => onBolt(c)} hitSlop={8} style={styles.act}>
          <Icon name={c.mine ? 'heartFill' : 'heart'} size={11} color={c.mine ? colors.gold : colors.navDim} />
          <VText style={[styles.actT, { color: c.mine ? colors.gold : colors.navDim }]}>{fmt(c.bolts || 0)}</VText>
        </Pressable>
        <Pressable onPress={() => onReply?.(c)} hitSlop={8} style={styles.act}>
          <VText style={[styles.actT, { color: colors.navDim }]}>REPLY</VText>
        </Pressable>
        {canMore ? (
          <Pressable onPress={() => onMore!(c)} hitSlop={8} style={[styles.act, { marginLeft: 'auto' }]} accessibilityLabel="More">
            <VmodIcon name="more" size={14} color={colors.navDim} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
  // .peek: a tab tucked under the card's bottom edge (margin -6px 8px 0; r 0 0 14 14; card @62%)
  const peek = peekOf ? (
    <View style={[styles.peek, { backgroundColor: tk.peek }]}>
      <View style={styles.peekAv}>
        <PersonPfp uid={peekOf.authorId} handle={peekOf.handle} label={peekOf.author} size={18} />
      </View>
      <VText numberOfLines={1} style={[styles.peekT, { color: tk.peekText }]}>
        <VText style={[styles.peekName, { color: tk.text }]}>{(peekOf.author || 'anon') + ' '}</VText>
        {peekOf.text || ''}
      </VText>
      {peekMore > 0 ? <VText style={[styles.peekMore, { color: colors.gold }]}>{'+' + peekMore + ' MORE'}</VText> : null}
    </View>
  ) : null;
  const inner = peek ? (
    <>
      {body}
      {peek}
    </>
  ) : (
    body
  );

  return (
    <Animated.View style={[{ position: 'relative', marginBottom: mb }, width ? { width } : null, style]}>
      {edges >= 2 ? <View pointerEvents="none" style={[styles.e2, { backgroundColor: tk.edge2 }]} /> : null}
      {edges >= 1 ? <View pointerEvents="none" style={[styles.e1, { backgroundColor: tk.edge1 }]} /> : null}
      {parent || !onOpen ? inner : <Pressable onPress={() => onOpen(c)} style={width ? { flex: 1 } : null}>{inner}</Pressable>}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  e1: { position: 'absolute', left: 5, right: 5, bottom: -5, height: 30, borderRadius: 17, boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.04)' },
  e2: { position: 'absolute', left: 10, right: 10, bottom: -10, height: 30, borderRadius: 16, boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.03)' },
  head: { flexDirection: 'row', alignItems: 'center' },
  av: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  name: { flexShrink: 1, minWidth: 0, fontFamily: FONTS.sansBold },
  op: { fontFamily: FONTS.mono, fontSize: 6.5, letterSpacing: em(6.5, 0.1), color: '#a78bfa', backgroundColor: 'rgba(124,58,237,0.18)' },
  time: { fontFamily: FONTS.mono, fontSize: 8 },
  parentTag: { marginLeft: 'auto', fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.14) },
  text: { fontFamily: FONTS.sans },
  img: { position: 'relative', marginTop: 8, borderRadius: 12, overflow: 'hidden' },
  acts: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  act: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actT: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.08) },
  cardZ: { position: 'relative', zIndex: 3 },
  peek: { zIndex: 2, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -6, marginHorizontal: 8, paddingTop: 14, paddingHorizontal: 12, paddingBottom: 9, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.04)' },
  peekAv: { width: 18, height: 18, borderRadius: 9, overflow: 'hidden', flexShrink: 0 },
  peekT: { flex: 1, minWidth: 0, fontFamily: FONTS.sans, fontSize: 11 },
  peekName: { fontFamily: FONTS.sansBold, fontSize: 11 },
  peekMore: { fontFamily: FONTS.mono, fontSize: 6.5, letterSpacing: em(6.5, 0.14), flexShrink: 0 },
});
