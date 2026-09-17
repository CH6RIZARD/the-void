// Pill buttons, from the web's sign-in vocabulary (reused across the app):
//   'gold'  = .si-enter  {padding:13px;border-radius:24px;background:linear-gradient(135deg,#c9a84c,#a8873a);
//                         color:#04020c;Syne 700 12px;letter-spacing:.3em;box-shadow:0 6px 20px rgba(201,168,76,.22)}
//   'ghost' = .si-ghost  {padding:12px;border-radius:24px;transparent;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);
//                         color:var(--dim);Syne Mono 8px;letter-spacing:.2em}
//   'chip'  = .si-alt-btn{padding:9px 14px;border-radius:20px;background:rgba(255,255,255,.05);color:var(--dim);
//                         Syne Mono 8px;letter-spacing:.16em}  .on{color:var(--gold);background:rgba(201,168,76,.12)}
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';
import { FONTS, em } from '../theme/palettes';
import { VText } from './Text';
import { Icon } from './icons/Icon';
import type { IconName } from './icons/paths';

export type PillVariant = 'gold' | 'ghost' | 'chip';

export interface PillProps {
  label: string;
  onPress?: () => void;
  variant?: PillVariant;
  /** chip: selected state */
  active?: boolean;
  disabled?: boolean;
  icon?: IconName;
  /** stretch to the container width (gold/ghost are width:100% on the web) */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Pill({ label, onPress, variant = 'gold', active, disabled, icon, block, style, accessibilityLabel }: PillProps) {
  const { colors, isLight } = useTheme();
  const ghostRing = isLight ? colors.hairline : 'rgba(255,255,255,0.12)';
  const chipBg = isLight ? 'rgba(26,20,36,0.05)' : 'rgba(255,255,255,0.05)';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        variant === 'gold' && styles.gold,
        variant === 'ghost' && [styles.ghost, { boxShadow: `inset 0px 0px 0px 1px ${ghostRing}` }],
        variant === 'chip' && [styles.chip, { backgroundColor: active ? 'rgba(201,168,76,0.12)' : chipBg }],
        block ? styles.block : null,
        disabled ? { opacity: 0.45 } : null,
        pressed && variant === 'gold' ? { opacity: 0.94 } : null,
        style,
      ]}
    >
      {({ pressed }) => {
        const textColor =
          variant === 'gold' ? '#04020c' : variant === 'chip' ? (active ? colors.gold : pressed ? colors.white : colors.dim) : pressed ? colors.white : colors.dim;
        return (
          <>
            {variant === 'gold' ? (
              <LinearGradient colors={['#c9a84c', '#a8873a']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 24 }]} />
            ) : null}
            <View style={styles.row}>
              {icon ? <Icon name={icon} size={variant === 'gold' ? 14 : 11} color={textColor} /> : null}
              <VText
                style={
                  variant === 'gold'
                    ? { fontFamily: FONTS.sansBold, fontSize: 12, letterSpacing: em(12, 0.3), color: textColor }
                    : { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, variant === 'chip' ? 0.16 : 0.2), color: textColor }
                }
              >
                {label}
              </VText>
            </View>
          </>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gold: { padding: 13, borderRadius: 24, alignItems: 'center', justifyContent: 'center', boxShadow: '0px 6px 20px rgba(201,168,76,0.22)' },
  ghost: { padding: 12, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  chip: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  block: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});

export default Pill;
