// SIGNAL FEED card — the .search-post-card markup renderSearch() builds, 1:1.
//
// .search-post-card{padding:16px;margin:0 14px 10px;border-radius:18px;background:rgba(13,8,32,.85);
//   box-shadow:0 10px 30px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.06)}   :active{opacity:.72}
// .search-post-cover{width:calc(100% + 28px);margin:0 -14px 10px;aspect-ratio:2/1;overflow:hidden}
//   bg: linear-gradient(135deg,hsl(H,70%,8%),hsl(H+30,50%,3%)) + IMG_LOADER + <img onerror=remove>
// .search-post-card-head{gap:7px;margin-bottom:8px;font:'Syne Mono' 8px;color:var(--dim);letter-spacing:.07em}
// .search-post-tag{font:'Syne Mono' 8px;color:var(--gold);background:var(--gglow);border:1px solid rgba(201,168,76,.25);
//   padding:1px 7px;border-radius:3px;margin-bottom:7px;letter-spacing:.1em}
// .search-post-body{'DM Serif Display' italic 16px/1.38;color:var(--white);margin-bottom:8px}
// .search-post-body.take{'Syne' 600 14px/1.45 normal}
// .search-post-meta{'Syne Mono' 8px;color:var(--muted);letter-spacing:.06em;gap:12px}  span{gap:5px}  .vi 11px
// .search-user-badge{font-size:7px;background:var(--pdim);color:var(--dim);padding:1px 5px;border-radius:2px;letter-spacing:.08em}
import React, { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { Post } from '../../core';
import { Icon } from '../../ui/icons';
import { ImageOrbitLoader } from '../../ui/ImageOrbitLoader';
import { useTheme } from '../../theme/tokens';
import { FONTS, em } from '../../theme/palettes';
import { ago, fmt } from './format';

export const SearchPostCard = memo(function SearchPostCard({ post: p, onOpen }: { post: Post; onOpen(id: string): void }) {
  const { colors } = useTheme();
  const [imgState, setImgState] = useState<'loading' | 'shown' | 'failed'>('loading');
  const isImg = p.style === 'image';
  const take = !(p.style === 'drop' || p.style === 'image');
  const hue = p.imgHue || 270;

  return (
    <Pressable
      onPress={() => onOpen(String(p.id).replace(/'/g, ''))}
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.72 : 1 }]}
    >
      {isImg && p._img ? (
        <View style={styles.cover}>
          <View
            style={[
              StyleSheet.absoluteFill,
              { experimental_backgroundImage: `linear-gradient(135deg, hsl(${hue},70%,8%), hsl(${hue + 30},50%,3%))` } as any,
            ]}
          />
          {imgState !== 'failed' ? (
            <>
              <Image
                source={{ uri: p._img }}
                style={[StyleSheet.absoluteFill, styles.z1]}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={0}
                onDisplay={() => setImgState('shown')}
                onError={() => setImgState('failed')}
              />
              {imgState === 'loading' ? <ImageOrbitLoader surface="feed" /> : null}
            </>
          ) : null}
        </View>
      ) : null}
      <View style={styles.head}>
        <Icon name="pin" size={11} color={colors.dim} />
        <Text allowFontScaling={false} style={[styles.headText, { color: colors.dim }]}>
          {p.country || 'world'}
        </Text>
        {p._user ? (
          <Text allowFontScaling={false} style={[styles.badge, { backgroundColor: colors.pdim, color: colors.dim }]}>
            YOUR DROP
          </Text>
        ) : null}
      </View>
      <View style={[styles.tag, { backgroundColor: colors.gglow }]}>
        <Text allowFontScaling={false} style={[styles.tagText, { color: colors.gold }]}>
          {(p.tags && p.tags[0]) || 'void'}
        </Text>
      </View>
      <Text allowFontScaling={false} style={[take ? styles.bodyTake : styles.body, { color: colors.white }]}>
        {p.body || ''}
      </Text>
      <View style={styles.meta}>
        <View style={styles.metaItem}>
          <Icon name="bolt" size={11} color={colors.muted} />
          <Text allowFontScaling={false} style={[styles.metaText, { color: colors.muted }]}>
            {fmt(p.score || 0)}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Icon name="reply" size={11} color={colors.muted} />
          <Text allowFontScaling={false} style={[styles.metaText, { color: colors.muted }]}>
            {fmt(p.replies || 0)}
          </Text>
        </View>
        <Text allowFontScaling={false} style={[styles.metaText, { color: colors.muted }]}>
          {ago(p.time || Date.now())}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    padding: 16,
    marginHorizontal: 14,
    marginBottom: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(13,8,32,0.85)',
    boxShadow: '0px 10px 30px rgba(0,0,0,0.45), inset 0px 1px 0px rgba(255,255,255,0.06)',
  } as any,
  cover: { marginHorizontal: -14, marginBottom: 10, aspectRatio: 2, overflow: 'hidden', position: 'relative' },
  z1: { zIndex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  headText: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.07) },
  badge: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.08), paddingVertical: 1, paddingHorizontal: 5, borderRadius: 2, overflow: 'hidden', marginLeft: 4 },
  tag: { alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(201,168,76,0.25)', paddingVertical: 1, paddingHorizontal: 7, borderRadius: 3, marginBottom: 7 },
  tagText: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.1) },
  body: { fontFamily: FONTS.serifItalic, fontSize: 16, lineHeight: 16 * 1.38, marginBottom: 8 },
  bodyTake: { fontFamily: FONTS.sansSemiBold, fontSize: 14, lineHeight: 14 * 1.45, marginBottom: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.06) },
});
