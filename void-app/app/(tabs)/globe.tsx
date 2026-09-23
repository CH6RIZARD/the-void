// Globe tab: Agent C's GlobeScreen (src/features/globe). bottomInset clears the floating nav pill.
import React from 'react';
import { useSwitchTiming } from '../../src/nav/switchTiming';
import GlobeScreen from '../../src/features/globe/GlobeScreen';
import { useBottomNavSpace } from '../../src/nav/layout';

export default function GlobeTab() {
  useSwitchTiming('globe');
  const bottomInset = useBottomNavSpace();
  return <GlobeScreen bottomInset={bottomInset} />;
}
