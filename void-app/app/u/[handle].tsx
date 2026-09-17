import React from "react";
import { useLocalSearchParams } from "expo-router";
import ProfileScreen from "../../src/features/profile/ProfileScreen";

export default function UserRoute() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  return <ProfileScreen handle={decodeURIComponent(String(handle ?? ""))} />;
}
