// Settings → Body signals: ONE row, one sheet. Replaces the first-launch consent wall
// (src/ConsentScreen.tsx, deleted).
//
//   Settings row "Body signals · On/Off"  →  sheet with three switches:
//     How you hold and scroll   on by default — no OS permission, nothing biometric
//     Camera: attention & pulse off — front-camera estimates + the fingertip reading
//                                     (same sensor, same purpose, one switch)
//     Heart-rate strap          off — a paired Bluetooth strap or watch
//
// Flipping a switch IS the consent: it is off by default, the description sits next to
// it, and "What's measured" holds the full reviewed notice. That keeps consent explicit,
// specific and revocable per signal (GDPR Art. 9 / BIPA / CUBI) without a wall or a
// second pop-up. The OS permission prompt follows the switch.
//
// [HUMAN GATE] final wording still needs legal review before store submission.
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
import { MiniIcon, Toggle } from './vmod';

type Signal = {
  key: 'behaviour' | 'camera' | 'ble';
  tiers: Sensing.SensorTier[];
  label: string;
  line: string;
  permission?: string;
  details: string;
};

const SIGNALS: Signal[] = [
  {
    key: 'behaviour',
    tiers: ['motion', 'touch'],
    label: 'How you hold and scroll',
    line: 'Scroll speed, pauses, taps and how still the phone is. No permission needed.',
    details: 'Scroll speed, pauses, taps and how still your phone is. No extra permission. We never read what you type.',
  },
  {
    key: 'camera',
    tiers: ['face', 'ppg'],
    label: 'Camera: attention and pulse',
    line: 'Front camera while the feed is open, and the fingertip reading you start yourself.',
    permission: 'Camera',
    details:
      'While the feed is open, the front camera estimates blinks, whether you are looking at the screen, smiles, and a rough pulse from skin colour. ' +
      'Frames are processed in memory and never saved or uploaded. The camera light will show while it runs. ' +
      'The fingertip reading is separate and only runs when you start it: cover the rear camera and flash for 30 seconds to measure heart rate and ' +
      'heart-rate variability, which calibrates the estimate.',
  },
  {
    key: 'ble',
    tiers: ['ble'],
    label: 'Heart-rate strap or watch',
    line: 'Reads a paired Bluetooth strap or watch while the app is open.',
    permission: 'Bluetooth',
    details: 'If you pair a chest strap or watch that broadcasts heart rate, we read it while the app is open.',
  },
];

const DATA_NOTICE = [
  'Everything is processed on your phone. Camera frames, motion and heart-rate readings are never stored or sent anywhere. Only a few rounded, noise-added scores (attention, arousal, mood) reach the feed ranking on this device. They are never used for advertising or sold.',
  'These are estimates, not a medical device. Do not use them for health decisions.',
  "You can turn any of these off at any time here, and withdraw camera or Bluetooth access in your phone's settings.",
];

const isOn = (perTier: Record<Sensing.SensorTier, boolean>, tiers: Sensing.SensorTier[]) => tiers.some((t) => perTier[t]);

function SignalRow({ signal, on, busy, onToggle }: { signal: Signal; on: boolean; busy: boolean; onToggle: () => void }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={[st.item, { borderColor: colors.hairline }]}>
      <View style={st.itemTop}>
        <View style={{ flex: 1 }}>
          <VText style={{ fontFamily: FONTS.sansSemiBold, fontSize: 13.5, color: colors.white }}>{signal.label}</VText>
          {/* Its own line: inline, the tag wrapped mid-phrase ("ASKS" / "FOR BLUETOOTH"). */}
          {signal.permission ? (
            <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.14), color: colors.purple, marginTop: 3 }}>{`ASKS FOR ${signal.permission.toUpperCase()}`}</VText>
          ) : null}
          <VText style={{ fontFamily: FONTS.sans, fontSize: 11.5, lineHeight: 11.5 * 1.45, color: colors.dim, marginTop: 4 }}>{signal.line}</VText>
        </View>
        <Toggle on={on} onPress={busy ? () => {} : onToggle} />
      </View>
      <Pressable onPress={() => setOpen((o) => !o)} hitSlop={8} style={st.more}>
        <VText style={{ fontFamily: FONTS.mono, fontSize: 7.5, letterSpacing: em(7.5, 0.2), color: colors.gold }}>{open ? 'HIDE' : "WHAT'S MEASURED"}</VText>
      </Pressable>
      {open ? (
        <VText style={{ fontFamily: FONTS.sans, fontSize: 11.5, lineHeight: 11.5 * 1.5, color: colors.dim, marginTop: 6 }}>{signal.details}</VText>
      ) : null}
    </View>
  );
}

function BodySignalsSheet({ sensing, onClose }: { sensing: SensingApi; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const perTier = sensing.consent.perTier;
  const granted = () => (Object.keys(perTier) as Sensing.SensorTier[]).filter((t) => perTier[t]);

  const toggle = async (s: Signal) => {
    if (busy) return;
    setBusy(true);
    try {
      const want = isOn(perTier, s.tiers)
        ? granted().filter((t) => !s.tiers.includes(t))
        : Array.from(new Set([...granted(), ...s.tiers]));
      const state = await sensing.setTiers(want);
      // A tier the OS refused stays off; say so instead of leaving a dead switch.
      if (!isOn(perTier, s.tiers) && !isOn(state.perTier, s.tiers) && s.permission) voidToast(`${s.permission.toUpperCase()} PERMISSION NEEDED`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={st.scrim} onPress={onClose} />
      <View style={[st.sheet, { backgroundColor: colors.bg2, paddingBottom: 18 + insets.bottom }]}>
        <View style={st.handle} />
        <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.28), color: colors.navDim }}>BODY SIGNALS · OPTIONAL</VText>
        <VText style={{ fontFamily: FONTS.serifItalic, fontSize: 21, lineHeight: 21 * 1.25, color: colors.white, marginTop: 8 }}>
          Tune the feed to how you react.
        </VText>
        <VText style={{ fontFamily: FONTS.sans, fontSize: 12, lineHeight: 12 * 1.5, color: colors.dim, marginTop: 8 }}>
          Each one is off until you turn it on, and off again the moment you turn it back.
        </VText>
        <ScrollView style={{ marginTop: 14, maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          {SIGNALS.map((s) => (
            <SignalRow key={s.key} signal={s} on={isOn(perTier, s.tiers)} busy={busy} onToggle={() => toggle(s)} />
          ))}
          {DATA_NOTICE.map((p, i) => (
            <VText key={i} style={{ fontFamily: FONTS.sans, fontSize: 11, lineHeight: 11 * 1.5, color: colors.muted, marginTop: i ? 8 : 14 }}>
              {p}
            </VText>
          ))}
        </ScrollView>
        <Pill variant="ghost" label="DONE" onPress={onClose} style={{ marginTop: 14 }} />
      </View>
    </Modal>
  );
}

/** The single Settings row + its sheet. */
export function BodySignalsSection({ sensing, Row }: { sensing: SensingApi | null; Row: React.ComponentType<{ label: string; sub?: string; children?: React.ReactNode; onPress?: () => void }> }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  if (!sensing) return <Row label="Body signals" sub="Unavailable on this build" />;
  const on = SIGNALS.filter((s) => isOn(sensing.consent.perTier, s.tiers));
  const sub = on.length === 0 ? 'Off' : on.length === SIGNALS.length ? 'On · all signals' : `On · ${on.map((s) => (s.key === 'behaviour' ? 'hold and scroll' : s.key === 'camera' ? 'camera' : 'heart rate')).join(', ')}`;
  return (
    <>
      <Row label="Body signals" sub={sub} onPress={() => setOpen(true)}>
        <MiniIcon name="chev" size={15} color={colors.dim} />
      </Row>
      {open ? <BodySignalsSheet sensing={sensing} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const st = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 32, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', marginBottom: 14 },
  item: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 10 },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  more: { alignSelf: 'flex-start', marginTop: 8 },
});
