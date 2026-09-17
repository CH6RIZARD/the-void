// .nation-hero — the 7e Cinema LIVE hero. Full-bleed 16:10, no radius, #05020e ground.
//   stage     .csg-tile.nation-hero-stage (inset 0) → StreamTile + the sparkle hold
//   .nh-top   badge (◉ LIVE red / ▷ NOW gold VOD) + kind (CITY CAM / WALKING TOUR / …)
//   .nh-cap   serif italic caption over transparent → rgba(4,2,12,.95)
// .nh-play is display:none!important in the web, and the loader's status label is
// hidden inside the hero (.nation-hero .sparkle-fallback-label{display:none}).
// Tap: a PLAYING stage takes the tap for sound (capture-phase handler in the web);
// otherwise nationHeroTap() opens the reels seeded nation-first.
import React, { memo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { nationHeroMeta } from '../../core';
import type { Country } from '../../core/types';
import { FONTS, em } from '../../theme/palettes';
import { StreamTile, type StreamTileHandle } from '../live/StreamTile';
import { TileLoader } from '../live/TileChrome';
import { useNationHero } from './useNationHero';

export const NATION_HERO_TILE_ID = 'nation-hero';

export const NationHero = memo(function NationHero({ c, onOpenReels }: { c: Country; onOpenReels: () => void }) {
  const hero = useNationHero(c);
  const player = useRef<StreamTileHandle>(null);
  if (hero.hidden) return null;
  const meta = nationHeroMeta(hero.metaSrc, c);
  const a = hero.attempt;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={meta.caption || c.n}
      onPress={() => {
        if (hero.playing && player.current?.tap()) return; // toggleStreamAudio(cell)
        onOpenReels();
      }}
      style={styles.hero}
    >
      <View style={styles.stage} pointerEvents="none">
        {a ? (
          <StreamTile
            key={a.key}
            ref={player}
            tileId={NATION_HERO_TILE_ID}
            source={a.src}
            radius={0}
            showLoader={false}
            onSettled={(ok) => hero.settle(a.key, ok)}
            onNeedsHeal={() => hero.needsHeal(a.key)}
          />
        ) : null}
        <TileLoader visible={!hero.playing} />
      </View>
      <View style={styles.top} pointerEvents="none">
        {meta.badge ? (
          <View style={[styles.badge, meta.badge.vod && styles.badgeVod]}>
            <Text numberOfLines={1} style={[styles.badgeText, meta.badge.vod && styles.badgeTextVod]}>
              {meta.badge.text}
            </Text>
          </View>
        ) : null}
        {meta.kind ? <Text style={styles.kind}>{meta.kind}</Text> : null}
      </View>
      {meta.caption ? (
        <LinearGradient pointerEvents="none" colors={['rgba(4,2,12,0)', 'rgba(4,2,12,0.95)']} style={styles.cap}>
          <Text numberOfLines={2} style={styles.caption}>
            {meta.caption}
          </Text>
        </LinearGradient>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  hero: { position: 'relative', width: '100%', aspectRatio: 16 / 10, overflow: 'hidden', backgroundColor: '#05020e' },
  stage: { ...StyleSheet.absoluteFillObject, backgroundColor: '#05020e', overflow: 'hidden' },
  top: { position: 'absolute', top: 12, left: 16, zIndex: 5, flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 14, backgroundColor: 'rgba(239,68,68,0.85)', flexShrink: 0 },
  badgeVod: { backgroundColor: 'rgba(201,168,76,0.85)' },
  badgeText: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.12), color: '#fff' },
  badgeTextVod: { color: '#04020c' },
  kind: { fontFamily: FONTS.mono, fontSize: 7.5, letterSpacing: em(7.5, 0.12), color: 'rgba(255,255,255,0.55)' },
  cap: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5, paddingTop: 30, paddingHorizontal: 16, paddingBottom: 12 },
  caption: { fontFamily: FONTS.serifItalic, fontSize: 17, lineHeight: 17 * 1.35, color: '#f4f0ff' },
});
