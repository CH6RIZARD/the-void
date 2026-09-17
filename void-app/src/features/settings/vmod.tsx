// VMod sheet vocabulary (web: .vmod-* CSS injected by the moderation IIFE), shared by
// Terms / Contact / Blocked / Report / Author sheets across settings, profile, auth.
// Every number below is the web CSS value 1:1.
import React from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../../theme';
import { FONTS, em } from '../../theme/palettes';
import { VText } from '../../ui/Text';
import { Icon } from '../../ui/icons/Icon';

/** The web's VMod IC set (not in src/ui/icons). stroke 1.5, 24 viewBox. */
export type MiniIconName = 'more' | 'flag' | 'block' | 'mute' | 'eyeOff' | 'mail' | 'doc' | 'chev' | 'ext' | 'shield' | 'pulse';
export function MiniIcon({ name, size = 18, color }: { name: MiniIconName; size?: number; color: string }) {
  const s = { stroke: color, strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body: React.ReactNode = null;
  switch (name) {
    case 'more': body = <>{[5, 12, 19].map((cx) => <Circle key={cx} cx={cx} cy={12} r={1} {...s} />)}</>; break;
    case 'flag': body = <Path d="M5 21V4M5 4h11l-2 4 2 4H5" {...s} />; break;
    case 'block': body = <><Circle cx={12} cy={12} r={8.5} {...s} /><Path d="M6 6l12 12" {...s} /></>; break;
    case 'mute': body = <><Path d="M4 9h4l5-4v14l-5-4H4z" {...s} /><Path d="M17 9.5l4 5M21 9.5l-4 5" {...s} /></>; break;
    case 'eyeOff': body = <><Path d="M3 3l18 18" {...s} /><Path d="M10.6 5.6A10 10 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.1 3.8M6.3 7.3A17 17 0 0 0 2 12s3.6 6.5 10 6.5a9.6 9.6 0 0 0 4.2-.9" {...s} /><Path d="M9.9 9.9a2.8 2.8 0 0 0 4 4" {...s} /></>; break;
    case 'mail': body = <><Rect x={3} y={5} width={18} height={14} rx={2} {...s} /><Path d="m3.5 6 8.5 7 8.5-7" {...s} /></>; break;
    case 'doc': body = <Path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" {...s} />; break;
    case 'chev': body = <Path d="M9 5l7 7-7 7" {...s} />; break;
    case 'ext': body = <Path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" {...s} />; break;
    case 'shield': body = <Path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z" {...s} />; break;
    case 'pulse': body = <Path d="M3 12h4l2.5-6 5 12 2.5-6h4" {...s} />; break;
  }
  return <Svg width={size} height={size} viewBox="0 0 24 24">{body}</Svg>;
}

/** .vmod-hdr: eyebrow + hairline X */
export function VHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={st.hdr}>
      <VText numberOfLines={1} style={{ flexShrink: 1, fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.28), color: colors.navDim, textTransform: 'uppercase' }}>{title}</VText>
      <Pressable accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={st.x}>
        <Icon name="x" size={15} color={colors.dim} />
      </Pressable>
    </View>
  );
}

/** .vmod-title */
export function VTitle({ children, center }: { children: React.ReactNode; center?: boolean }) {
  const { colors } = useTheme();
  return <VText style={{ fontFamily: FONTS.serif, fontSize: 22, lineHeight: 22 * 1.2, color: colors.white, marginTop: 2, marginHorizontal: 2, marginBottom: 6, textAlign: center ? 'center' : undefined }}>{children}</VText>;
}
/** .vmod-p */
export function VP({ children, style }: { children: React.ReactNode; style?: any }) {
  const { colors } = useTheme();
  return <VText style={[{ fontFamily: FONTS.sans, fontSize: 12.5, lineHeight: 12.5 * 1.55, color: colors.dim, marginHorizontal: 2, marginBottom: 10 }, style]}>{children}</VText>;
}
/** .vmod-sec */
export function VSec({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.28), color: colors.navDim, marginTop: 18, marginHorizontal: 2, marginBottom: 2 }}>{children}</VText>;
}
/** .vmod-empty */
export function VEmpty({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <VText style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.14), color: colors.dim, paddingVertical: 18, paddingHorizontal: 2, textAlign: 'center' }}>{children}</VText>;
}

/** .vmod-btn (gold outline) / .ghost / .red */
export function VBtn({ label, onPress, kind = 'gold', disabled }: { label: string; onPress?: () => void; kind?: 'gold' | 'ghost' | 'red'; disabled?: boolean }) {
  const { colors, isLight } = useTheme();
  const border = kind === 'gold' ? 'rgba(201,168,76,0.5)' : kind === 'red' ? 'rgba(239,68,68,0.55)' : 'transparent';
  const color = kind === 'gold' ? colors.gold : kind === 'red' ? colors.red : colors.dim;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        st.btn,
        { borderColor: border, marginTop: kind === 'ghost' ? 10 : 14, opacity: disabled ? 0.4 : 1 },
        kind === 'ghost' ? { boxShadow: `inset 0px 0px 0px 1px ${isLight ? colors.hairline : 'rgba(255,255,255,0.12)'}` } : null,
      ]}
    >
      <VText style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.2), color }}>{label}</VText>
    </Pressable>
  );
}

/** .vmod-row: icon + label/sub, hairline under. */
export function VRow({ icon, label, sub, onPress, danger, on, last, right }: { icon?: React.ReactNode; label: string; sub?: string; onPress?: () => void; danger?: boolean; on?: boolean; last?: boolean; right?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={[st.row, last ? null : { boxShadow: `inset 0px -1px 0px ${colors.hairline}` }]}>
      {icon}
      <View style={st.rowT}>
        <VText numberOfLines={1} style={{ fontFamily: FONTS.sansSemiBold, fontSize: 13, color: danger ? colors.red : colors.white }}>{label}</VText>
        {sub ? <VText style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: em(8.5, 0.06), color: colors.dim, marginTop: 3 }}>{sub}</VText> : null}
      </View>
      {right}
    </Pressable>
  );
}

/** .vmod-item: avatar/icon + text + pill */
export function VItem({ left, label, sub, pill, onPill, children }: { left?: React.ReactNode; label?: string; sub?: string; pill?: string; onPill?: () => void; children?: React.ReactNode }) {
  const { colors, isLight } = useTheme();
  return (
    <View style={[st.item, { boxShadow: `inset 0px -1px 0px ${colors.hairline}` }]}>
      {left}
      <View style={st.rowT}>
        {children}
        {label ? <VText numberOfLines={1} style={{ fontFamily: FONTS.sansSemiBold, fontSize: 13, color: colors.white }}>{label}</VText> : null}
        {sub ? <VText style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: em(8.5, 0.06), color: colors.dim, marginTop: 3 }}>{sub}</VText> : null}
      </View>
      {pill ? (
        <Pressable onPress={onPill} style={[st.pill, { boxShadow: `inset 0px 0px 0px 1px ${isLight ? colors.hairline : 'rgba(255,255,255,0.14)'}` }]}>
          <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.16), color: colors.white }}>{pill}</VText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** .vmod-av (32px) / .big (56px). Colour = web _tcCol(label) approximated by AVC hash. */
export const AVC = ['#3b1f8a', '#1f3a8a', '#8a1f3a', '#1f8a3a', '#5b1f8a', '#8a5b1f', '#6b1f5a'];
export function avColor(seed: string): string {
  let h = 0;
  for (const c of String(seed || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVC[h % AVC.length];
}
export function VAv({ label, seed, big }: { label: string; seed?: string; big?: boolean }) {
  const { colors, isLight } = useTheme();
  const size = big ? 56 : 32;
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: seed ? avColor(seed) : colors.card2 },
        big ? { marginTop: 4, marginBottom: 10, alignSelf: 'center' } : null,
        isLight ? { backgroundColor: '#ded7c5', boxShadow: 'inset 0px 0px 0px 1px rgba(26,20,36,0.12), 0px 2px 6px rgba(26,20,36,0.12)' } : null,
      ]}
    >
      <VText style={{ fontFamily: FONTS.sansBold, fontSize: big ? 22 : 13, color: isLight ? '#4a4234' : colors.white }}>{String(label || '?')[0].toUpperCase()}</VText>
    </View>
  );
}

/** .vmod-link: gold mono + ext icon, opens in the system browser. */
export function VLink({ label, url }: { label: string; url: string }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={() => Linking.openURL(url).catch(() => {})} style={st.link}>
      <VText style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: em(8.5, 0.16), color: colors.gold }}>{label}</VText>
      <MiniIcon name="ext" size={12} color={colors.gold} />
    </Pressable>
  );
}

/** .vmod-in / .vmod-ta */
export function VInput(props: React.ComponentProps<typeof TextInput> & { area?: boolean; style?: StyleProp<any> }) {
  const { colors } = useTheme();
  const [focus, setFocus] = React.useState(false);
  const { area, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={colors.dim}
      selectionColor={colors.gold}
      multiline={area}
      {...rest}
      onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
      style={[
        st.input,
        { color: colors.white, backgroundColor: 'rgba(255,255,255,0.04)' },
        area ? { minHeight: 70, textAlignVertical: 'top' } : null,
        focus ? { boxShadow: 'inset 0px 0px 0px 1px rgba(124,58,237,0.5)' } : null,
        style,
      ]}
    />
  );
}

/** .toggle 40x23, knob 18, on = #c9a84c with #04020c knob. */
export function Toggle({ on, onPress, style }: { on: boolean; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: on }} onPress={onPress} hitSlop={8} style={[st.toggle, { backgroundColor: on ? '#c9a84c' : 'rgba(255,255,255,0.1)' }, style]}>
      <View style={[st.knob, { left: on ? 19.5 : 2.5, backgroundColor: on ? '#04020c' : colors.dim }]} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 18, paddingHorizontal: 2, paddingBottom: 8 },
  x: { marginLeft: 'auto', width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  btn: { alignSelf: 'stretch', padding: 13, borderWidth: 1, borderRadius: 24, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 2 },
  rowT: { flex: 1, minWidth: 0 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 2 },
  pill: { borderRadius: 16, paddingVertical: 7, paddingHorizontal: 13 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, marginRight: 8, marginLeft: 2, alignSelf: 'flex-start' },
  input: { alignSelf: 'stretch', borderRadius: 14, fontFamily: FONTS.sans, fontSize: 13, paddingVertical: 11, paddingHorizontal: 14, marginTop: 10, marginBottom: 4 },
  toggle: { width: 40, height: 23, borderRadius: 12, flexShrink: 0 },
  knob: { position: 'absolute', width: 18, height: 18, borderRadius: 9, top: 2.5 },
});
