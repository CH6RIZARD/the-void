// Jump In, screen 2: the globe and what it means.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RadialFill } from '../../ui/Surface';
import type { RadialSpec } from '../../theme/palettes';
import { t } from './copy';
import { OnboardGlobe } from './OnboardGlobe';
import { CTA, DIM, Enter, LAV, Mono, Serif } from './parts';
import { VText } from '../../ui/Text';
import { FONTS } from '../../theme/palettes';

/** radial-gradient(90% 55% at 50% 100%, #160a3a 0%, #04020c 75%) */
const HORIZON: RadialSpec = { rx: 90, ry: 55, cx: 50, cy: 100, stops: [{ color: '#160a3a', offset: 0 }, { color: '#04020c', offset: 0.75 }] };

export function GlobeIntro({ onNext }: { onNext: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Enter style={[StyleSheet.absoluteFill, { backgroundColor: '#04020c' }]}>
      <View style={s.globeBox}>
        <RadialFill spec={HORIZON} />
        <View style={s.globeInner}>
          <OnboardGlobe />
        </View>
        <LinearGradient colors={['transparent', 'rgba(201,168,76,0.55)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.horizon} pointerEvents="none" />
        <Mono size={7.5} tracking={0.25} color={LAV} style={s.hint}>
          {t('s2.hint')}
        </Mono>
      </View>
      <View style={[s.copy, { paddingBottom: 46 + insets.bottom }]}>
        <Mono color={DIM}>{t('s2.eyebrow')}</Mono>
        <Serif size={30}>{t('s2.headline')}</Serif>
        <VText style={{ fontFamily: FONTS.sans, fontSize: 13, lineHeight: 13 * 1.5, color: LAV }}>{t('s2.body')}</VText>
        <View style={{ flex: 1 }} />
        <CTA label={t('s2.cta')} onPress={onNext} />
      </View>
    </Enter>
  );
}

const s = StyleSheet.create({
  globeBox: { height: '50%', overflow: 'hidden' },
  // left/right -6%: the globe is a touch wider than the screen, as in the mock.
  globeInner: { position: 'absolute', left: '-6%', right: '-6%', top: 0, bottom: 0 },
  horizon: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1 },
  hint: { position: 'absolute', left: 0, right: 0, bottom: 10, textAlign: 'center' },
  copy: { flex: 1, paddingTop: 26, paddingHorizontal: 28, gap: 12 },
});
