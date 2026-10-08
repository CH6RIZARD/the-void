// The call: full screen, the other person's video edge to edge (or their figure,
// large, for a voice call), mine in a corner, controls along the bottom.
//
// callStore is the source of truth for WHO and WHAT PHASE; LiveKit is the pipe.
// The room is `dm_<conversation_id>` and the token comes from the livekit-token
// Edge Function, which checks membership server-side. The screen connects as soon
// as the token and the audio session are ready - the caller sits in the room
// alone while it rings; the callee joins on accept - and leaves on `ended`.
import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import InCallManager from 'react-native-incall-manager';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AndroidAudioTypePresets,
  AudioSession,
  LiveKitRoom,
  VideoTrack,
  isTrackReference,
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
} from '@livekit/react-native';
import { ConnectionState, Track, type LocalVideoTrack } from 'livekit-client';
import { FONTS, em } from '../../theme/palettes';
import { VText } from '../../ui/Text';
import { PersonPfp } from '../../ui/Pfp';
import { voidToast } from '../../ui/Toast';
import { ROUTES } from '../../nav/routes';
import { fetchCallToken, hangUp, type CallToken } from './callsApi';
import { callElapsed, callLive, callReset, useCallStore, type CallEndReason } from './callStore';
import { fmtDuration, type CallKind } from './callText';
import { CallButton } from './IncomingCallSheet';

const BG = '#05020e';
/** How long "CALL ENDED · 4:12" stays before the screen closes itself. */
const LINGER_MS = 1400;
/**
 * How long a live call sits with nobody else in the room before we end it: the
 * other phone backgrounded (its socket dies in seconds without a VoIP mode) and
 * LiveKit's own reconnect window, or an accept whose caller had already gone.
 */
const ALONE_GRACE_MS = 15_000;

function endLabel(reason: CallEndReason | null, seconds: number): string {
  switch (reason) {
    case 'declined': return 'DECLINED';
    case 'missed': return 'NO ANSWER';
    case 'failed': return 'CALL FAILED';
    default: return seconds >= 1 ? 'CALL ENDED · ' + fmtDuration(seconds) : 'CALL ENDED';
  }
}

export function CallScreen({ conversationId, kind: kindParam }: { conversationId: string; kind: CallKind }) {
  const { phase, peer, call, kind: storeKind, reason } = useCallStore();
  const kind = call ? storeKind : kindParam;
  const insets = useSafeAreaInsets();
  const [tok, setTok] = useState<CallToken | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [nativeMissing, setNativeMissing] = useState(false);
  const callId = call?.id || null;
  // The screen stays mounted through the fade-out, so phase flips to idle while
  // we are still here: one back() per screen, never two.
  const closed = useRef(false);
  useKeepAwake();

  const close = () => {
    if (closed.current) return;
    closed.current = true;
    callReset();
    if (router.canGoBack()) router.back();
    else router.replace(ROUTES.chat(conversationId) as any);
  };

  // Android back: gestureEnabled:false only blocks the swipe. Popping the route
  // would unmount the room and drop the call with the store still 'live'.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      hangUp().catch(() => {});
      return true;
    });
    return () => sub.remove();
  }, []);

  // Nothing ringing or live: a cold open of /call (or a stale back-stack entry).
  useEffect(() => {
    if (phase === 'idle') close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Audio session first (LiveKit: configure before connecting), then the token.
  // Voice calls default to the earpiece like a phone; video calls to the speaker.
  useEffect(() => {
    if (!callId) return;
    let alive = true;
    (async () => {
      try {
        await AudioSession.configureAudio({
          android: { audioTypeOptions: AndroidAudioTypePresets.communication, preferredOutputList: kind === 'video' ? ['bluetooth', 'headset', 'speaker', 'earpiece'] : ['bluetooth', 'headset', 'earpiece', 'speaker'] },
          ios: { defaultOutput: kind === 'video' ? 'speaker' : 'earpiece' },
        });
        await AudioSession.startAudioSession();
        if (alive) setAudioReady(true);
      } catch {
        // No native module (a dev client built before LiveKit was added), or the
        // session could not start: say so instead of a silent black screen.
        if (alive) setNativeMissing(true);
      }
      try {
        const t = await fetchCallToken(conversationId);
        if (alive) setTok(t);
      } catch (e: any) {
        if (!alive) return;
        voidToast(String((e && e.message) || 'COULD NOT JOIN CALL').toUpperCase());
        hangUp('failed').catch(() => {});
      }
    })();
    return () => {
      alive = false;
      AudioSession.stopAudioSession().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  // Ended: hold the verdict for a beat, then leave. Reduced motion changes nothing
  // here - there is no motion, only a pause so the label can be read.
  useEffect(() => {
    if (phase !== 'ended') return;
    const t = setTimeout(close, LINGER_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const connect = !!tok && audioReady && phase !== 'ended' && phase !== 'idle';

  return (
    <View style={[st.fill, { backgroundColor: BG }]}>
      <LiveKitRoom
        serverUrl={tok?.url}
        token={tok?.token}
        connect={connect}
        audio
        video={kind === 'video' ? { facingMode: 'user' } : false}
        options={{ adaptiveStream: { pixelDensity: 'screen' } }}
        onError={(e) => {
          voidToast('CALL ERROR · ' + String(e.message || '').toUpperCase().slice(0, 40));
          hangUp('failed').catch(() => {});
        }}
      >
        <CallBody kind={kind} nativeMissing={nativeMissing} top={insets.top} bottom={insets.bottom} />
      </LiveKitRoom>
    </View>
  );
}

function CallBody({ kind, nativeMissing, top, bottom }: { kind: CallKind; nativeMissing: boolean; top: number; bottom: number }) {
  const { phase, peer, reason, liveAt } = useCallStore();
  const connection = useConnectionState();
  const remotes = useRemoteParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera]);
  const remoteCam = tracks.find((t) => isTrackReference(t) && !t.participant.isLocal && !t.publication.isMuted);
  const localCam = tracks.find((t) => isTrackReference(t) && t.participant.isLocal);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [speaker, setSpeaker] = useState(kind === 'video');
  const [tick, setTick] = useState(0);
  const endedAt = useRef<number | null>(null);

  // The other side is in the room: that is "live" whichever side we are on, and
  // whether or not the realtime UPDATE has arrived yet. Live and alone for
  // ALONE_GRACE_MS - they left (crash, backgrounded past LiveKit's reconnect
  // window) or never arrived (accepted a call the caller had already cancelled)
  // - and we hang up; a pressed END reaches us as the row's UPDATE long before.
  const remoteCount = remotes.length;
  const wasLive = useRef(false);
  useEffect(() => {
    if (remoteCount > 0) {
      callLive();
      wasLive.current = true;
      return;
    }
    if (phase !== 'live') return;
    const t = setTimeout(() => hangUp(wasLive.current ? 'remote' : 'failed').catch(() => {}), ALONE_GRACE_MS);
    return () => clearTimeout(t);
  }, [remoteCount, phase]);

  // Voice call at the ear: the proximity sensor blanks the screen so a cheek
  // cannot press END. Speaker or video: the screen stays on (keep-awake above).
  useEffect(() => {
    if (kind !== 'audio' || speaker) return;
    try { InCallManager.startProximitySensor(); } catch {}
    return () => { try { InCallManager.stopProximitySensor(); } catch {} };
  }, [kind, speaker]);

  // One re-render a second for the clock. Rare screen; the cost is nothing.
  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    if (phase === 'ended' && endedAt.current == null) endedAt.current = Date.now();
  }, [phase]);

  const seconds = liveAt ? callElapsed(phase === 'ended' && endedAt.current ? endedAt.current : Date.now()) : 0;
  void tick;

  let status: string;
  if (nativeMissing) status = 'CALLS NEED A REBUILT APP';
  else if (phase === 'ended') status = endLabel(reason, seconds);
  else if (phase === 'ringing-out') status = 'RINGING';
  else if (connection !== ConnectionState.Connected) status = connection === ConnectionState.Reconnecting ? 'RECONNECTING' : 'CONNECTING';
  else if (phase === 'live') status = fmtDuration(seconds);
  else status = 'CONNECTING';

  const toggleMic = () => {
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => voidToast('MIC UNAVAILABLE'));
  };
  const toggleCam = () => {
    localParticipant.setCameraEnabled(!isCameraEnabled, { facingMode: facing }).catch(() => voidToast('CAMERA UNAVAILABLE'));
  };
  const flip = async () => {
    const next = facing === 'user' ? 'environment' : 'user';
    const pub = localParticipant.getTrackPublication(Track.Source.Camera);
    const track = pub?.videoTrack as LocalVideoTrack | undefined;
    if (!track) return;
    try {
      await track.restartTrack({ facingMode: next });
      setFacing(next);
    } catch {
      voidToast('COULD NOT FLIP CAMERA');
    }
  };
  const toggleSpeaker = async () => {
    const on = !speaker;
    // iOS exposes only default / force_speaker; Android names the real outputs.
    const id = Platform.OS === 'ios' ? (on ? 'force_speaker' : 'default') : on ? 'speaker' : 'earpiece';
    try {
      await AudioSession.selectAudioOutput(id);
      setSpeaker(on);
    } catch {
      voidToast('NO SPEAKER ROUTE');
    }
  };
  const end = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    hangUp().catch(() => {});
  };

  const showRemoteVideo = kind === 'video' && !!remoteCam && isTrackReference(remoteCam);
  const showLocalVideo = kind === 'video' && isCameraEnabled && !!localCam && isTrackReference(localCam);
  const live = phase === 'live';
  const disc = kind === 'video' ? 48 : 56;

  return (
    <View style={st.fill}>
      {showRemoteVideo ? (
        <VideoTrack trackRef={remoteCam} style={StyleSheet.absoluteFill as any} objectFit="cover" zOrder={0} />
      ) : (
        <View style={st.center}>
          <PersonPfp uid={peer?.id} handle={peer?.handle} label={peer?.name} size={kind === 'video' ? 112 : 140} ring />
        </View>
      )}

      {/* Name + status always on top, readable over video. */}
      <View style={[st.top, { paddingTop: top + 18 }]} pointerEvents="none">
        <VText numberOfLines={1} style={st.name}>{peer?.name || 'void'}</VText>
        <VText style={st.handle}>@{peer?.handle || 'void'}</VText>
        <VText style={[st.status, live ? { color: '#f4f0ff' } : null]}>{status}</VText>
      </View>

      {showLocalVideo ? (
        <View style={[st.pip, { bottom: bottom + 150 }]}>
          <VideoTrack trackRef={localCam} style={st.pipVideo as any} objectFit="cover" mirror={facing === 'user'} zOrder={1} />
        </View>
      ) : null}

      {/* Five 48pt discs at gap 12 = 320pt: fits a 375pt phone. Voice has three, so it gets the roomier 56. */}
      <View style={[st.controls, { paddingBottom: bottom + 28, gap: kind === 'video' ? 12 : 18 }]}>
        <CallButton icon={isMicrophoneEnabled ? 'mic' : 'micOff'} label={isMicrophoneEnabled ? 'MUTE' : 'UNMUTE'} bg={isMicrophoneEnabled ? 'rgba(255,255,255,0.12)' : '#f4f0ff'} color={isMicrophoneEnabled ? '#fff' : BG} size={disc} onPress={toggleMic} />
        {kind === 'video' ? (
          <>
            <CallButton icon={isCameraEnabled ? 'camera' : 'cameraOff'} label={isCameraEnabled ? 'CAMERA' : 'CAM OFF'} bg={isCameraEnabled ? 'rgba(255,255,255,0.12)' : '#f4f0ff'} color={isCameraEnabled ? '#fff' : BG} size={disc} onPress={toggleCam} />
            <CallButton icon="flip" label="FLIP" bg="rgba(255,255,255,0.12)" size={disc} onPress={flip} />
          </>
        ) : null}
        <CallButton icon="speaker" label="SPEAKER" bg={speaker ? '#f4f0ff' : 'rgba(255,255,255,0.12)'} color={speaker ? BG : '#fff'} size={disc} onPress={toggleSpeaker} />
        <CallButton icon="phoneEnd" label="END" bg="#ef4444" size={disc} onPress={end} accessibilityLabel="End call" />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, alignItems: 'center', paddingHorizontal: 24 },
  name: { fontFamily: FONTS.serif, fontSize: 24, color: '#f4f0ff', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 },
  handle: { marginTop: 4, fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.12), color: '#a89bd6' },
  status: { marginTop: 14, fontFamily: FONTS.mono, fontSize: 11, letterSpacing: em(11, 0.2), color: '#a89bd6' },
  pip: { position: 'absolute', right: 16, width: 104, height: 152, borderRadius: 14, overflow: 'hidden', backgroundColor: '#140b2e', boxShadow: '0px 8px 24px rgba(0,0,0,0.5)' },
  pipVideo: { width: 104, height: 152 },
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', paddingHorizontal: 16 },
});
