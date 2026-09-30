// .gmode-toggle — floating glass capsule, top-centre, above both views.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { em, useLiveTheme } from '../live/liveTheme';
import type { GlobeMode } from './persist';

// topInset: the status bar. The capsule sat at a flat top:10 inside a screen that is
// drawn edge-to-edge, i.e. UNDER the status bar - a tap on GLOBE opened the phone's
// notification shade instead (seen on the test phone, 2026-09-21).
export function GlobeModeToggle({ mode, onChange, topInset = 0 }: { mode: GlobeMode; onChange(m: GlobeMode): void; topInset?: number }) {
  const t = useLiveTheme();
  const btn = (m: GlobeMode, label: string) => {
    const on = mode === m;
    return (
      <Pressable
        key={m}
        onPress={() => onChange(m)}
        style={({ pressed }) => [styles.btn, on && styles.on, { opacity: pressed ? 0.72 : 1 }]}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
      >
        <Text style={{ fontFamily: t.mono, fontSize: 8, letterSpacing: em(8, 0.2), color: on ? t.gold : t.navDim }}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={[styles.anchor, { top: 10 + topInset }]} pointerEvents="box-none">
      <View style={styles.capsule}>
        {/* background:rgba(13,8,32,.72);backdrop-filter:blur(14px) */}
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(13,8,32,0.72)' }]} />
        {/* GLOBE first: it is what this tab is for, and it is the left panel. */}
        {btn('globe', 'GLOBE')}
        {btn('reels', 'REELS')}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center', zIndex: 30 },
  capsule: {
    flexDirection: 'row',
    gap: 2,
    padding: 3,
    borderRadius: 22,
    overflow: 'hidden',
    // box-shadow: inset 0 1px 0 rgba(255,255,255,.08)
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
  } as any,
  btn: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 20, backgroundColor: 'transparent' },
  on: { backgroundColor: 'rgba(255,255,255,0.07)' },
});
