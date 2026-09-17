import React from "react";
import { useLocalSearchParams } from "expo-router";
import ChatScreen from "../../src/features/messages/ChatScreen";

export default function ChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatScreen id={decodeURIComponent(String(id ?? ""))} />;
}
