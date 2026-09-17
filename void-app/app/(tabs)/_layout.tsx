// The five tabs (patch3 §1 5a-B): void / globe / search / messages / profile.
import React, { useEffect } from 'react';
import { Tabs } from 'expo-router/js-tabs';
import { BottomNav } from '../../src/nav/BottomNav';
import { useTheme } from '../../src/theme/tokens';
import { startDmBadgePoll } from '../../src/features/messages/dmStore';

export default function TabsLayout() {
  const { colors } = useTheme();
  // Drives the DM unread dot on the nav (returns its stop function).
  useEffect(() => startDmBadgePoll(), []);
  return (
    <Tabs
      initialRouteName="void"
      backBehavior="history"
      tabBar={(props) => <BottomNav {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg }, lazy: true, animation: 'none' }}
    >
      <Tabs.Screen name="void" />
      {/* The globe stays dark in every theme (media surface). */}
      <Tabs.Screen name="globe" options={{ sceneStyle: { backgroundColor: '#05020e' } }} />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="messages" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
