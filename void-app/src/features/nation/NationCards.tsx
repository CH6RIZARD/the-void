// .nation-cards — the 7e TRENDING / ABOUT quiet cards (renderNationCTA / mountNationCard).
//   .nation-cards{display:flex;gap:8px;padding:10px 16px 0}
//   .nation-card = Card variant 'tile' (radius 12, var(--card), inset hi; LIGHT adds --elev)
//   .nc-eyebrow{Syne Mono 7px;.14em} trend gold · about #a78bfa (DARK #9d9aa3, LIGHT var(--purple))
//   .nc-title{12px;600;white;margin-top:5px;line-height:1.4;2 lines}
//   .nc-meta{Syne Mono 7px;dim;margin-top:5px;1 line ellipsis}  "<fmt(score)> HEARTS · TAP → REELS"
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Post } from '../../core/types';
import { useTheme } from '../../theme';
import { FONTS, em } from '../../theme/palettes';
import { Card } from '../../ui/Surface';

/** web fmt(n) */
export const fmt = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

export const NationCards = memo(function NationCards({ iso, trending, about, onOpen }: { iso: string; trending: Post | null; about: Post | null; onOpen: (postId: string) => void }) {
  const { name, colors } = useTheme();
  if (!trending && !about) return null;
  const aboutColor = name === 'dark' ? '#9d9aa3' : name === 'light' ? colors.purple : '#a78bfa';
  return (
    <View style={styles.row}>
      {trending ? <NationCard eyebrow="TRENDING" eyebrowColor={colors.gold} post={trending} onOpen={onOpen} /> : null}
      {about ? <NationCard eyebrow={'ABOUT ' + String(iso || '').toUpperCase()} eyebrowColor={aboutColor} post={about} onOpen={onOpen} /> : null}
    </View>
  );
});

function NationCard({ eyebrow, eyebrowColor, post, onOpen }: { eyebrow: string; eyebrowColor: string; post: Post; onOpen: (id: string) => void }) {
  const { colors } = useTheme();
  const title = String((post as any).title || post.body || '').slice(0, 120);
  return (
    <Card variant="tile" onPress={() => onOpen(post.id)} style={styles.card} accessibilityRole="button">
      <Text numberOfLines={1} style={[styles.eyebrow, { color: eyebrowColor }]}>
        {eyebrow}
      </Text>
      <Text numberOfLines={2} style={[styles.title, { color: colors.white }]}>
        {title}
      </Text>
      <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.meta, { color: colors.dim }]}>
        {`${fmt(post.score || 0)} HEARTS · TAP → REELS`}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, paddingTop: 10, paddingHorizontal: 16 },
  card: { flex: 1, minWidth: 0 },
  eyebrow: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.14) },
  title: { fontFamily: FONTS.sansSemiBold, fontSize: 12, lineHeight: 12 * 1.4, marginTop: 5 },
  meta: { fontFamily: FONTS.mono, fontSize: 7, marginTop: 5 },
});
