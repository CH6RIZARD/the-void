// Tab entry: wraps the screen so the switch timing probe can report how long this
// tab took to gain focus after the press (src/nav/switchTiming).
import React from 'react';
import Screen from '../../src/features/feed/VoidFeedScreen';
import { useSwitchTiming } from '../../src/nav/switchTiming';

export default function Tab() {
  useSwitchTiming('void');
  return <Screen />;
}
