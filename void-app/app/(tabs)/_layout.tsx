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
      // Inactive screens stay ATTACHED. Detaching them tears down their native views
      // on every tab switch, and for the globe that destroys the GL surface: coming
      // back creates a new one, expo-gl looks the context up in global.__EXGLContexts,
      // gets undefined and throws inside its own onSurfaceCreate - a JS crash that
      // takes the app down (seen on device 09-23 12:24, configureLogging/_onSurfaceCreate).
      // It is also why switching tabs rebuilt whole view trees instead of showing one
      // that was already there.
      detachInactiveScreens={false}
      tabBar={(props) => <BottomNav {...props} />}
      // freezeOnBlur OFF (09-23). Freezing a hidden tab means RETURNING to it re-renders
      // the whole screen - on this phone that was seconds of blocked input per switch,
      // and the feed was the worst of them. The screens already stop their own work when
      // they lose focus (GlobeScreen parks the wall, loaders stop ticking, players are
      // released), so freezing bought little and cost the switch.
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg }, lazy: true, animation: 'none', freezeOnBlur: false }}
    >
      <Tabs.Screen name="void" />
      {/* The globe stays dark in every theme (media surface). It is NOT frozen: its
          players and render loop are shut down by its own blur handling (GlobeScreen,
          LiveWall sleep), which takes a few renders that a freeze could cut short. */}
      <Tabs.Screen name="globe" options={{ sceneStyle: { backgroundColor: '#05020e' }, freezeOnBlur: false }} />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="messages" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
