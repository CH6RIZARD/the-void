import { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import * as Sensing from "../modules/expo-void-sensing";

/**
 * [HUMAN GATE / T1.9] Consent copy below is a PLACEHOLDER and MUST be replaced with
 * legal-reviewed wording before store submission:
 *  - GDPR Art.9 explicit, unbundled opt-in (separate from ToS)
 *  - EU AI Act Art.50 transparency: emotional/physiological state is INFERRED
 *  - Illinois BIPA written-release flow + retention/destruction schedule; Texas CUBI notice
 *  - Washington MHMDA: opt-in, no sale (covers inferred health data)
 *  - Apple 5.1.3(vi): never used for ads/monetization
 *  - DSA Art.38 posture: a one-tap non-biometric feed is always offered (below)
 */
export function ConsentScreen({ onDone }: { onDone: (s: Sensing.ConsentState) => void }) {
  const [busy, setBusy] = useState(false);

  const enableBiometric = async () => {
    setBusy(true);
    try {
      const state = await Sensing.requestConsent(["motion", "touch", "ppg", "face", "health"]);
      onDone(state);
    } finally {
      setBusy(false);
    }
  };

  const nonBiometric = () => {
    // Always-available non-biometric path (DSA Art.38). We simply decline affect
    // consent — emit() already returns null without consent, so no sensing runs.
    // (We intentionally do NOT touch the global kill-switch here: that is a separate
    // remote/local override, not a per-user feed choice.)
    onDone({ affectConsent: false, nonBiometricFeed: true, perTier: {
      motion: false, touch: false, ppg: false, face: false, health: false } });
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.logo}>THE VOID</Text>
      <Text style={styles.h}>Affect-aware feed (optional)</Text>
      <Text style={styles.p}>
        The Void can personalize your feed using an <Text style={styles.b}>inferred</Text> estimate
        of your emotional/physiological state, computed <Text style={styles.b}>entirely on your
        device</Text> from motion, touch, camera heart-rate, and (optional) face and Health data.
      </Text>
      <Text style={styles.p}>
        Raw sensor data <Text style={styles.b}>never leaves your phone</Text>. Only a small
        anonymized, privacy-protected summary is used, and it is <Text style={styles.b}>never used
        for advertising</Text> or sold. You can turn this off any time in Settings.
      </Text>
      <Text style={styles.legal}>
        [Placeholder — pending legal review: BIPA written release, retention/destruction schedule,
        GDPR Art.9 / EU AI Act Art.50 disclosures. Do not ship without sign-off.]
      </Text>
      <Pressable style={[styles.btn, styles.primary]} disabled={busy} onPress={enableBiometric}>
        <Text style={styles.btnT}>I explicitly consent — enable affect-aware feed</Text>
      </Pressable>
      <Pressable style={[styles.btn, styles.ghost]} onPress={nonBiometric}>
        <Text style={styles.ghostT}>Use the non-biometric feed instead</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 24, paddingTop: 80, backgroundColor: "#04020c", flexGrow: 1 },
  logo: { color: "#f4f0ff", fontSize: 22, fontWeight: "800", letterSpacing: 3, marginBottom: 24 },
  h: { color: "#c9a84c", fontSize: 15, fontWeight: "700", marginBottom: 12 },
  p: { color: "#b9aee0", fontSize: 13, lineHeight: 20, marginBottom: 12 },
  b: { color: "#f4f0ff", fontWeight: "700" },
  legal: { color: "#6a58a0", fontSize: 10, lineHeight: 15, marginVertical: 16, fontStyle: "italic" },
  btn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 10 },
  primary: { backgroundColor: "#5b21d4" },
  ghost: { borderWidth: 1, borderColor: "#1a1232" },
  btnT: { color: "#fff", fontWeight: "700", fontSize: 13 },
  ghostT: { color: "#b9aee0", fontWeight: "600", fontSize: 13 },
});
