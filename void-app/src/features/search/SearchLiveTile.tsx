// Search LIVE-NOW tiles — liveFeatSlot / liveTileSlot / liveRow + hydrateLiveTiles:
//   connectTile(el, [{type:'youtube', id:<channel>, label:'LIVE'}, ...GLOBAL_POOL])
// with data-nolabel (no stream label strip on connect). Sequential cascade through the
// shared live engine (useStreamCascade + StreamTile); tap a PLAYING tile for sound.
//
// .search-live-feat{aspect-ratio:16/9;background:#000;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.45);margin:0 14px}
// .search-live-feat-overlay{inset:0;background:linear-gradient(to top,rgba(4,2,12,.88) 0%,transparent 55%)}
// .search-live-feat-info{bottom:12px;left:14px;right:14px}
// .search-live-badge2{inline-flex;gap:5px;background:rgba(239,68,68,.9);padding:2px 8px;border-radius:3px;
//   font:'Syne Mono' 7px;letter-spacing:.15em;color:#fff;margin-bottom:5px}
// .search-live-feat-name{font-size:15px;font-weight:800;color:var(--white)}
// .search-live-row{grid 1fr 1fr;gap:8px;padding:8px 14px 0}
// .search-live-tile{aspect-ratio:16/9;background:#000;border-radius:14px;box-shadow:0 6px 18px rgba(0,0,0,.4)}
// .search-live-tile-lbl{bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.85));
//   padding:3px 7px 4px;font:'Syne Mono' 7px;color:var(--gold);letter-spacing:.08em}
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GLOBAL_POOL } from '../../core';
import { StreamTile, type StreamTileHandle } from '../live/StreamTile';
import { LiveDot, TileLoader } from '../live/TileChrome';
import { useStreamCascade, type CascadeResult } from '../live/useStreamCascade';
import type { StreamSource } from '../live/core';
import { useTheme } from '../../theme/tokens';
import { FONTS, em } from '../../theme/palettes';
import type { LiveChannelRef } from './searchModel';

type Phase = 'connecting' | 'playing' | 'offline';

const gradient = (g: string): any => ({ experimental_backgroundImage: g });

function useLiveSlot(ch: LiveChannelRef, active: boolean) {
  const [phase, setPhase] = useState<Phase>('connecting');
  const player = useRef<StreamTileHandle>(null);
  const onResult = useCallback((r: CascadeResult) => setPhase(r.ok ? 'playing' : 'offline'), []);
  const cascade = useStreamCascade(onResult);
  useEffect(() => {
    if (!active) {
      cascade.cancel();
      setPhase('connecting');
      return;
    }
    setPhase('connecting');
    cascade.start([{ type: 'youtube', id: ch.id, label: 'LIVE' } as StreamSource, ...((GLOBAL_POOL as unknown as StreamSource[]) || [])]);
    return () => cascade.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch.id, active]);
  // A playing HLS tile that went to colour bars / slate mid-stream (StreamTile frame
  // check) is already refused by markBadStream: re-walk the chain so the slot refills.
  const heal = useCallback(() => {
    setPhase('connecting');
    cascade.start([{ type: 'youtube', id: ch.id, label: 'LIVE' } as StreamSource, ...((GLOBAL_POOL as unknown as StreamSource[]) || [])]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch.id]);
  return { phase, player, cascade, heal };
}

function SlotBody({ tileId, radius, slot }: { tileId: string; radius: number; slot: ReturnType<typeof useLiveSlot> }) {
  const a = slot.cascade.attempt;
  return (
    <>
      {a ? (
        <StreamTile
          key={a.key}
          ref={slot.player}
          tileId={tileId}
          source={a.src}
          radius={radius}
          showLoader={false}
          onSettled={(ok) => slot.cascade.settle(a.key, ok)}
          onNeedsHeal={slot.heal}
        />
      ) : null}
      {/* connectTile: sparkleTile('● CONNECTING') for every attempt; '● NO SIGNAL' when exhausted. */}
      <TileLoader label={slot.phase === 'offline' ? '● NO SIGNAL' : '● CONNECTING'} visible={slot.phase !== 'playing'} />
    </>
  );
}

export const SearchLiveFeat = memo(function SearchLiveFeat({ ch, active, slotKey }: { ch: LiveChannelRef; active: boolean; slotKey: string }) {
  const { colors } = useTheme();
  const slot = useLiveSlot(ch, active);
  return (
    <Pressable onPress={() => slot.player.current?.tap()} style={styles.feat}>
      <SlotBody tileId={'search:' + slotKey} radius={18} slot={slot} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.z4, gradient('linear-gradient(to top, rgba(4,2,12,0.88) 0%, transparent 55%)')]} />
      <View pointerEvents="none" style={styles.featInfo}>
        <View style={styles.badge}>
          <LiveDot />
          <Text allowFontScaling={false} style={styles.badgeText}>
            LIVE
          </Text>
        </View>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.featName, { color: colors.white }]}>
          {ch.n}
        </Text>
      </View>
    </Pressable>
  );
});

export const SearchLiveTile = memo(function SearchLiveTile({ ch, active, slotKey }: { ch: LiveChannelRef; active: boolean; slotKey: string }) {
  const { colors } = useTheme();
  const slot = useLiveSlot(ch, active);
  return (
    <Pressable onPress={() => slot.player.current?.tap()} style={styles.tile}>
      <SlotBody tileId={'search:' + slotKey} radius={14} slot={slot} />
      <View pointerEvents="none" style={[styles.tileLbl, gradient('linear-gradient(to bottom, transparent, rgba(0,0,0,0.85))')]}>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.tileLblText, { color: colors.gold }]}>
          {ch.n}
        </Text>
      </View>
    </Pressable>
  );
});

export const SearchLiveRow = memo(function SearchLiveRow({ chs, active, rowKey }: { chs: LiveChannelRef[]; active: boolean; rowKey: string }) {
  return (
    <View style={styles.row}>
      {chs.map((ch, i) => (
        <View key={ch.id + ':' + i} style={styles.cell}>
          <SearchLiveTile ch={ch} active={active} slotKey={rowKey + ':' + i} />
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  feat: {
    position: 'relative',
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderRadius: 18,
    boxShadow: '0px 10px 30px rgba(0,0,0,0.45)',
    marginHorizontal: 14,
  } as any,
  z4: { zIndex: 4 },
  featInfo: { position: 'absolute', bottom: 12, left: 14, right: 14, zIndex: 5 },
  badge: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(239,68,68,0.9)',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 3,
    marginBottom: 5,
  },
  badgeText: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.15), color: '#fff' },
  featName: { fontFamily: FONTS.sansExtraBold, fontSize: 15 },
  row: { flexDirection: 'row', gap: 8, paddingTop: 8, paddingHorizontal: 14 },
  cell: { flex: 1 },
  tile: {
    position: 'relative',
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderRadius: 14,
    boxShadow: '0px 6px 18px rgba(0,0,0,0.4)',
  } as any,
  tileLbl: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingTop: 3, paddingHorizontal: 7, paddingBottom: 4, zIndex: 4 },
  tileLblText: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.08) },
});
