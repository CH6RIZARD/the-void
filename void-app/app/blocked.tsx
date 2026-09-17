import React from "react";
import { router } from "expo-router";
import BlockedAccountsScreen from "../src/features/settings/BlockedAccountsScreen";

export default function BlockedRoute() {
  return <BlockedAccountsScreen onClose={() => (router.canGoBack() ? router.back() : router.replace("/void"))} />;
}
