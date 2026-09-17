// vwAudioPill(p,i) + auToggle/auPaint/auStop for a reel card of style 'audio'.
//   dur = 97 + (i*53) % 140;  26 bars, height 6 + round((sin(j*.9+i)*.5+.5)*20)
// .vw-audio-wrap{left:18px;right:18px;top:50%;translateY(-50%);z-index:2}
// .au-pill{gap:12px;padding:12px 14px;border-radius:30px;margin-bottom:12px;
//   background:linear-gradient(135deg,rgba(124,58,237,.18),rgba(13,8,32,.9) 65%);box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
// .au-play{38px circle;background:linear-gradient(135deg,#c9a84c,#8a6d2c);color:#04020c;box-shadow:0 0 18px rgba(201,168,76,.4)} .vi 15px
// .au-wave{flex:1;gap:2.5px;height:30px}  .au-bar{3px wide;radius 2;#3b2a6a}  .played{#c9a84c}  .head{#c9a84c;glow 0 0 8px rgba(201,168,76,.6)}
// .au-time{'Syne Mono' 8px;#6a58a0;.08em}  em{#3b2a6a}
//
// The reel pill carries no data-src on the web, so playback is the 100ms progress
// ticker (the web's speechSynthesis read-aloud has no native module here; see README).
// Starting it takes the single audio slot (auToggle → releaseStreamAudio).
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../ui/icons';
import { FONTS, em } from '../../theme/palettes';
import { useSafeClaimAudio } from './useSafeClaimAudio';

const auFmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const ReelAudioPill = memo(function ReelAudioPill({ index, audioId, stopSignal }: { index: number; audioId: string; stopSignal: boolean }) {
  const dur = 97 + ((index * 53) % 140);
  const base = useMemo(() => Array.from({ length: 26 }, (_, j) => 6 + Math.round((Math.sin(j * 0.9 + index) * 0.5 + 0.5) * 20)), [index]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [heights, setHeights] = useState(base);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioHook = useSafeClaimAudio();
  const audioRef = useRef(audioHook);
  audioRef.current = audioHook;
  const audio = useMemo(
    () => ({
      claimAudio: (o: { id: string; stop(): void }) => audioRef.current?.claimAudio(o),
      releaseAudio: (id: string) => audioRef.current?.releaseAudio(id),
    }),
    [],
  );

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (timer.current) {
      stop();
      audio?.releaseAudio(audioId);
      return;
    }
    audio?.claimAudio({ id: audioId, stop });
    setPlaying(true);
    timer.current = setInterval(() => {
      setT((prev) => {
        let n = prev + 0.1;
        if (n >= dur) {
          n = 0;
          stop();
        }
        const head = Math.floor((n / dur) * 26);
        setHeights((h) => h.map((v, j) => (Math.abs(j - head) < 4 ? 8 + Math.random() * 20 : v)));
        return n;
      });
    }, 100);
  }, [audio, audioId, dur, stop]);

  // stopGlobeReels / closeReel → auStop
  useEffect(() => {
    if (stopSignal && timer.current) {
      stop();
      audio?.releaseAudio(audioId);
    }
  }, [stopSignal, stop, audio, audioId]);
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const head = Math.floor((t / dur) * 26);
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.pill}>
        <Pressable onPress={toggle} style={({ pressed }) => [styles.play, { opacity: pressed ? 0.72 : 1 }]} hitSlop={9}>
          <Icon name={playing ? 'pause' : 'play'} size={15} color="#04020c" />
        </Pressable>
        <View style={styles.wave}>
          {heights.map((h, j) => (
            <View
              key={j}
              style={[
                styles.bar,
                { height: h },
                j < head && styles.played,
                j === head && (t > 0 || playing) && styles.head,
              ]}
            />
          ))}
        </View>
        <Text allowFontScaling={false} style={styles.time}>
          {auFmt(t)}
          <Text style={styles.timeEm}> / {auFmt(dur)}</Text>
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 18, right: 18, top: 0, bottom: 0, justifyContent: 'center', zIndex: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 30,
    marginBottom: 12,
    experimental_backgroundImage: 'linear-gradient(135deg, rgba(124,58,237,0.18), rgba(13,8,32,0.9) 65%)',
    boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.08)',
  } as any,
  play: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    experimental_backgroundImage: 'linear-gradient(135deg, #c9a84c, #8a6d2c)',
    backgroundColor: '#aa8a3c',
    boxShadow: '0px 0px 18px rgba(201,168,76,0.4)',
  } as any,
  wave: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2.5, height: 30 },
  bar: { width: 3, borderRadius: 2, backgroundColor: '#3b2a6a' },
  played: { backgroundColor: '#c9a84c' },
  head: { backgroundColor: '#c9a84c', boxShadow: '0px 0px 8px rgba(201,168,76,0.6)' } as any,
  time: { fontFamily: FONTS.mono, fontSize: 8, color: '#6a58a0', letterSpacing: em(8, 0.08), flexShrink: 0 },
  timeEm: { color: '#3b2a6a' },
});
