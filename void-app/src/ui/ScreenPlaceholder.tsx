// Placeholder for screens other agents have not ported yet. Styled like the app
// (radial backdrop, mono eyebrow, serif italic monument) so nothing looks broken.
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Backdrop } from './Surface';
import { VText } from './Text';
import { Icon } from './icons/Icon';
import { useBottomNavSpace } from '../nav/layout';

export function ScreenPlaceholder({ title, eyebrow, body, modal, media }: { title: string; eyebrow?: string; body?: string; modal?: boolean; media?: boolean }) {
  const insets = useSafeAreaInsets();
  const navSpace = useBottomNavSpace();
  return (
    <Backdrop media={media}>
      {modal ? (
        <Pressable accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/void'))} style={[styles.back, { top: insets.top + 12 }]} hitSlop={12}>
          <Icon name="back" size={15} color="navDim" />
        </Pressable>
      ) : null}
      <View style={[styles.center, { paddingTop: insets.top, paddingBottom: modal ? insets.bottom : navSpace }]}>
        <VText variant="eyebrow" align="center">
          {eyebrow ?? 'THE VOID'}
        </VText>
        <VText variant="monument" align="center" style={styles.title} color={media ? '#f4f0ff' : undefined}>
          {title}
        </VText>
        {body ? (
          <VText variant="micro" align="center" style={styles.body}>
            {body}
          </VText>
        ) : null}
      </View>
    </Backdrop>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26 },
  title: { marginTop: 12 },
  body: { marginTop: 14 },
  back: { position: 'absolute', left: 20, zIndex: 2, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
});
