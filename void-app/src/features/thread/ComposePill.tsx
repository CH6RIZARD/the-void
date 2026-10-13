// .thread-compose — the pinned compose pill with the purple send orb.
//   .thread-compose{border-radius:26px;background:var(--tc-card);box-shadow:0 -6px 24px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.07);padding:10px 10px 10px 16px}
//   .thread-compose-av{28x28;var(--pdim);10px 800}   .thread-compose-input{Syne 13;padding:6px 0;line-height:1.4;placeholder var(--dim)}
//   .thread-post-btn{36x36;linear-gradient(135deg,#7c3aed,#5b21d4);box-shadow:0 4px 14px rgba(124,58,237,.4)} send icon 16 #fff
// Enter (without shift) submits on the web; here the return key submits.
import React, { forwardRef } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme/ThemeProvider';
import { useInk } from '../../theme/ink';
import { FONTS, em } from '../../theme/palettes';
import { Icon } from '../../ui/icons';
import { VText } from '../../ui/Text';
import { useThreadTokens } from './threadTheme';

export interface ComposePillProps {
  value: string;
  onChangeText: (t: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** thread deck pill shows the viewer's initial; the reply overlay pill does not */
  avatar?: string | null;
  /** `REPLYING TO NAME` line inside the pill (margin 0 0 8 38; Syne Mono 7.5 .18em gold), clearable */
  pinned?: { name: string; onClear: () => void } | null;
  style?: StyleProp<ViewStyle>;
}

export const ComposePill = forwardRef<TextInput, ComposePillProps>(function ComposePill({ value, onChangeText, onSubmit, placeholder, avatar, pinned, style }, ref) {
  const { colors } = useTheme();
  const { violet } = useInk();
  const tk = useThreadTokens();
  const has = !!value.trim();
  return (
    <View style={[styles.pill, { backgroundColor: tk.card }, style]}>
      {pinned ? (
        <View style={styles.pin}>
          <Icon name="reply" size={11} color={colors.gold} />
          <VText style={[styles.pinT, { color: colors.gold }]}>{'REPLYING TO ' + pinned.name.toUpperCase()}</VText>
          <Pressable onPress={pinned.onClear} hitSlop={8} style={styles.pinX} accessibilityLabel="Clear">
            <Icon name="x" size={11} color={colors.navDim} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.row}>
        {avatar != null ? (
          <View style={[styles.av, { backgroundColor: colors.pdim }]}>
            <VText style={{ fontFamily: FONTS.sansExtraBold, fontSize: 10, color: colors.white }}>{avatar}</VText>
          </View>
        ) : null}
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.dim}
          style={[styles.input, { color: colors.white }]}
          multiline
          submitBehavior="submit"
          returnKeyType="send"
          onSubmitEditing={onSubmit}
          allowFontScaling={false}
        />
        <Pressable onPress={onSubmit} accessibilityLabel="Send" style={({ pressed }) => [styles.send, pressed && { opacity: 0.8 }]}>
          {has ? (
            <LinearGradient colors={violet} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sendFill}>
              <Icon name="send" size={16} color="#fff" />
            </LinearGradient>
          ) : (
            <View style={[styles.sendFill, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
              <Icon name="send" size={16} color={colors.navDim} />
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  pill: { borderRadius: 26, paddingTop: 10, paddingRight: 10, paddingBottom: 10, paddingLeft: 16, boxShadow: '0px -6px 24px rgba(0,0,0,0.4), inset 0px 1px 0px rgba(255,255,255,0.07)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  av: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  input: { flex: 1, fontFamily: FONTS.sans, fontSize: 13, lineHeight: 13 * 1.4, paddingVertical: 6, paddingHorizontal: 0, minHeight: 24, maxHeight: 120 },
  send: { width: 36, height: 36, borderRadius: 18, marginLeft: 'auto', boxShadow: '0px 4px 14px rgba(124,58,237,0.3)' },
  pin: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 38, marginBottom: 8 },
  pinT: { fontFamily: FONTS.mono, fontSize: 7.5, letterSpacing: em(7.5, 0.18) },
  pinX: { paddingHorizontal: 4 },
  sendFill: { flex: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
