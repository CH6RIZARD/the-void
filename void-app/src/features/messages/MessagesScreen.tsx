// #screen-messages — the conversation list (a tab). One field searches both ways:
// people on The Void (starts a DM) and message bodies already loaded.
import { useCreamInk } from '../../theme/ink';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { useInk } from '../../theme/ink';
import { FONTS, em } from '../../theme/palettes';
import { VText } from '../../ui/Text';
import { Icon } from '../../ui/icons/Icon';
import { voidToast } from '../../ui/Toast';
import { useBottomNavSpace } from '../../nav/layout';
import { dmMe, loadConversations, searchPeople, startDm, useDmStore, type DmConv, type DmMessage, type DmPerson } from './dmStore';
import { ConvAvatar, ConvEmpty, ConvFoot, ConvRow, ConvSect, PersonRow } from './ConvRow';

export const chatRoute = (convId: string) => `/messages/${encodeURIComponent(convId)}`;

export async function openDmWith(userId: string): Promise<void> {
  try {
    const conv = await startDm(userId);
    router.push(chatRoute(conv) as any);
  } catch (e: any) {
    voidToast(String((e && e.message) || 'COULD NOT OPEN CHAT'));
  }
}

/**
 * The five most-messaged people, across the top.
 *
 * "Most-messaged" is counted from the messages this client has actually loaded,
 * which is the only count available without asking the server for one: convs
 * arrive with a single `last` message each, and msgs[] fills in per thread as
 * they are opened. So a fresh launch ranks by recency (every count is zero and
 * the sort is stable over an already recency-sorted list) and the order settles
 * towards real volume as threads are read. That is the right-way-round failure:
 * it never shows a stale pin ahead of someone who just wrote.
 */
function PinnedRow({ convs, msgs, onOpen }: { convs: DmConv[]; msgs: Record<string, DmMessage[]>; onOpen: (c: DmConv) => void }) {
  const { colors } = useTheme();
  const ink = useInk();
  const pinned = useMemo(() => {
    const count = (c: DmConv) => (msgs[c.id] || []).length;
    return convs.map((c, i) => ({ c, i })).sort((a, b) => count(b.c) - count(a.c) || a.i - b.i).slice(0, 5).map((x) => x.c);
  }, [convs, msgs]);
  if (pinned.length < 2) return null; // a strip of one is just the list again
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={st.pinRow}
      keyboardShouldPersistTaps="handled"
    >
      {pinned.map((c) => (
        <Pressable
          key={c.id}
          onPress={() => onOpen(c)}
          accessibilityRole="button"
          accessibilityLabel={'Open chat with ' + (c.other.name || c.other.handle)}
          style={st.pin}
        >
          <View>
            <ConvAvatar id={c.other.id} name={c.other.name} size={64} fontSize={23} ring={c.unread > 0} />
            {c.unread > 0 ? (
              <View style={[st.pinBadge, { backgroundColor: colors.gold, borderColor: colors.bg }]}>
                <VText style={{ fontFamily: FONTS.mono, fontSize: 9, color: '#0d0820' }}>
                  {c.unread > 9 ? '9+' : String(c.unread)}
                </VText>
              </View>
            ) : null}
          </View>
          <VText numberOfLines={1} style={[st.pinName, { color: c.unread > 0 ? colors.white : colors.dim }]}>
            {(c.other.name || c.other.handle || '').trim().split(/s+/)[0]}
          </VText>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export default function MessagesScreen() {
  const { colors } = useTheme();
  const creamInk = useCreamInk();
  const ink = useInk();
  const insets = useSafeAreaInsets();
  const navSpace = useBottomNavSpace();
  const { convs, msgs, state } = useDmStore();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [people, setPeople] = useState<DmPerson[] | null>(null);
  const searchTok = useRef(0);
  const searchRef = useRef<TextInput>(null);

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
    body = (
      <>
        <PinnedRow convs={convs} msgs={msgs} onOpen={open} />
        <ConvSect label="RECENT" />
        {convs.map((c) => <ConvRow key={c.id} c={c} onPress={() => open(c)} />)}
      </>
    );
  }

  return (
    <View style={[st.fill, { backgroundColor: colors.bg }]}>
      <View style={[st.head, { paddingTop: 14 + insets.top }]}>
        <LinearGradient pointerEvents="none" colors={ink.shade} style={StyleSheet.absoluteFill} />
        <VText style={{ flex: 1, fontFamily: FONTS.serif, fontSize: 24, color: colors.white }}>Messages</VText>
        <Pressable
          onPress={() => searchRef.current?.focus()}
          accessibilityRole="button"
          accessibilityLabel="Compose a message"
          hitSlop={8}
          style={({ pressed }) => [st.compose, { borderColor: colors.gold, opacity: pressed ? 0.6 : 1 }]}
        >
          <Icon name="pen" size={15} color={colors.gold} />
        </Pressable>
      </View>
      <View style={st.badgeRow}>
        <Icon name="unlock" size={11} color={creamInk.dim} />
        <VText style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.2), color: ink.dim }}>NOT ENCRYPTED</VText>
      </View>
      <View style={st.searchWrap}>
        <TextInput
          ref={searchRef}
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
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 16, paddingBottom: 2 },
  compose: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pinRow: { paddingHorizontal: 6, paddingTop: 2, paddingBottom: 12, gap: 14 },
  pin: { width: 68, alignItems: 'center', gap: 6 },
  pinName: { fontFamily: FONTS.sans, fontSize: 11, maxWidth: 66, textAlign: 'center' },
  pinBadge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  searchWrap: { paddingTop: 2, paddingHorizontal: 16, paddingBottom: 10 },
  search: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', fontFamily: FONTS.sans, fontSize: 12.5 },
  list: { paddingTop: 4, paddingHorizontal: 10 },
});
