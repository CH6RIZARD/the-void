// Jump In, screen 4: what should reach you first. Shown only to new cards
// (anonymous included); a login goes straight to Lit.
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RadialFill } from '../../ui/Surface';
import { FONTS, em, type RadialSpec } from '../../theme/palettes';
import { VText } from '../../ui/Text';
import { t, TOPICS, type Topic } from './copy';
import { PLACES, type LivePlace } from './places';
import { CTA, Enter, Mono, Rule, Serif, useOb } from './parts';

/** radial-gradient(120% 50% at 50% 0%, #0e0726 0%, #04020c 60%) */
const BG: RadialSpec = { rx: 120, ry: 50, cx: 50, cy: 0, stops: [{ color: '#0e0726', offset: 0 }, { color: '#04020c', offset: 0.6 }] };

function Chip({ on, onPress, children }: { on: boolean; onPress: () => void; children: React.ReactNode }) {
  const ob = useOb();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      style={[
        s.chip,
        on
          ? { backgroundColor: 'rgba(201,168,76,0.14)', boxShadow: '0px 0px 0px 1px rgba(201,168,76,0.6)' }
          : { backgroundColor: ob.isLight ? ob.PANEL : 'rgba(13,8,32,0.95)', boxShadow: `inset 0px 1px 0px ${ob.isLight ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.06)'}` },
      ]}
    >
      {children}
    </Pressable>
  );
}

export function Ignite({
  topics,
  places,
  onToggleTopic,
  onTogglePlace,
  onIgnite,
}: {
  topics: Topic[];
  places: LivePlace[];
  onToggleTopic: (t: Topic) => void;
  onTogglePlace: (p: LivePlace) => void;
  onIgnite: () => void;
}) {
  const insets = useSafeAreaInsets();
  const ob = useOb(), { GOLD, WHITE, DIM } = ob;
  const n = topics.length + places.length;
  const line = n === 0 ? t('s4.headline.0') : n < 3 ? t('s4.headline.1to2') : t('s4.headline.3plus');
  const chipText = (on: boolean) => ({ fontFamily: FONTS.serifItalic, fontSize: 16, color: on ? GOLD : WHITE });
  return (
    <Enter style={[StyleSheet.absoluteFill, { backgroundColor: ob.BG }]}>
      <RadialFill spec={ob.isLight ? { ...BG, stops: [{ color: ob.HI, offset: 0 }, { color: ob.BG, offset: 0.6 }] } : BG} />
      <View style={[s.page, { paddingTop: 78 + insets.top, paddingBottom: 46 + insets.bottom }]}>
        <Mono color={DIM}>{t('s4.eyebrow', { n })}</Mono>
        <Serif size={30} style={{ marginTop: 12 }}>
          {line}
        </Serif>
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollIn} showsVerticalScrollIndicator={false}>
          <Rule label={t('s4.section.signal')} />
          <View style={s.wrap}>
            {TOPICS.map((tp) => {
              const on = topics.includes(tp);
              return (
                <Chip key={tp} on={on} onPress={() => onToggleTopic(tp)}>
                  <VText style={chipText(on)}>{tp}</VText>
                </Chip>
              );
            })}
          </View>
          <View style={{ height: 26 }} />
          <Rule label={t('s4.section.places')} right={t('s4.section.live')} />
          <View style={s.wrap}>
            {PLACES.map((p) => {
              const on = places.some((x) => x.city === p.city);
              return (
                <Chip key={p.city} on={on} onPress={() => onTogglePlace(p)}>
                  <View style={s.dot} />
                  <VText style={chipText(on)}>{p.city}</VText>
                  <VText style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.12), color: on ? GOLD : DIM }}>{p.iso}</VText>
                </Chip>
              );
            })}
          </View>
        </ScrollView>
        <CTA label={n === 0 ? t('s4.cta.empty') : t('s4.cta.filled')} onPress={onIgnite} ghost={n === 0} />
      </View>
    </Enter>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 28 },
  scroll: { flex: 1, marginTop: 20, marginHorizontal: -28 },
  scrollIn: { paddingHorizontal: 28, paddingBottom: 20 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#ef4444' },
});
