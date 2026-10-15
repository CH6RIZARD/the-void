// .au-pill — the audio drop player: gold play orb, 26-bar wave (tap to scrub), time.
//   .au-pill{gap:12px;padding:12px 14px;border-radius:30px;margin-bottom:12px;
//            background:linear-gradient(135deg,rgba(124,58,237,.18),rgba(13,8,32,.9) 65%);box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
//   .au-play{38x38;linear-gradient(135deg,#c9a84c,#8a6d2c);color:#04020c;box-shadow:0 0 18px rgba(201,168,76,.4)} icon 15
//   .au-wave{flex:1;gap:2.5px;height:30px}  .au-bar{3px;radius 2;#3b2a6a} .played/.head #c9a84c (+glow on head)
//   .au-time{Syne Mono 8 #6a58a0 .08em} em #3b2a6a
// Starting a pill claims the app's single audio slot (a live stream with sound goes quiet).
import React, { memo, useCallback, useRef } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { Post } from '../../../core';
import { Icon } from '../../../ui/icons';
import { VText } from '../../../ui/Text';
import { FONTS, em } from '../../../theme/palettes';
import { useCreamInk, useInk } from '../../../theme/ink';
import { useClaimAudio } from '../../live/AudioOwner';
import { auBars, auDuration, auFmt } from '../format';
import { auScrub, auToggle, restingTime, usePill, usePillTick } from '../audioStore';

/** useClaimAudio throws outside <AudioOwnerProvider>; a pill must still work there. */
function useSafeClaim() {
  try {
    return useClaimAudio();
  } catch {
    return null;
  }
}

export interface AudioPillProps {
  post: Post;
  /** Feed index: seeds the bar heights and the fallback duration (renderPost). The thread passes 0. */
  index: number;
  style?: StyleProp<ViewStyle>;
}

export const AudioPill = memo(function AudioPill({ post: p, index, style }: AudioPillProps) {
  const pill = usePill(p.id);
  const ink = useInk();
  const creamInk = useCreamInk();
  usePillTick();
  const claim = useSafeClaim();
  const width = useRef(1);
  const bars = useRef(auBars(index)).current;
  const fallbackDur = auDuration(p, index);
  const dur = pill && pill.dur ? pill.dur : fallbackDur;
  const t = pill ? pill.t : restingTime(p.id);
  const playing = !!(pill && pill.playing);
  const head = dur > 0 ? Math.floor((t / dur) * bars.length) : 0;
  const hasHead = !!pill || t > 0;

  const toggle = useCallback(() => {
    const id = 'au_' + p.id;
    auToggle(
      p.id,
      p._audio,
      fallbackDur,
      claim ? (stop) => claim.claimAudio({ id, stop }) : undefined,
      claim ? () => claim.releaseAudio(id) : undefined,
    );
  }, [p.id, p._audio, fallbackDur, claim]);

  const onWave = (e: any) => auScrub(p.id, e.nativeEvent.locationX / (width.current || 1), dur);

  return (
    <Pressable onPress={() => {}} style={[styles.pillWrap, style]}>
      <LinearGradient colors={[`rgba(${ink.vrgb},0.18)`, ink.glass]} locations={[0, 0.65]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.pill}>
        <Pressable onPress={toggle} style={({ pressed }) => [styles.play, pressed && { opacity: 0.72 }]} accessibilityLabel={playing ? 'Pause' : 'Play'} hitSlop={6}>
          <LinearGradient colors={['#c9a84c', '#8a6d2c']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.playFill}>
            <Icon name={playing ? 'pause' : 'play'} size={15} color="#04020c" />
          </LinearGradient>
        </Pressable>
        <Pressable style={styles.wave} onPress={onWave} onLayout={(e: LayoutChangeEvent) => (width.current = e.nativeEvent.layout.width)}>
          {bars.map((h, j) => {
            const played = hasHead && j < head;
            const isHead = hasHead && j === head;
            const height = playing && pill && pill.jitter[j] != null ? pill.jitter[j] : h;
            return (
              <View
                key={j}
                pointerEvents="none"
                style={[styles.bar, { height }, (played || isHead) && { backgroundColor: '#c9a84c' }, isHead && { boxShadow: '0px 0px 8px rgba(201,168,76,0.6)' }]}
              />
            );
          })}
        </Pressable>
        <VText style={[styles.time, { color: creamInk.dim }]}>
          {auFmt(t)}
          <VText style={[styles.time, { color: creamInk.dim === '#6a58a0' ? '#3b2a6a' : creamInk.faint }]}>{' / ' + auFmt(dur)}</VText>
        </VText>
      </LinearGradient>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pillWrap: { marginBottom: 12, borderRadius: 30 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 30, boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.08)' },
  play: { width: 38, height: 38, borderRadius: 19, boxShadow: '0px 0px 18px rgba(201,168,76,0.4)' },
  playFill: { flex: 1, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  wave: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2.5, height: 30 },
  bar: { width: 3, borderRadius: 2, backgroundColor: '#3b2a6a' },
  time: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.08), color: '#6a58a0', flexShrink: 0 },
});
