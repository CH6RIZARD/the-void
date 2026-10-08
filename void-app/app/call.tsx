// Full-screen 1:1 call: /call?id=<conversation_id>&kind=audio|video. callStore
// already holds the call by the time this opens (ChatScreen dialled, or the
// incoming sheet accepted); a cold open with nothing ringing just closes.
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { CallScreen } from '../src/features/calls/CallScreen';

export default function CallRoute() {
  const params = useLocalSearchParams<{ id?: string; kind?: string }>();
  return <CallScreen conversationId={String(params.id || '')} kind={params.kind === 'video' ? 'video' : 'audio'} />;
}
