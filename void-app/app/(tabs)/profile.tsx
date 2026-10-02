// Own profile (no handle param).
import React from "react";
import { useSwitchTiming } from '../../src/nav/switchTiming';
import ProfileScreen from "../../src/features/profile/ProfileScreen";

export default function ProfileTab() {
  useSwitchTiming('profile');
  return <ProfileScreen />;
}
