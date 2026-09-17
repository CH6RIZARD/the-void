// Full-screen reels: /reels, /reels?nation=ISO, /reels?nation=ISO&post=<id>, /reels?post=<id>.
import React from "react";
import { useIsFocused, useLocalSearchParams } from "expo-router";
import { ReelsView } from "../src/features/reels/ReelsView";

export default function ReelsRoute() {
  const params = useLocalSearchParams<{ nation?: string; post?: string }>();
  const active = useIsFocused();
  const nation = params.nation ? decodeURIComponent(String(params.nation)) : undefined;
  const postId = params.post ? decodeURIComponent(String(params.post)) : undefined;
  return <ReelsView active={active} nation={nation} postId={postId} />;
}
