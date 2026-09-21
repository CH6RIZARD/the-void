// "Has this install been through Jump In?" — decides the cold-start route and when
// the body-signal consent sheet may appear (it used to cover the whole first launch).
//
// void_signed_in can't answer this: bootCore signs every fresh install in
// anonymously before any UI. And installs from before this flow existed must not be
// marched through it on update, so an install that has already made the consent
// choice, or has learned anything at all, counts as onboarded.
import { env } from '../../core';
import * as Sensing from '../../../modules/expo-void-sensing';
import { flushWrites } from '../../lib/core';

export const ONBOARDED_KEY = 'void_onboarded';

export function isOnboarded(): boolean {
  try {
    if (env.storage.getItem(ONBOARDED_KEY) === '1') return true;
    const legacy = !!env.storage.getItem('void_bio') || Sensing.getConsent().hasChosen;
    if (legacy) env.storage.setItem(ONBOARDED_KEY, '1');
    return legacy;
  } catch {
    return true; // storage unavailable: never trap anyone in onboarding
  }
}

export function markOnboarded(): void {
  try {
    env.storage.setItem(ONBOARDED_KEY, '1');
  } catch {}
  flushWrites().catch(() => {});
}
