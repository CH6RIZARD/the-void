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
import { MAX_MOUNTED_WEBVIEWS, playerBudgetNow } from '../live/constants';
import type { LiveChannelRef } from './searchModel';

type Phase = 'connecting' | 'playing' | 'offline' | 'waiting';

// ─── NINE LIVE STREAMS AT ONCE IS NOT A SEARCH SCREEN ────────────────────
// buildSearch emits one feature tile, one row, and another row after every fourth
// post: nine live slots on the default view. Each one started its own cascade the
// instant the tab took focus, so opening search meant nine YouTube WebViews and
// nine connection attempts in the same breath - while the globe wall's own tiles
// were still alive, because no tab ever unmounts. That is the ratchet behind
// "open search, five seconds of nothing".
//
// The wall solved this years of code ago with a budget. Search gets the same:
// a slot has to be admitted before it may connect, and only so many are admitted
// at once. The rest sit on the loader and take their turn as slots settle, which
// is what the loader was always for.
//
// Admission is held while a slot is playing, not just while it is connecting -
// a playing YouTube tile is a live WebView, and that is the resource being
// rationed. Slots release on blur and on unmount.
const MAX_LIVE_SEARCH = Math.max(2, Math.min(3, MAX_MOUNTED_WEBVIEWS + playerBudgetNow() - 3));
/** Slots currently allowed to hold a player, and slots waiting for a turn. */
const admitted = new Set<object>();
const waiting: { token: object; go: () => void }[] = [];

function pump(): void {
  while (admitted.size < MAX_LIVE_SEARCH && waiting.length) {
    const next = waiting.shift();
    if (!next) break;
    admitted.add(next.token);
    next.go();
  }
}

/** Ask for a turn. Calls `go` now if there is room, or later when there is. */
function admit(token: object, go: () => void): void {
  if (admitted.has(token)) return;
  if (admitted.size < MAX_LIVE_SEARCH) {
    admitted.add(token);
    go();
    return;
  }
  if (!waiting.some((w) => w.token === token)) waiting.push({ token, go });
}

/** Give the turn back, and hand it straight to whoever is next. */
function unadmit(token: object): void {
  admitted.delete(token);
  const i = waiting.findIndex((w) => w.token === token);
  if (i >= 0) waiting.splice(i, 1);
  pump();
}

const gradient = (g: string): any => ({ experimental_backgroundImage: g });

function useLiveSlot(ch: LiveChannelRef, active: boolean) {
  const [phase, setPhase] = useState<Phase>('waiting');
  const player = useRef<StreamTileHandle>(null);
  // One identity per slot, for the admission set. A ref, so it survives renders.
  const token = useRef<object>({});
  const onResult = useCallback((r: CascadeResult) => {
    setPhase(r.ok ? 'playing' : 'offline');
    // A slot that found nothing is holding a turn it cannot use. Hand it on.
    if (!r.ok) unadmit(token.current);
  }, []);
  const cascade = useStreamCascade(onResult);
  useEffect(() => {
    const me = token.current;
    if (!active) {
      cascade.cancel();
      unadmit(me);
      setPhase('waiting');
      return;
    }
    setPhase('waiting');
    admit(me, () => {
      setPhase('connecting');
      cascade.start([{ type: 'youtube', id: ch.id, label: 'LIVE' } as StreamSource, ...((GLOBAL_POOL as unknown as StreamSource[]) || [])]);
    });
    return () => {
      cascade.cancel();
      unadmit(me);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch.id, active]);
  // A playing HLS tile that went to colour bars / slate mid-stream (StreamTile frame
  // check) is already refused by markBadStream: re-walk the chain so the slot refills.
  // Healing needs a turn like anything else; it already holds one if it is playing.
  const heal = useCallback(() => {
    setPhase('waiting');
    admit(token.current, () => {
      setPhase('connecting');
      cascade.start([{ type: 'youtube', id: ch.id, label: 'LIVE' } as StreamSource, ...((GLOBAL_POOL as unknown as StreamSource[]) || [])]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch.id]);
  // WHAT IS THIS TILE ACTUALLY PLAYING?
  // The cascade starts on the channel's own stream and, if that fails, walks the
  // global pool until something works. The tile went on showing the channel's
  // name either way - so a slot labelled AL JAZEERA could be playing a pool
  // stream that has nothing to do with Al Jazeera, and two differently-named
  // tiles could be showing the same broadcast from two different feeds. The name
  // was a claim the tile had no basis for.
  //
  // The first source in the list is the channel itself; anything after it is a
  // substitute, and says so. The label follows the picture.
  const a = cascade.attempt;
  const own = !!a && a.src && (a.src as { id?: string }).id === ch.id;
  const name = !a || own ? ch.n : (a.label && a.label !== 'LIVE' ? a.label : 'LIVE FEED').toUpperCase();
  return { phase, player, cascade, heal, name };
}

function SlotBody({ tileId, radius, slot }: { tileId: string; radius: number; slot: ReturnType<typeof useLiveSlot> }) {
  const a = slot.cascade.attempt;
  return (
    <>
      {a && slot.phase !== 'waiting' ? (
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
          {slot.name}
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
          {slot.name}
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
