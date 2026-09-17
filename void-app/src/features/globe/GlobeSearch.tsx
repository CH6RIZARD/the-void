// #globe-search-modal — openGlobeSearch / searchGlobe / closeGlobeSearch.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Path } from 'react-native-svg';
import { countries, type Country } from '../live/core';
import { em, useLiveTheme } from '../live/liveTheme';

export function GlobeSearch({ onClose, onPick }: { onClose(): void; onPick(c: Country): void }) {
  const t = useLiveTheme();
  const input = useRef<TextInput>(null);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 80);
    return () => clearTimeout(id);
  }, []);
  // debounced('globe', …, 180)
  useEffect(() => {
    const id = setTimeout(() => setQuery(q), 180);
    return () => clearTimeout(id);
  }, [q]);

  const hint = (text: string) => <Text style={[styles.hint, { fontFamily: t.mono, color: t.muted, letterSpacing: em(9, 0.15) }]}>{text}</Text>;

  let body: React.ReactNode;
  if (!query.trim()) body = hint('TYPE TO SEARCH ─ TAP NATION TO OPEN');
  else {
    const ql = query.toLowerCase();
    const matches = countries()
      .filter((c) => c.n.toLowerCase().includes(ql))
      .slice(0, 12);
    body = !matches.length
      ? hint('NO NATION FOUND')
      : matches.map((c) => (
          <Pressable key={c.iso + c.n} onPress={() => onPick(c)} style={({ pressed }) => [styles.item, { borderBottomColor: t.border, opacity: pressed ? 0.72 : 1 }]}>
            <Text style={{ fontFamily: t.sans, fontSize: 14, fontWeight: '700', color: t.white }}>{c.n}</Text>
            <Text style={{ fontFamily: t.mono, fontSize: 9, color: t.gold, letterSpacing: em(9, 0.12) }}>{c.iso}</Text>
          </Pressable>
        ));
  }

  return (
    <View style={styles.modal}>
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(4,2,12,0.97)' }]} />
      <View style={styles.row}>
        <TextInput
          ref={input}
          value={q}
          onChangeText={setQ}
          placeholder="search nation…"
          placeholderTextColor={t.muted}
          autoCorrect={false}
          autoCapitalize="none"
          autoComplete="off"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, { backgroundColor: t.card, borderColor: focused ? t.glow : t.border, color: t.white, fontFamily: t.sans }]}
        />
        <Pressable onPress={onClose} style={styles.close} hitSlop={6}>
          <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={t.dim} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M5 5l14 14M19 5 5 19" />
          </Svg>
        </Pressable>
      </View>
      <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  modal: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 20, padding: 12, flexDirection: 'column' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 10, flexShrink: 0 },
  input: { flex: 1, borderWidth: 1, fontSize: 14, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 6 },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  results: { flex: 1 },
  hint: { fontSize: 9, textAlign: 'center', padding: 20 },
  item: { paddingVertical: 12, paddingHorizontal: 6, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 4 },
});
