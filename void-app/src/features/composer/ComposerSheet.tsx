// COMPOSER v2 (patch3 §3) — #composer-overlay / .composer-sheet, CSS 1:1 from
// void2-final.html 1015-1059 (+ .au-* 288-296). Logic from openComposer /
// setComposerType / composerFilesPicked / start|stopComposerRecording / submitComposerPost.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { VideoView, useVideoPlayer } from 'expo-video';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useTheme } from '../../theme';
import { FONTS, em } from '../../theme/palettes';
import { Sheet } from '../../ui/Sheet';
import { Pill } from '../../ui/Pill';
import { VText } from '../../ui/Text';
import { Icon } from '../../ui/icons/Icon';
import { voidToast } from '../../ui/Toast';
import { ROUTES } from '../../nav/routes';
import { useClaimAudio } from '../live/AudioOwner';
import { useIdentity } from '../auth/coreBridge';
import { stripHandle } from '../auth/handles';
import { useTermsGate } from '../auth/TermsSheet';
import { checkDraft, hasDraftContent, runDrop } from './drop';
import { getDraft, setDraft, useDraft, type ComposerTab, type DraftAudio } from './dropStore';
import { mimeFromUri, pickMedia, type PickedMedia } from './media';

const BARS = 26;
const REC_PRESET = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

function auFmt(s: number) {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/** AudioOwnerProvider may not be mounted yet (root layout stub): degrade to no-op. */
function useSafeClaimAudio() {
  try {
    return useClaimAudio();
  } catch {
    return null;
  }
}

function VideoThumb({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} pointerEvents="none" />;
}

function Thumb({ m, onRemove }: { m: PickedMedia; onRemove: () => void }) {
  const { colors, isLight } = useTheme();
  return (
    <View style={[st.thumb, { backgroundColor: isLight ? '#e2dbc9' : colors.card2 }]}>
      {m.kind === 'video' ? <VideoThumb uri={m.uri} /> : <Image source={{ uri: m.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />}
      <Pressable accessibilityLabel="Remove" onPress={onRemove} hitSlop={6} style={st.thumbX}>
        <Icon name="x" size={10} color={colors.white} />
      </Pressable>
    </View>
  );
}

/** The B2 player pill previewing the finished take (.au-pill). */
function TakePill({ take, onRedo }: { take: DraftAudio; onRedo: () => void }) {
  const { colors } = useTheme();
  const player = useAudioPlayer(take.uri);
  const status = useAudioPlayerStatus(player);
  const owner = useSafeClaimAudio();
  const bars = useRef(Array.from({ length: BARS }, (_, j) => 6 + Math.round((Math.sin(j * 0.9) * 0.5 + 0.5) * 20))).current;
  const dur = take.dur;
  const t = status.currentTime || 0;
  const played = dur ? Math.floor((t / dur) * BARS) : 0;

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    owner?.claimAudio({ id: 'composer-take', stop: () => player.pause() });
    if (status.didJustFinish || (status.duration && t >= status.duration - 0.05)) player.seekTo(0);
    player.play();
  };
  const scrub = (x: number, w: number) => {
    if (!w || !dur) return;
    player.seekTo(Math.max(0, Math.min(1, x / w)) * dur);
  };
  const [waveW, setWaveW] = useState(0);

  return (
    <View>
      <View style={st.auPill}>
        <LinearGradient colors={['rgba(124,58,237,0.18)', 'rgba(13,8,32,0.9)']} locations={[0, 0.65]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 30 }]} />
        <Pressable accessibilityLabel={status.playing ? 'Pause' : 'Play'} onPress={toggle} style={st.auPlay}>
          <LinearGradient colors={['#c9a84c', '#8a6d2c']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 19 }]} />
          <Icon name={status.playing ? 'pause' : 'play'} size={15} color="#04020c" />
        </Pressable>
        <Pressable style={st.wave} onLayout={(e) => setWaveW(e.nativeEvent.layout.width)} onPress={(e) => scrub(e.nativeEvent.locationX, waveW)}>
          {bars.map((h, j) => (
            <View key={j} style={[st.bar, { height: h, backgroundColor: j < played ? '#c9a84c' : '#3b2a6a' }]} />
          ))}
        </Pressable>
        <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.08), color: '#6a58a0' }}>
          {auFmt(t)}
          <VText style={{ fontFamily: FONTS.mono, fontSize: 8, color: '#3b2a6a' }}>{' / ' + auFmt(dur)}</VText>
        </VText>
      </View>
      <Pressable onPress={onRedo} style={{ marginTop: 0, alignSelf: 'flex-start' }}>
        <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.18), color: colors.navDim }}>RE-RECORD</VText>
      </Pressable>
    </View>
  );
}

export interface ComposerSheetProps {
  /** Called after the close animation. Default: router.back() (or /void). */
  onClosed?: () => void;
}

export default function ComposerSheet({ onClosed }: ComposerSheetProps) {
  const { colors } = useTheme();
  const { user } = useIdentity();
  const d = useDraft();
  const [open, setOpen] = useState(true);
  const [denied, setDenied] = useState('');
  const [levels, setLevels] = useState<number[]>([]);
  const inputRef = useRef<TextInput>(null);
  const recorder = useAudioRecorder(REC_PRESET);
  const rec = useAudioRecorderState(recorder, 120);
  const recording = useRef(false);
  const { gate, termsSheet } = useTermsGate();

  const count = 280 - d.text.length;

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  // Live level meter: dBFS -> 0..1, newest bar on the right (web _lvl window).
  useEffect(() => {
    if (!rec.isRecording) return;
    const db = typeof rec.metering === 'number' ? rec.metering : -160;
    const v = rec.metering == null ? Math.random() * 0.7 : Math.max(0, Math.min(1, (db + 60) / 60));
    setLevels((l) => {
      const n = [...l, v];
      return n.length > BARS ? n.slice(n.length - BARS) : n;
    });
  }, [rec.durationMillis, rec.isRecording, rec.metering]);

  /** stopComposerRecording(silent): silent abandons a LIVE take; a finished take survives. */
  const stopRecording = useCallback(
    async (silent: boolean) => {
      if (!recording.current) return;
      recording.current = false;
      const ms = rec.durationMillis || 0;
      try {
        await recorder.stop();
      } catch {}
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      if (silent) {
        setDraft({ audio: null });
        return;
      }
      const uri = recorder.uri;
      if (uri) setDraft({ audio: { uri, mime: mimeFromUri(uri, 'audio/mp4'), dur: Math.max(1, Math.round(ms / 1000)) } });
    },
    [recorder, rec.durationMillis],
  );

  const micDenied = (msg: string) => {
    setDenied(msg);
    setDraft({ tab: 'text' });
  };

  const startRecording = async () => {
    if (recording.current) return;
    setDenied('');
    setDraft({ audio: null });
    try {
      const p = await requestRecordingPermissionsAsync();
      if (!p.granted) return micDenied('MIC ACCESS DENIED');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      setLevels([]);
      recorder.record();
      recording.current = true;
    } catch {
      micDenied('MIC ACCESS DENIED');
    }
  };

  // Closing releases the mic (web closeComposer).
  useEffect(
    () => () => {
      if (recording.current) {
        recording.current = false;
        recorder.stop().catch(() => {});
        setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
        setDraft({ audio: null });
      }
    },
    [recorder],
  );

  const setTab = async (tab: ComposerTab) => {
    setDraft({ tab });
    if (tab === 'media') {
      try {
        const picked = await pickMedia({ multiple: true });
        if (picked.length) setDraft({ media: [...getDraft().media, ...picked] });
      } catch (e: any) {
        voidToast(String((e && e.message) || 'GALLERY UNAVAILABLE'));
      }
    } else if (tab === 'audio') {
      startRecording();
    } else {
      stopRecording(true);
    }
  };

  const close = () => {
    stopRecording(true);
    setOpen(false);
    setTimeout(() => {
      if (onClosed) onClosed();
      else if (router.canGoBack()) router.back();
      else router.replace(ROUTES.void as any);
    }, 230);
  };

  const submit = async () => {
    if (!hasDraftContent()) {
      voidToast('NOTHING TO DROP');
      return;
    }
    if (recording.current) await stopRecording(false);
    gate(async () => {
      const err = await checkDraft();
      if (err) {
        voidToast(err);
        return;
      }
      runDrop();
      close();
    });
  };

  const handle = '@' + stripHandle(user.handle || 'void');
  const liveBars = Array.from({ length: BARS }, (_, k) => {
    const off = BARS - levels.length;
    return 4 + (k < off ? 0 : levels[k - off]) * 22;
  });

  return (
    <>
      <Sheet visible={open} onClose={close}>
        <View style={st.hdr}>
          <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.28), color: colors.navDim }}>NEW DROP</VText>
          <VText numberOfLines={1} style={{ flexShrink: 1, fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.14), color: colors.gold }}>{handle}</VText>
          <Pressable accessibilityLabel="Close" onPress={close} hitSlop={8} style={st.x}>
            <Icon name="x" size={15} color={colors.dim} />
          </Pressable>
        </View>

        <TextInput
          ref={inputRef}
          value={d.text}
          onChangeText={(text) => setDraft({ text })}
          placeholder="what's your signal"
          placeholderTextColor={colors.navDim}
          selectionColor={colors.gold}
          cursorColor={colors.gold}
          multiline
          scrollEnabled={false}
          style={[st.ta, { color: colors.white }]}
        />
        <View style={st.countRow}>
          <VText style={{ fontFamily: FONTS.mono, fontSize: 7.5, letterSpacing: em(7.5, 0.2), color: count < 0 ? colors.red : colors.navDim }}>{count}</VText>
          <LinearGradient colors={['rgba(201,168,76,0.3)', 'rgba(201,168,76,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={st.countLine} />
        </View>

        <View style={st.tabs}>
          {(['text', 'media', 'audio'] as ComposerTab[]).map((t) => {
            const on = d.tab === t;
            return (
              <Pressable key={t} onPress={() => setTab(t)} style={[st.tab, { borderBottomColor: on ? colors.gold : 'transparent' }]}>
                <VText style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: em(8.5, 0.18), color: on ? colors.gold : colors.navDim }}>{t.toUpperCase()}</VText>
              </Pressable>
            );
          })}
        </View>

        {d.media.length ? (
          <View style={st.strip}>
            {d.media.map((m, i) => (
              <Thumb key={m.uri + i} m={m} onRemove={() => setDraft({ media: d.media.filter((_, k) => k !== i) })} />
            ))}
          </View>
        ) : null}

        {rec.isRecording || denied || d.audio ? (
          <View style={st.crec}>
            {rec.isRecording ? (
              <View style={st.live}>
                <LinearGradient colors={['rgba(239,68,68,0.16)', 'rgba(13,8,32,0.9)']} locations={[0, 0.65]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 30 }]} />
                <Pressable accessibilityLabel="Stop recording" onPress={() => stopRecording(false)} style={[st.stop, { backgroundColor: colors.red }]}>
                  <View style={st.stopSq} />
                </Pressable>
                <View style={st.wave}>
                  {liveBars.map((h, k) => (
                    <View key={k} style={[st.bar, { height: h, backgroundColor: '#c9a84c' }]} />
                  ))}
                </View>
                <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.08), color: '#6a58a0' }}>{auFmt((rec.durationMillis || 0) / 1000)}</VText>
              </View>
            ) : d.audio ? (
              <TakePill take={d.audio} onRedo={startRecording} />
            ) : (
              <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.2), color: colors.navDim, paddingVertical: 6, paddingHorizontal: 2 }}>{denied}</VText>
            )}
          </View>
        ) : null}

        <Pill variant="gold" label="DROP" onPress={submit} style={{ marginTop: 18 }} />
      </Sheet>
      {termsSheet}
    </>
  );
}

const st = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 18, paddingHorizontal: 2, paddingBottom: 6 },
  x: { marginLeft: 'auto', width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  ta: { fontFamily: FONTS.serifItalic, fontSize: 23, lineHeight: 23 * 1.42, paddingTop: 14, paddingHorizontal: 2, paddingBottom: 4, minHeight: 96, textAlignVertical: 'top' },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10, paddingBottom: 4 },
  countLine: { flex: 1, height: 1 },
  tabs: { flexDirection: 'row', gap: 22, paddingTop: 16, paddingBottom: 4 },
  tab: { paddingBottom: 7, borderBottomWidth: 1 },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 14 },
  thumb: { width: 62, height: 62, borderRadius: 12, overflow: 'hidden' },
  thumbX: { position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(4,2,12,0.8)', alignItems: 'center', justifyContent: 'center' },
  crec: { paddingTop: 14 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 30 },
  stop: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  stopSq: { width: 11, height: 11, borderRadius: 2, backgroundColor: '#fff' },
  wave: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2.5, height: 30 },
  bar: { width: 3, borderRadius: 2 },
  auPill: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 30, marginBottom: 12, boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.06)' },
  auPlay: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
