// #screen-messages — the conversation list (a tab). One field searches both ways:
// people on The Void (starts a DM) and message bodies already loaded.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { FONTS, em } from '../../theme/palettes';
import { VText } from '../../ui/Text';
import { Icon } from '../../ui/icons/Icon';
import { voidToast } from '../../ui/Toast';
import { useBottomNavSpace } from '../../nav/layout';
import { dmMe, loadConversations, searchPeople, startDm, useDmStore, type DmConv, type DmPerson } from './dmStore';
import { ConvEmpty, ConvFoot, ConvRow, ConvSect, PersonRow } from './ConvRow';

export const chatRoute = (convId: string) => `/messages/${encodeURIComponent(convId)}`;

export async function openDmWith(userId: string): Promise<void> {
  try {
    const conv = await startDm(userId);
    router.push(chatRoute(conv) as any);
  } catch (e: any) {
    voidToast(String((e && e.message) || 'COULD NOT OPEN CHAT'));
  }
}

export default function MessagesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navSpace = useBottomNavSpace();
  const { convs, msgs, state } = useDmStore();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [people, setPeople] = useState<DmPerson[] | null>(null);
  const searchTok = useRef(0);

  // 15s list poll while this tab is focused and the app is foreground.
  useFocusEffect(
    useCallback(() => {
      loadConversations();
      const t = setInterval(() => {
        if (AppState.currentState === 'active') loadConversations();
      }, 15000);
      return () => clearInterval(t);
    }, []),
  );

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim().toLowerCase()), 140);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const tok = ++searchTok.current;
    setPeople(null);
    if (!dq) return;
    searchPeople(dq).then((rows) => {
      if (tok === searchTok.current) setPeople(rows);
    });
  }, [dq, convs.length]);

  const me = dmMe();
  const search = useMemo(() => {
    if (!dq) return null;
    const matched = convs.filter((c) => (c.other.name || '').toLowerCase().includes(dq) || (c.other.handle || '').toLowerCase().includes(dq));
    const hits: { c: DmConv; before: string; match: string; after: string; mine: boolean; key: string }[] = [];
    convs.forEach((c) =>
      (msgs[c.id] || (c.last ? [c.last] : [])).forEach((m) => {
        const t = m.body || '';
        const k = t.toLowerCase().indexOf(dq);
        if (k >= 0) hits.push({ c, before: t.slice(Math.max(0, k - 24), k), match: t.substr(k, dq.length), after: t.slice(k + dq.length, k + dq.length + 40), mine: m.sender_id === me, key: m.id });
      }),
    );
    return { matched, hits: hits.slice(0, 40) };
  }, [dq, convs, msgs, me]);

  const open = (c: DmConv) => router.push(chatRoute(c.id) as any);

  let body: React.ReactNode;
  if (search) {
    body = (
      <>
        {search.matched.length ? <ConvSect label="CONVERSATIONS" /> : null}
        {search.matched.map((c) => <ConvRow key={c.id} c={c} onPress={() => open(c)} />)}
        {search.hits.length ? <ConvSect label="MESSAGES" /> : null}
        {search.hits.map((h) => <ConvRow key={h.key} c={h.c} hit={h} onPress={() => open(h.c)} />)}
        {people && people.length ? <ConvSect label="PEOPLE" /> : null}
        {(people || []).map((p) => <PersonRow key={p.id} p={p} onPress={() => { setQ(''); openDmWith(p.id); }} />)}
        {!search.matched.length && !search.hits.length && !(people && people.length) ? (
          <ConvEmpty lines={[people === null ? `SEARCHING THE VOID FOR “${dq}”` : `NO MATCH FOR “${dq}”`]} />
        ) : null}
      </>
    );
  } else if (state === 'loading' || state === 'idle') {
    body = <ConvEmpty lines={['OPENING CHANNELS…']} />;
  } else if (state === 'offline') {
    body = <ConvEmpty lines={['MESSAGES OFFLINE', 'TAP TO RETRY']} onPress={() => loadConversations()} />;
  } else if (state === 'unavailable') {
    body = <ConvEmpty lines={['MESSAGING IS NOT AVAILABLE YET']} />;
  } else if (!convs.length) {
    body = <ConvEmpty lines={['NO CONVERSATIONS', 'SEARCH A HANDLE ABOVE TO START ONE']} />;
  } else {
    body = convs.map((c) => <ConvRow key={c.id} c={c} onPress={() => open(c)} />);
  }

  return (
    <View style={[st.fill, { backgroundColor: colors.bg }]}>
      <View style={[st.head, { paddingTop: 14 + insets.top }]}>
        <LinearGradient pointerEvents="none" colors={['rgba(13,8,32,0.6)', 'rgba(13,8,32,0)']} style={StyleSheet.absoluteFill} />
        <VText style={{ flex: 1, fontFamily: FONTS.serif, fontSize: 24, color: colors.white }}>Messages</VText>
        <View style={st.badge}>
          <Icon name="unlock" size={11} color="#6a58a0" />
          <VText style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.2), color: '#6a58a0' }}>NOT ENCRYPTED</VText>
        </View>
      </View>
      <View style={st.searchWrap}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="search people and messages…"
          placeholderTextColor={colors.dim}
          selectionColor={colors.gold}
          autoCapitalize="none"
          autoCorrect={false}
          style={[st.search, { color: colors.white }]}
        />
      </View>
      <ScrollView style={st.fill} contentContainerStyle={[st.list, { paddingBottom: navSpace }]} keyboardShouldPersistTaps="handled">
        {body}
        <ConvFoot />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  head: { paddingHorizontal: 16, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  searchWrap: { paddingTop: 2, paddingHorizontal: 16, paddingBottom: 10 },
  search: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', fontFamily: FONTS.sans, fontSize: 12.5 },
  list: { paddingTop: 4, paddingHorizontal: 10 },
});
