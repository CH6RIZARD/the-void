// Search tab (src/features/search) + the moderation sheet host for its post cards.
import React from "react";
import { useSwitchTiming } from '../../src/nav/switchTiming';
import { View } from "react-native";
import SearchScreen from "../../src/features/search/SearchScreen";
import { ModerationHost } from "../../src/features/feed/ModerationSheet";

export default function SearchTab() {
  useSwitchTiming('search');
  return (
    <View style={{ flex: 1 }}>
      <SearchScreen />
      <ModerationHost />
    </View>
  );
}
