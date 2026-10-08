// #chat-window — /messages/[id]. Bubbles per the web chat CSS (void2-final.html 1128-1151).
// 5s poll while open, optimistic send + rollback, mark read, block checks, terms gate.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { FONTS, em } from '../../theme/palettes';
import { VText } from '../../ui/Text';
import { Pfp } from '../../ui/Pfp';
import { Icon } from '../../ui/icons/Icon';
import { voidToast } from '../../ui/Toast';
import { ROUTES } from '../../nav/routes';
import { useTermsGate } from '../auth/TermsSheet';
import { canOpenUser, openUser } from '../feed/navigation';
import { ConvAvatar } from './ConvRow';
import { loadConvCalls, startCall } from '../calls/callsApi';
import { useCallStore } from '../calls/callStore';
import { callRowLabel, mergeThread, sameCalls, type CallKind, type CallRow } from '../calls/callText';
import {
  DM_NOTE,
  dmIsBlocked,
  dmMe,
  getDmSnapshot,
  loadConversations,
  pollChat,
  sendMessage,
  serverDmBlocked,
  setActiveConv,
  useDmStore,
  type DmMessage,
} from './dmStore';

function dayLabel(d: Date) {
  return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
}
function timeLabel(d: Date) {
  return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Phone / camera in the header. 44pt target around an 18px glyph; press feedback is
 * the same colour lift as Back plus a 120ms scale on the UI thread (a Reanimated
 * CSS transition - no shared value for a two-state press). Reduced motion keeps
 * the colour change and drops the scale.
 */
function HeadBtn({ icon, label, onPress, disabled }: { icon: 'phone' | 'camera'; label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const [pressed, setPressed] = useState(false);
  const still = useReducedMotion();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} hitSlop={4} pressRetentionOffset={16} style={[st.headBtn, disabled ? { opacity: 0.35 } : null]}>
      <Animated.View style={[st.headBtnInner, pressed && !still ? st.headBtnPressed : null]}>
        <Icon name={icon} size={18} color={pressed ? colors.white : colors.dim} />
      </Animated.View>
    </Pressable>
  );
}

export default function ChatScreen({ id: idProp }: { id?: string }) {
  const params = useLocalSearchParams<{ id?: string }>();
  const convId = String(idProp || params.id || '');
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { convs, msgs } = useDmStore();
  const conv = convs.find((c) => c.id === convId) || null;
  const [text, setText] = useState('');
  const [offline, setOffline] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const scroll = useRef<ScrollView>(null);
  const { gate, termsSheet } = useTermsGate();
  const callPhase = useCallStore().phase;

  // Call rows live in their own table (callText.ts explains why) and are re-read
  // on the same 5s cadence as messages. Only a change reaches React: the poll
  // used to be the reason every bubble re-rendered for nothing.
  const refreshCalls = React.useCallback(() => {
    if (!convId) return;
    loadConvCalls(convId).then((rows) => setCalls((prev) => (sameCalls(prev, rows) ? prev : rows)));
  }, [convId]);
  // A call just ended (or was declined/missed) while this thread is open: its
  // row changes now, not at the next poll.
  useEffect(() => {
    if (callPhase === 'ended' || callPhase === 'idle') refreshCalls();
  }, [callPhase, refreshCalls]);

  const close = () => (router.canGoBack() ? router.back() : router.replace(ROUTES.messages as any));

  // Resolve the conversation (deep link / cold open), block checks, then poll.
  useEffect(() => {
    if (!convId) return;
    let alive = true;
    setActiveConv(convId);
    (async () => {
      if (!getDmSnapshot().convs.some((c) => c.id === convId)) await loadConversations();
      if (!alive) return;
      const c = getDmSnapshot().convs.find((x) => x.id === convId);
      if (!c) {
        voidToast('CONVERSATION NOT FOUND');
        close();
        return;
      }
      if (dmIsBlocked(c.other.id, c.other.handle)) {
        voidToast('YOU BLOCKED THIS ACCOUNT');
        close();
        return;
      }
      serverDmBlocked(convId).then((b) => alive && setBlocked(b));
      const ok = await pollChat(convId, true);
      if (alive) setOffline(!ok);
      refreshCalls();
    })();
    const t = setInterval(() => {
      if (AppState.currentState === 'active') {
        pollChat(convId, false);
        refreshCalls();
      }
    }, 5000);
    return () => {
      alive = false;
      clearInterval(t);
      setActiveConv(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId]);

  const list: DmMessage[] = msgs[convId] || [];
  const me = dmMe();
  const rows = useMemo(() => {
    const out: React.ReactNode[] = [];
    let lastDay = '';
    const items = mergeThread(list, calls);
    items.forEach((it, i) => {
      const d = new Date(it.t === 'msg' ? it.m.created_at : it.c.created_at);
      const day = dayLabel(d);
      if (day !== lastDay) {
        out.push(
          <VText key={'d' + (it.t === 'msg' ? it.m.id : it.c.id)} align="center" style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.25), color: '#231d42', marginVertical: 6 }}>
            {day}
          </VText>,
        );
        lastDay = day;
      }
      if (it.t === 'call') {
        // A system row, not a bubble: "Voice call · 4:12", "Missed video call".
        out.push(
          <View key={'c' + it.c.id} style={st.callRow}>
            <Icon name={it.c.kind === 'video' ? 'camera' : 'phone'} size={11} color={colors.dim} />
            <VText style={st.callText}>{callRowLabel(it.c, me)}</VText>
            <VText style={st.callTime}>{timeLabel(d)}</VText>
          </View>,
        );
        return;
      }
      const m = it.m;
      const mine = m.sender_id === me;
      // The avatar marks the END of a run, not the start: it sits beside the last
      // thing someone said, where the eye is when the turn passes back. Every other
      // bubble in the run keeps the space so the column never shifts. A call row
      // between two messages ends the run too.
      const nextIt = items[i + 1];
      const next = nextIt && nextIt.t === 'msg' ? nextIt.m : undefined;
      const lastOfRun = !next || next.sender_id !== m.sender_id;
      out.push(
        <View key={m.id} style={[st.row2, mine ? st.rowMine : st.rowTheirs, m._pending ? { opacity: 0.55 } : null]}>
          {!mine ? (
            <Pressable style={st.avSlot} disabled={!lastOfRun || !canOpenUser(conv?.other.handle)} onPress={() => openUser(conv?.other.handle)}>{lastOfRun ? <Pfp seed={conv?.other.id || conv?.other.handle || 'void'} size={26} /> : null}</Pressable>
          ) : null}
          {mine ? (
            <View style={st.bMine}>
              <LinearGradient colors={['#7c3aed', '#5b21d4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <VText selectable style={st.bText}>{m.body}</VText>
            </View>
          ) : (
            <View style={st.bTheirs}>
              <VText selectable style={st.bText}>{m.body}</VText>
            </View>
          )}
        </View>,
      );
      // One time under the stack, on the last message - not a stamp on every
      // bubble, which turned a conversation into a log.
      if (!nextIt) {
        out.push(
          <VText key={'t' + m.id} align="center" style={st.stackTime}>
            {m._pending ? 'SENDING' : timeLabel(d)}
          </VText>,
        );
      }
    });
    return out;
  }, [list, calls, me, colors, conv]);

  // Phone / camera in the header. Same terms gate as send: a call is a write.
  const call = (kind: CallKind) => {
    if (!conv || !convId) return;
    if (dmIsBlocked(conv.other.id, conv.other.handle)) {
      voidToast('YOU BLOCKED THIS ACCOUNT');
      return;
    }
    gate(async () => {
      const err = await startCall(convId, kind);
      if (err) {
        voidToast(err);
        if (/CAN'T CALL/.test(err)) setBlocked(true);
        return;
      }
      router.push({ pathname: ROUTES.call, params: { id: convId, kind } } as any);
    });
  };

  const send = async () => {
    const body = text.trim();
    if (!body || !convId) return;
    if (conv && dmIsBlocked(conv.other.id, conv.other.handle)) {
      voidToast('YOU BLOCKED THIS ACCOUNT');
      return;
    }
    gate(async () => {
      setText('');
      const err = await sendMessage(convId, body);
      if (err) {
        setText((cur) => cur || body);
        if (err !== 'EMPTY') voidToast(err);
        if (/CAN'T MESSAGE/.test(err)) setBlocked(true);
      }
    });
  };

  const name = conv ? `${conv.other.name} @${conv.other.handle}` : '';

  return (
    <View style={[st.fill, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView style={st.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[st.head, { paddingTop: 12 + insets.top }]}>
          <LinearGradient pointerEvents="none" colors={['rgba(13,8,32,0.6)', 'rgba(13,8,32,0)']} style={StyleSheet.absoluteFill} />
          <Pressable accessibilityLabel="Back" onPress={close} style={st.back} hitSlop={6}>
            {({ pressed }) => <Icon name="back" size={18} color={pressed ? colors.white : colors.dim} />}
          </Pressable>
          {conv ? <ConvAvatar id={conv.other.id} name={conv.other.name} handle={conv.other.handle} size={38} fontSize={14} /> : <View style={{ width: 38, height: 38 }} />}
          <Pressable style={st.info} disabled={!canOpenUser(conv?.other.handle)} onPress={() => openUser(conv?.other.handle)}>
            <VText numberOfLines={1} style={{ fontFamily: FONTS.sansBold, fontSize: 13, color: colors.white }}>{name}</VText>
            <VText style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.12), color: colors.navDim }}>{DM_NOTE}</VText>
          </Pressable>
          <HeadBtn icon="phone" label="Voice call" disabled={!conv || blocked} onPress={() => call('audio')} />
          <HeadBtn icon="camera" label="Video call" disabled={!conv || blocked} onPress={() => call('video')} />
          <View style={{ opacity: 0.7 }} accessibilityLabel="Not end-to-end encrypted">
            <Icon name="unlock" size={13} color={colors.dim} />
          </View>
        </View>

        <ScrollView
          ref={scroll}
          style={st.fill}
          contentContainerStyle={st.body}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
          keyboardShouldPersistTaps="handled"
        >
          {rows.length ? (
            rows
          ) : (
            <VText align="center" style={{ padding: 40, fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.15), color: colors.muted, lineHeight: 9 * 1.6 }}>
              {offline ? 'MESSAGES OFFLINE' : 'CHANNEL OPEN\n\nNOT ENCRYPTED'}
            </VText>
          )}
        </ScrollView>

        <View style={[st.compose, { backgroundColor: colors.navBg, marginBottom: 16 + insets.bottom }]}>
          {blocked ? (
            <VText align="center" style={{ paddingVertical: 12, fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.2), color: colors.dim }}>
              CAN'T MESSAGE THIS ACCOUNT
            </VText>
          ) : (
            <View style={st.row}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="message…"
                placeholderTextColor={colors.dim}
                selectionColor={colors.gold}
                multiline
                maxLength={2000}
                style={[st.input, { color: colors.white }]}
                submitBehavior="submit"
                onSubmitEditing={send}
                returnKeyType="send"
              />
              <Pressable accessibilityLabel="Send" onPress={send} style={st.sendBtn}>
                <LinearGradient colors={['#c9a84c', '#8a6d2c']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 18 }]} />
                <Icon name="send" size={16} color="#04020c" />
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
      {termsSheet}
    </View>
  );
}

const st = StyleSheet.create({
  row2: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  avSlot: { width: 26, height: 26 },
  // 18/18/18/6 theirs, 18/18/6/18 mine: the square corner points at the speaker.
  bTheirs: { maxWidth: '74%', paddingVertical: 10, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomRightRadius: 18, borderBottomLeftRadius: 6 },
  bMine: { maxWidth: '74%', paddingVertical: 10, paddingHorizontal: 14, overflow: 'hidden', borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomRightRadius: 6, borderBottomLeftRadius: 18 },
  bText: { fontFamily: FONTS.sans, fontSize: 14, lineHeight: 14 * 1.45, color: '#f4f0ff' },
  stackTime: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.14), color: '#5c4d8a', marginTop: 6 },
  callRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8, paddingVertical: 4 },
  callText: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.12), color: '#8a7bb8' },
  callTime: { fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.14), color: '#5c4d8a', marginLeft: 4 },
  fill: { flex: 1 },
  head: { paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  // 44pt target; the header's 10px gap keeps the two apart without widening the row.
  headBtn: { width: 44, height: 44, marginHorizontal: -6, alignItems: 'center', justifyContent: 'center' },
  headBtnInner: {
    transform: [{ scale: 1 }],
    transitionProperty: 'transform',
    transitionDuration: '120ms',
    transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
  } as any, // Reanimated CSS transition keys (same cast as ReelItem.follow)
  headBtnPressed: { transform: [{ scale: 0.92 }] },
  info: { flex: 1, minWidth: 0 },
  body: { paddingTop: 14, paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  wrap: { maxWidth: '82%' },
  wrapMine: { alignItems: 'flex-end', alignSelf: 'flex-end' },
  wrapTheirs: { alignItems: 'flex-start', alignSelf: 'flex-start' },
  bubbleMine: {
    paddingVertical: 11,
    paddingHorizontal: 15,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 4,
    borderBottomLeftRadius: 18,
    overflow: 'hidden',
    boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.08)',
  },
  compose: {
    marginTop: 8,
    marginHorizontal: 14,
    borderRadius: 26,
    paddingVertical: 8,
    paddingRight: 8,
    paddingLeft: 16,
    boxShadow: '0px -6px 24px rgba(0,0,0,0.4), inset 0px 1px 0px rgba(255,255,255,0.07)',
  },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: { flex: 1, fontFamily: FONTS.sans, fontSize: 13, paddingVertical: 6, paddingHorizontal: 0, minHeight: 24, maxHeight: 90, lineHeight: 13 * 1.4 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', boxShadow: '0px 4px 14px rgba(201,168,76,0.35)' },
});
