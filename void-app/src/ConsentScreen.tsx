import { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Switch } from "react-native";
import * as Sensing from "../modules/expo-void-sensing";

/**
 * First-launch consent for body signals. Shown until the user makes a choice
 * (`hasChosen`). Copy must stay in sync with the privacy policy.
 *
 * [HUMAN GATE] Have the final wording reviewed (GDPR Art.9 explicit consent, BIPA /
 * CUBI / MHMDA notices) before store submission.
 */

type TierRow = {
  tiers: Sensing.SensorTier[];
  key: string;
  title: string;
  body: string;
  permission?: string;
};

const ROWS: TierRow[] = [
  {
    key: "behaviour",
    tiers: ["motion", "touch"],
    title: "How you hold and scroll",
    body:
      "Scroll speed, pauses, taps and how still your phone is. No extra permission. " +
      "We never read what you type.",
  },
  {
    key: "face",
    tiers: ["face"],
    title: "Front camera: attention and pulse estimate",
    body:
      "While the feed is open, the front camera estimates blinks, whether you are looking " +
      "at the screen, smiles, and a rough pulse from skin colour. Frames are processed in " +
      "memory and never saved or uploaded. The camera light will show while it runs.",
    permission: "Camera",
  },
  {
    key: "ppg",
    tiers: ["ppg"],
    title: "Fingertip calm reading",
    body:
      "Only when you start it: cover the rear camera and flash with a fingertip for 30 " +
      "seconds to measure heart rate and heart-rate variability. Used to calibrate the " +
      "estimate.",
    permission: "Camera",
  },
  {
    key: "ble",
    tiers: ["ble"],
    title: "Bluetooth heart-rate strap or watch",
    body:
      "If you pair a chest strap or watch that broadcasts heart rate, we read it while the " +
      "app is open.",
    permission: "Bluetooth",
  },
];

export function ConsentScreen({ onDone }: { onDone: (s: Sensing.ConsentState) => void }) {
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState<Record<string, boolean>>({
    behaviour: true,
    face: false,
    ppg: false,
    ble: false,
  });

  const selectedTiers = (): Sensing.SensorTier[] =>
    ROWS.filter((r) => on[r.key]).flatMap((r) => r.tiers);

  const enable = async () => {
    const tiers = selectedTiers();
    if (tiers.length === 0) {
      notNow();
      return;
    }
    setBusy(true);
    try {
      // Requests the OS permissions for the chosen tiers, then records consent.
      const state = await Sensing.requestConsent(tiers);
      onDone(state);
    } catch {
      onDone(Sensing.getConsent());
    } finally {
      setBusy(false);
    }
  };

  const notNow = () => {
    Sensing.chooseNonBiometric().then(onDone);
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.logo}>THE VOID</Text>
      <Text style={styles.h}>Body signals (optional)</Text>
      <Text style={styles.p}>
        The Void can tune your feed to how you respond to posts, using signals from your phone.
        Choose what to allow:
      </Text>

      {ROWS.map((r) => (
        <View key={r.key} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>
              {r.title}
              {r.permission ? <Text style={styles.perm}>{`  · asks for ${r.permission}`}</Text> : null}
            </Text>
            <Text style={styles.rowBody}>{r.body}</Text>
          </View>
          <Switch
            value={!!on[r.key]}
            onValueChange={(v) => setOn((prev) => ({ ...prev, [r.key]: v }))}
            trackColor={{ false: "#1a1232", true: "#5b21d4" }}
            thumbColor="#f4f0ff"
            disabled={busy}
          />
        </View>
      ))}

      <Text style={styles.h2}>What happens to the data</Text>
      <Text style={styles.p}>
        <Text style={styles.b}>Everything is processed on your phone.</Text> Camera frames,
        motion and heart-rate readings are never stored or sent anywhere. Only a few rounded,
        noise-added scores (attention, arousal, mood) reach the feed ranking on this device.
        They are never used for advertising or sold.
      </Text>
      <Text style={styles.p}>
        These are <Text style={styles.b}>estimates, not a medical device</Text>. Do not use them
        for health decisions.
      </Text>
      <Text style={styles.p}>
        You can turn body signals off at any time in Settings → Body signals, and withdraw camera
        or Bluetooth access in your phone's settings.
      </Text>

      <Pressable
        style={[styles.btn, styles.primary, busy && styles.dim]}
        disabled={busy}
        onPress={enable}
      >
        <Text style={styles.btnT}>{busy ? "Turning on…" : "Turn on body signals"}</Text>
      </Pressable>
      <Pressable style={[styles.btn, styles.ghost]} disabled={busy} onPress={notNow}>
        <Text style={styles.ghostT}>Not now</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 24, paddingTop: 72, paddingBottom: 48, backgroundColor: "#04020c", flexGrow: 1 },
  logo: { color: "#f4f0ff", fontSize: 22, fontWeight: "800", letterSpacing: 3, marginBottom: 20 },
  h: { color: "#c9a84c", fontSize: 16, fontWeight: "700", marginBottom: 10 },
  h2: { color: "#c9a84c", fontSize: 14, fontWeight: "700", marginTop: 18, marginBottom: 8 },
  p: { color: "#b9aee0", fontSize: 13, lineHeight: 20, marginBottom: 10 },
  b: { color: "#f4f0ff", fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#1a1232",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  rowText: { flex: 1, paddingRight: 10 },
  rowTitle: { color: "#f4f0ff", fontSize: 13, fontWeight: "700", marginBottom: 4 },
  perm: { color: "#6a58a0", fontSize: 11, fontWeight: "600" },
  rowBody: { color: "#9d92c4", fontSize: 12, lineHeight: 17 },
  btn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 10 },
  primary: { backgroundColor: "#5b21d4" },
  dim: { opacity: 0.6 },
  ghost: { borderWidth: 1, borderColor: "#1a1232" },
  btnT: { color: "#fff", fontWeight: "700", fontSize: 14 },
  ghostT: { color: "#b9aee0", fontWeight: "600", fontSize: 13 },
});
