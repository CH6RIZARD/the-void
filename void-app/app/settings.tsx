import React from "react";
import { router } from "expo-router";
import SettingsScreen from "../src/features/settings/SettingsScreen";

export default function SettingsRoute() {
  return <SettingsScreen onClose={() => (router.canGoBack() ? router.back() : router.replace("/void"))} />;
}
