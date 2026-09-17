// Composer: transparent modal; ComposerSheet renders its own <Sheet>.
import React from "react";
import { router } from "expo-router";
import ComposerSheet from "../src/features/composer/ComposerSheet";

export default function ComposerRoute() {
  return <ComposerSheet onClosed={() => (router.canGoBack() ? router.back() : router.replace("/void"))} />;
}
