// Search LIVE-NOW tiles — liveFeatSlot / liveTileSlot / liveRow + hydrateLiveTiles:
//   connectTile(el, <chain from searchLivePool(): HLS only>, src => caption = country · channel)
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
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { StreamTile, type StreamTileHandle } from '../live/StreamTile';
import { LiveDot, TileLoader } from '../live/TileChrome';
import { useStreamCascade, type CascadeResult } from '../live/useStreamCascade';
import { hlsSpread } from '../../core';
import type { StreamSource } from '../live/core';
import { useTheme } from '../../theme/tokens';
import { FONTS, em } from '../../theme/palettes';
import { MAX_MOUNTED_WEBVIEWS, playerBudgetNow } from '../live/constants';
import type { LiveChannelRef } from './searchModel';

type Phase = 'connecting' | 'playing' | 'offline' | 'waiting';

// ─── REAL HLS, NOTHING ELSE ──────────────────────────────────────────────
// The web's searchLivePool, HLS only like the wall: every probed stream, shuffled
// one by one, the caption following whatever connected.
//
// Native led each slot with its channel's YouTube embed and kept the other 38
// channels' embeds behind the HLS. 29 of those 39 are refused in 0 ms (no confirmed
// live id), and of the 10 that mount, four are dead or mislabelled - while on the
// phone even a live, embeddable TRT World sat on its title and sparkle until its
// 7 s budget ran out. GLOBAL_POOL stays off the end too: it is two TEST STREAMS.
// A tile with nothing real to show says NO SIGNAL.
//
// What a slot last played leads its next walk, so a tile that scrolls back into
// view, or a tab that comes back, reconnects to the same picture in one attempt
// (the wall's lastGood).
const lastGood = new Map<string, StreamSource>();
function sourcesFor(slotKey: string): StreamSource[] {
  const spread = hlsSpread(14) as unknown as StreamSource[];
  const last = lastGood.get(slotKey);
  return last ? [last, ...spread.filter((s) => s.url !== last.url)] : spread;
}

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
// a playing tile holds a hardware decoder, and that is the resource being
// rationed. Slots release on blur, on unmount, and off screen: SearchScreen marks
// a slot active only while it is on screen, so the turns go to the tiles in view,
// not to the first three that mounted (which left six of nine on their titles).
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
  // Already holding a turn means it is healing: restart it on that turn. Returning
  // here left a healed tile torn down on its loader for good, still holding the turn.
  if (admitted.has(token)) {
    go();
    return;
  }
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

function useLiveSlot(slotKey: string, active: boolean) {
  const [phase, setPhase] = useState<Phase>('waiting');
  const player = useRef<StreamTileHandle>(null);
  // One identity per slot, for the admission set. A ref, so it survives renders.
  const token = useRef<object>({});
  const onResult = useCallback(
    (r: CascadeResult) => {
      setPhase(r.ok ? 'playing' : 'offline');
      if (r.ok && r.src) lastGood.set(slotKey, r.src);
      // A slot that found nothing is holding a turn it cannot use. Hand it on.
      if (!r.ok) unadmit(token.current);
    },
    [slotKey],
  );
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
      cascade.start(sourcesFor(slotKey));
    });
    return () => {
      cascade.cancel();
      unadmit(me);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey, active]);
  // A playing HLS tile that went to colour bars / slate mid-stream (StreamTile frame
  // check) is already refused by markBadStream: re-walk the chain so the slot refills.
  // Healing needs a turn like anything else; it already holds one if it is playing.
  const heal = useCallback(() => {
    lastGood.delete(slotKey); // it just died: the new walk must not lead with it
    setPhase('waiting');
    admit(token.current, () => {
      setPhase('connecting');
      cascade.start(sourcesFor(slotKey));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey]);
  // WHAT IS THIS TILE ACTUALLY PLAYING? The caption follows the source - its
  // country, then its channel - exactly as the web's hydrateLiveTiles writes it.
  // Nothing before there is a source: a tile still waiting for its turn does not
  // know yet what it will show.
  const s = cascade.attempt?.src as { n?: string; label?: string } | undefined;
  const name = s ? (s.n || '') + (s.label ? (s.n ? ' \u00b7 ' : '') + s.label : '') : '';
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
      {/* NO LABEL WHILE IT WORKS.
          It was never in the design, and it lied: the loader was tied to
          `phase !== 'playing'`, so a stream that was already showing a picture
          still had a label written across it whenever the cascade had not
          settled. A tile that is working should look like it is working.
          Only the exhausted case says anything now - that one is real news. */}
      {/* Taking the CONNECTING text off was right; taking the LOADER off with it
          was not. visible was tied to 'offline', so a tile that was working on a
          source showed nothing at all - no picture yet and no sparkle either,
          which is a dead black square. The sparkle IS the loading state; the
          label is only for the end of the road. */}
      <TileLoader
        label={slot.phase === 'offline' ? '● NO SIGNAL' : undefined}
        visible={slot.phase !== 'playing'}
        animate={slot.phase !== 'offline'}
      />
    </>
  );
}

export const SearchLiveFeat = memo(function SearchLiveFeat({ active, slotKey, onLayout }: { active: boolean; slotKey: string; onLayout?: (e: LayoutChangeEvent) => void }) {
  const { colors } = useTheme();
  const slot = useLiveSlot(slotKey, active);
  return (
    <Pressable onPress={() => slot.player.current?.tap()} onLayout={onLayout} style={styles.feat}>
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

export const SearchLiveTile = memo(function SearchLiveTile({ active, slotKey }: { active: boolean; slotKey: string }) {
  const { colors } = useTheme();
  const slot = useLiveSlot(slotKey, active);
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

export const SearchLiveRow = memo(function SearchLiveRow({ chs, active, rowKey, onLayout }: { chs: LiveChannelRef[]; active: boolean; rowKey: string; onLayout?: (e: LayoutChangeEvent) => void }) {
  return (
    <View style={styles.row} onLayout={onLayout}>
      {chs.map((ch, i) => (
        <View key={ch.id + ':' + i} style={styles.cell}>
          <SearchLiveTile active={active} slotKey={rowKey + ':' + i} />
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
