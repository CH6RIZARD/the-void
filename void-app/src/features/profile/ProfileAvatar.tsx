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
import { MyPfp, PersonPfp } from '../../ui/Pfp';

export function ProfileAvatar({ name, url, size = 72, own = false, uid }: { name: string; url?: string | null; size?: number; own?: boolean; uid?: string | null }) {
  const { colors, name: theme, isLight: light } = useTheme();
  const grad = theme === 'dark' ? [colors.card2, colors.bg2] : ['#1d0d45', '#0a0522'];
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
        light
          ? { backgroundColor: colors.pdim, boxShadow: `inset 0px 0px 0px 1px ${colors.hairline}, 0px 2px 6px ${colors.hairline}` }
          : { boxShadow: '0px 0px 0px 1px rgba(201,168,76,0.45)' },
      ]}
    >
      {!light ? (
        <LinearGradient colors={grad as [string, string]} start={{ x: 0.18, y: 0.12 }} end={{ x: 0.82, y: 0.88 }} style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]} />
      ) : null}
      {url ? (
        <Image source={{ uri: url }} style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]} contentFit="cover" transition={150} />
      ) : (
        // No photo: your own pick from the PFP set, or - on someone else's
        // profile - the figure derived from their id, the same one their posts
        // and DMs show. (This used to draw YOUR pick on every profile.)
        own ? <MyPfp seed={uid || name} size={size} /> : <PersonPfp uid={uid} label={name} size={size} />
      )}
    </View>
  );
}
