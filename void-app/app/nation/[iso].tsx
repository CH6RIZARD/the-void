// Nation dossier (src/features/nation). Pushed by the globe as /nation/<ISO> (upper case).
import React from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import NationScreen from "../../src/features/nation/NationScreen";
import { ModerationHost } from "../../src/features/feed/ModerationSheet";

export default function NationRoute() {
  const { iso } = useLocalSearchParams<{ iso: string }>();
  return (
    <View style={{ flex: 1 }}>
      <NationScreen iso={decodeURIComponent(String(iso ?? ""))} />
      <ModerationHost />
    </View>
  );
}
