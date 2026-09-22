// Settings → Body signals: one row per signal, and a one-checkbox consent sheet for
// the biometric ones. Replaces the first-launch consent wall (src/ConsentScreen.tsx).
//
//   How you hold and scroll  on by default — no OS permission, not biometric; can be
//                            switched off here.
//   Front camera / fingertip / heart-rate strap
//                            off until switched on here; switching on opens the sheet:
//                            one explicit checkbox, "What's measured" for the full
//                            notice, Allow / Not now — then the OS permission prompt.
//
// The notice text is the reviewed ConsentScreen copy, unchanged, one tap away instead of
// on a wall. [HUMAN GATE] still applies: have the final wording reviewed (GDPR Art.9
// explicit consent, BIPA / CUBI / MHMDA notices) before store submission.
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sensing from '../../../modules/expo-void-sensing';
import { useTheme } from '../../theme';
import { FONTS, em } from '../../theme/palettes';
import { VText } from '../../ui/Text';
import { Pill } from '../../ui/Pill';
import { voidToast } from '../../ui/Toast';
import type { SensingApi } from '../../lib/sensing';
import { Toggle } from './vmod';

type Kind = 'behaviour' | 'face' | 'ppg' | 'ble';

const SIGNALS: Array<{ kind: Kind; tiers: Sensing.SensorTier[]; label: string; sub: string; check: string; body: string; permission?: string }> = [
  {
    kind: 'behaviour',
    tiers: ['motion', 'touch'],
    label: 'How you hold and scroll',
    sub: 'Scroll speed, pauses, taps · no permission',
    check: '',
    body: 'Scroll speed, pauses, taps and how still your phone is. No extra permission. We never read what you type.',
  },
  {
    kind: 'face',
    tiers: ['face'],
    label: 'Front camera',
    sub: 'Attention and pulse estimate · asks for Camera',
    check: 'Tune my feed with the front camera',
    body:
      'While the feed is open, the front camera estimates blinks, whether you are looking at the screen, smiles, and a rough pulse from skin colour. ' +
      'Frames are processed in memory and never saved or uploaded. The camera light will show while it runs.',
    permission: 'Camera',
  },
  {
    kind: 'ppg',
    tiers: ['ppg'],
    label: 'Fingertip calm reading',
    sub: 'Heart rate and variability · asks for Camera',
    check: 'Measure my heart rate with a fingertip reading',
    body:
      'Only when you start it: cover the rear camera and flash with a fingertip for 30 seconds to measure heart rate and heart-rate variability. ' +
      'Used to calibrate the estimate.',
    permission: 'Camera',
  },
  {
    kind: 'ble',
    tiers: ['ble'],
    label: 'Heart-rate strap or watch',
    sub: 'Read while the app is open · asks for Bluetooth',
    check: 'Read heart rate from my paired strap or watch',
    body: 'If you pair a chest strap or watch that broadcasts heart rate, we read it while the app is open.',
    permission: 'Bluetooth',
  },
];

const DATA_NOTICE = [
  'Everything is processed on your phone. Camera frames, motion and heart-rate readings are never stored or sent anywhere. Only a few rounded, noise-added scores (attention, arousal, mood) reach the feed ranking on this device. They are never used for advertising or sold.',
  'These are estimates, not a medical device. Do not use them for health decisions.',
  "You can turn any of these off at any time here, and withdraw camera or Bluetooth access in your phone's settings.",
];

const isOn = (perTier: Record<Sensing.SensorTier, boolean>, tiers: Sensing.SensorTier[]) => tiers.every((t) => perTier[t]);

function ConsentSheet({ signal, onAllow, onClose }: { signal: (typeof SIGNALS)[number]; onAllow: () => void; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [checked, setChecked] = useState(false);
  const [details, setDetails] = useState(false);
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={st.scrim} onPress={onClose} />
      <View style={[st.sheet, { backgroundColor: colors.bg2, paddingBottom: 22 + insets.bottom }]}>
        <View style={st.handle} />
        <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.28), color: colors.navDim }}>BODY SIGNALS · OPTIONAL</VText>
        <VText style={{ fontFamily: FONTS.serifItalic, fontSize: 22, lineHeight: 22 * 1.25, color: colors.white, marginTop: 8 }}>{signal.label}</VText>

        {/* The consent itself: one explicit, unticked box. */}
        <Pressable onPress={() => setChecked((c) => !c)} style={st.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked }}>
          <View style={[st.box, { borderColor: checked ? colors.gold : colors.dim, backgroundColor: checked ? 'rgba(201,168,76,0.15)' : 'transparent' }]}>
            {checked ? <VText style={{ color: colors.gold, fontSize: 13, lineHeight: 15 }}>✓</VText> : null}
          </View>
          <VText style={{ flex: 1, fontFamily: FONTS.sans, fontSize: 13.5, lineHeight: 13.5 * 1.4, color: colors.white }}>
            {signal.check}
            <VText style={{ color: colors.dim }}>{' — processed on your phone, never saved'}</VText>
          </VText>
        </Pressable>

        <Pressable onPress={() => setDetails((d) => !d)} hitSlop={8}>
          <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.2), color: colors.gold, marginTop: 4 }}>
            {details ? 'HIDE DETAILS' : "WHAT'S MEASURED"}
          </VText>
        </Pressable>
        {details ? (
          <ScrollView style={{ maxHeight: 220, marginTop: 10 }}>
            {[signal.body, ...DATA_NOTICE].map((p, i) => (
              <VText key={i} style={{ fontFamily: FONTS.sans, fontSize: 12, lineHeight: 12 * 1.5, color: colors.dim, marginBottom: 8 }}>
                {p}
              </VText>
            ))}
          </ScrollView>
        ) : null}

        <Pill variant="gold" label={signal.permission ? `ALLOW · ASKS FOR ${signal.permission.toUpperCase()}` : 'ALLOW'} onPress={onAllow} disabled={!checked} style={{ marginTop: 18 }} />
        <Pill variant="ghost" label="NOT NOW" onPress={onClose} style={{ marginTop: 10 }} />
      </View>
    </Modal>
  );
}

export function BodySignalsSection({ sensing, Row }: { sensing: SensingApi | null; Row: React.ComponentType<{ label: string; sub?: string; children?: React.ReactNode }> }) {
  const [asking, setAsking] = useState<(typeof SIGNALS)[number] | null>(null);
  if (!sensing) {
    return <Row label="Body signals" sub="Unavailable on this build" />;
  }
  const perTier = sensing.consent.perTier;
  const granted = () => (Object.keys(perTier) as Sensing.SensorTier[]).filter((t) => perTier[t]);

  const turnOn = async (s: (typeof SIGNALS)[number]) => {
    const want = Array.from(new Set([...granted(), ...s.tiers]));
    const state = await sensing.setTiers(want);
    if (!isOn(state.perTier, s.tiers) && s.permission) voidToast(`${s.permission.toUpperCase()} PERMISSION NEEDED`);
  };
  const toggle = (s: (typeof SIGNALS)[number]) => {
    if (isOn(perTier, s.tiers)) {
      sensing.setTiers(granted().filter((t) => !s.tiers.includes(t)));
      return;
    }
    // Not biometric and needs no permission: no sheet.
    if (s.kind === 'behaviour') turnOn(s);
    else setAsking(s);
  };

  return (
    <>
      {SIGNALS.map((s) => (
        <Row key={s.kind} label={s.label} sub={s.sub}>
          <Toggle on={isOn(perTier, s.tiers)} onPress={() => toggle(s)} />
        </Row>
      ))}
      {asking ? (
        <ConsentSheet
          signal={asking}
          onClose={() => setAsking(null)}
          onAllow={() => {
            const s = asking;
            setAsking(null);
            turnOn(s);
          }}
        />
      ) : null}
    </>
  );
}

const st = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 32, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', marginBottom: 14 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 18, marginBottom: 10 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
});
