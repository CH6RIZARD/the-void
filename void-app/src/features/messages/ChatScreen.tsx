// #chat-window — /messages/[id]. Bubbles per the web chat CSS (void2-final.html 1128-1151).
// 5s poll while open, optimistic send + rollback, mark read, block checks, terms gate.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { FONTS, em } from '../../theme/palettes';
import { VText } from '../../ui/Text';
import { Icon } from '../../ui/icons/Icon';
import { voidToast } from '../../ui/Toast';
import { ROUTES } from '../../nav/routes';
import { useTermsGate } from '../auth/TermsSheet';
import { ConvAvatar } from './ConvRow';
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
  const scroll = useRef<ScrollView>(null);
  const { gate, termsSheet } = useTermsGate();

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
    })();
    const t = setInterval(() => {
      if (AppState.currentState === 'active') pollChat(convId, false);
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
    list.forEach((m) => {
      const d = new Date(m.created_at);
      const day = dayLabel(d);
      if (day !== lastDay) {
        out.push(
          <VText key={'d' + m.id} align="center" style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.25), color: '#231d42', marginVertical: 6 }}>
            {day}
          </VText>,
        );
        lastDay = day;
      }
      const mine = m.sender_id === me;
      out.push(
        <View key={m.id} style={[st.wrap, mine ? st.wrapMine : st.wrapTheirs, m._pending ? { opacity: 0.55 } : null]}>
          {mine ? (
            <View style={st.bubbleMine}>
              <LinearGradient colors={['rgba(124,58,237,0.35)', 'rgba(91,33,212,0.2)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <VText selectable style={{ fontFamily: FONTS.sans, fontSize: 13, lineHeight: 13 * 1.55, color: colors.white }}>{m.body}</VText>
            </View>
          ) : (
            <VText selectable style={{ fontFamily: FONTS.sans, fontSize: 13, lineHeight: 13 * 1.55, color: '#c9bfe8' }}>{m.body}</VText>
          )}
          <VText style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.06), color: colors.dim, marginTop: 3 }}>{m._pending ? 'SENDING' : timeLabel(d)}</VText>
        </View>,
      );
    });
    return out;
  }, [list, me, colors]);

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
          {conv ? <ConvAvatar id={conv.other.id} name={conv.other.name} size={38} fontSize={14} /> : <View style={{ width: 38, height: 38 }} />}
          <View style={st.info}>
            <VText numberOfLines={1} style={{ fontFamily: FONTS.sansBold, fontSize: 13, color: colors.white }}>{name}</VText>
            <VText style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.12), color: colors.navDim }}>{DM_NOTE}</VText>
          </View>
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
  fill: { flex: 1 },
  head: { paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
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
