// .prof-avatar: 72px, 1px gold ring only (patch3 §2). Theme grounds:
//   VOID  linear-gradient(140deg,#1d0d45,#0a0522)
//   DARK  linear-gradient(140deg,var(--card2),var(--bg2))
//   LIGHT #ded7c5 + inset ring + soft drop shadow
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme';
import { FONTS } from '../../theme/palettes';
import { VText } from '../../ui/Text';

export function ProfileAvatar({ name, url, size = 72 }: { name: string; url?: string | null; size?: number }) {
  const { colors, name: theme } = useTheme();
  const light = theme === 'light';
  const grad = theme === 'dark' ? [colors.card2, colors.bg2] : ['#1d0d45', '#0a0522'];
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
        light
          ? { backgroundColor: '#ded7c5', boxShadow: 'inset 0px 0px 0px 1px rgba(26,20,36,0.12), 0px 2px 6px rgba(26,20,36,0.12)' }
          : { boxShadow: '0px 0px 0px 1px rgba(201,168,76,0.45)' },
      ]}
    >
      {!light ? (
        <LinearGradient colors={grad as [string, string]} start={{ x: 0.18, y: 0.12 }} end={{ x: 0.82, y: 0.88 }} style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]} />
      ) : null}
      {url ? (
        <Image source={{ uri: url }} style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]} contentFit="cover" transition={150} />
      ) : (
        <VText style={{ fontFamily: FONTS.sansExtraBold, fontSize: Math.round(size * 0.36), color: light ? '#4a4234' : colors.white }}>{String(name || '?')[0].toUpperCase()}</VText>
      )}
    </View>
  );
}
