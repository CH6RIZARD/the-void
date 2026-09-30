// .conv-item / .conv-sect / .conv-empty / .conv-foot (void2-final.html 1105-1127).
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme';
import { FONTS, em } from '../../theme/palettes';
import { VText } from '../../ui/Text';
import { Pfp } from '../../ui/Pfp';
import { ago, dmMe, DM_FOOT, type DmConv, type DmPerson } from './dmStore';

/**
 * Someone's face in the message list.
 *
 * The handoff calls for the PFP set here - a gold figure on a deep-purple disc -
 * rather than the first letter of a name on a tinted circle. The figure is chosen
 * from the person's id, so it is the same face in the pinned strip, in the row
 * below it and in the thread behind it.
 *
 * `fontSize` is kept in the signature and ignored: callers pass it, and a figure
 * has no letter to size.
 */
export function ConvAvatar({ id, name, size = 44, fontSize, ring }: { id: string; name: string; size?: number; fontSize?: number; ring?: boolean }) {
  void fontSize;
  return (
    <View style={{ flexShrink: 0 }}>
      <Pfp seed={id || name} size={size} ring={ring} />
    </View>
  );
}

function NameLine({ name, handle }: { name: string; handle: string }) {
  const { colors } = useTheme();
  return (
    <View style={st.nameRow}>
      <VText numberOfLines={1} style={{ flexShrink: 1, fontFamily: FONTS.sansBold, fontSize: 13, color: colors.white }}>{name}</VText>
      <VText numberOfLines={1} style={{ flexShrink: 1, fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.06), color: colors.muted }}>@{handle}</VText>
    </View>
  );
}

/** One conversation. `hit` replaces the preview with a highlighted search snippet. */
export function ConvRow({ c, onPress, hit }: { c: DmConv; onPress: () => void; hit?: { before: string; match: string; after: string; mine: boolean } }) {
  const { colors } = useTheme();
  const me = dmMe();
  const last = c.last;
  const preview = last ? (last.sender_id === me ? 'You: ' : '') + last.body.slice(0, 38) + (last.body.length > 38 ? '…' : '') : 'no messages yet';
  const unread = c.unread > 0;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.item, pressed ? { backgroundColor: 'rgba(255,255,255,0.03)' } : null]}>
      {unread ? (
        <LinearGradient pointerEvents="none" colors={['rgba(124,58,237,0.1)', 'rgba(124,58,237,0)']} locations={[0, 0.7]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={[StyleSheet.absoluteFill, { borderRadius: 18 }]} />
      ) : null}
      <ConvAvatar id={c.other.id} name={c.other.name} ring={unread} />
      <View style={st.info}>
        <NameLine name={c.other.name} handle={c.other.handle} />
        {hit ? (
          <VText numberOfLines={1} style={{ fontFamily: FONTS.sans, fontSize: 11.5, color: colors.dim, marginTop: 2 }}>
            {hit.mine ? 'You: ' : ''}
            {hit.before}
            <VText style={{ fontFamily: FONTS.sans, fontSize: 11.5, color: colors.gold }}>{hit.match}</VText>
            {hit.after}
          </VText>
        ) : (
          <VText numberOfLines={1} style={{ fontFamily: FONTS.sans, fontSize: 11.5, color: unread ? '#c9bfe8' : colors.dim, marginTop: 2 }}>{preview}</VText>
        )}
      </View>
      <View style={st.right}>
        <VText style={{ fontFamily: FONTS.mono, fontSize: 8, color: colors.dim, textTransform: 'uppercase' }}>{last ? ago(Date.parse(last.created_at)) : ''}</VText>
        {unread ? <View style={[st.dot, { backgroundColor: colors.gold }]} /> : null}
      </View>
    </Pressable>
  );
}

export function PersonRow({ p, onPress }: { p: DmPerson; onPress: () => void }) {
  const { colors } = useTheme();
  const name = p.display_name || p.handle;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.item, pressed ? { backgroundColor: 'rgba(255,255,255,0.03)' } : null]}>
      <ConvAvatar id={p.id} name={name} />
      <View style={st.info}>
        <NameLine name={name} handle={p.handle} />
        <VText numberOfLines={1} style={{ fontFamily: FONTS.sans, fontSize: 11.5, color: colors.dim, marginTop: 2 }}>tap to message</VText>
      </View>
    </Pressable>
  );
}

export function ConvSect({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={st.sect}>
      <VText style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.25), color: colors.gold }}>{label}</VText>
      <LinearGradient colors={['rgba(201,168,76,0.3)', 'rgba(201,168,76,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={st.sectLine} />
    </View>
  );
}

export function ConvEmpty({ lines, onPress }: { lines: string[]; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={st.empty}>
      <VText align="center" style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.15), color: colors.muted, lineHeight: 9 * 1.6 }}>
        {lines.join('\n\n')}
      </VText>
    </Pressable>
  );
}

export function ConvFoot() {
  return (
    <VText align="center" style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.2), color: '#231d42', marginTop: 26, paddingBottom: 20 }}>
      {DM_FOOT}
    </VText>
  );
}

const st = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 13, paddingHorizontal: 10, borderRadius: 18, overflow: 'hidden' },
  info: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  right: { alignItems: 'flex-end', gap: 5, flexShrink: 0 },
  dot: { width: 8, height: 8, borderRadius: 4, boxShadow: '0px 0px 10px rgba(201,168,76,0.8)' },
  sect: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 14, paddingHorizontal: 10, paddingBottom: 6 },
  sectLine: { flex: 1, height: 1 },
  empty: { paddingVertical: 34, paddingHorizontal: 20 },
});
