// Body-signal sensing lifecycle (was the WebView bridge in the old App.tsx).
// The native module is modules/expo-void-sensing; consent lives in Settings → Body signals
// (src/features/settings/BodySignals.tsx). There is no first-launch consent screen: the
// non-biometric tier (how you hold and scroll — no OS permission) is on by default and
// can be switched off; camera / fingertip / Bluetooth tiers stay off until the person
// switches one on and ticks its consent box.
//
//   const s = useSensing();
//   BIO.affect          latest quantized AffectState (or null) - not React state, see below
//   s.setFeedVisible(v) front-camera sensing only runs while the feed is visible + foreground
//   s.markImpression(impressionId, itemId)
//   s.setTiers(tiers)   record consent for exactly these tiers (asks OS permissions)
//   s.setKillSwitch(on) body signals on/off (persisted natively)
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Sensing from '../../modules/expo-void-sensing';
import { BIO } from '../core';

export interface SensingApi {
  native: boolean;
  consent: Sensing.ConsentState;
  sensingOn: boolean;

  /** Record consent for EXACTLY these tiers; resolves to the resulting state. */
  setTiers: (tiers: Sensing.SensorTier[]) => Promise<Sensing.ConsentState>;
  setKillSwitch: (on: boolean) => void;
  setFeedVisible: (visible: boolean) => void;
  markImpression: (impressionId: string, itemId: string) => void;
  recordTouch: (samples: Sensing.TouchSample[]) => void;
}

const SensingContext = createContext<SensingApi | null>(null);

export function SensingProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<Sensing.ConsentState>(() => Sensing.getConsent());
  const [sensingOn, setSensingOn] = useState<boolean>(() => Sensing.isKillSwitchEnabled());

  const feedVisibleRef = useRef(false);

  // Run the native pipeline while affect consent is granted and body signals are on.
  useEffect(() => {
    if (!consent.affectConsent || !sensingOn) return;
    Sensing.start().catch(() => {});
    Sensing.setFeedVisible(feedVisibleRef.current && AppState.currentState === 'active');
    return () => {
      Sensing.setFeedVisible(false);
      Sensing.stop().catch(() => {});
    };
  }, [consent.affectConsent, sensingOn]);

  // Kept out of React state. This provider sits above the whole app, so a setState
  // here gave the context a new value and walked the app's tree on every event (up
  // to one every 2s) for a value no screen reads. BIO.affect is the slot the web
  // bridge writes to; anything that wants it reads it there.
  useEffect(() => {
    const sub = Sensing.addAffectListener((s) => BIO.setAffect(s));
    return () => sub.remove();
  }, []);

  // The front camera must never run while the app is backgrounded.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      Sensing.setFeedVisible(st === 'active' ? feedVisibleRef.current : false);
    });
    return () => sub.remove();
  }, []);

  // First run: the behavioural tier (motion + touch — no permission, nothing biometric)
  // starts on, disclosed in Settings and the privacy policy. Nothing else is granted.
  useEffect(() => {
    if (Sensing.getConsent().hasChosen) return;
    Sensing.requestConsent(['motion', 'touch'])
      .then(setConsent)
      .catch(() => {});
  }, []);

  const setTiers = useCallback(async (tiers: Sensing.SensorTier[]) => {
    let state: Sensing.ConsentState;
    try {
      state = await Sensing.requestConsent(tiers);
    } catch {
      state = Sensing.getConsent();
    }
    setConsent(state);
    return state;
  }, []);

  const api = useMemo<SensingApi>(
    () => ({
      native: Sensing.hasNativeSensing(),
      consent,
      sensingOn,
      setTiers,
      setKillSwitch: (on) => {
        Sensing.setKillSwitch(on);
        setSensingOn(on);
        setConsent(Sensing.getConsent());
      },
      setFeedVisible: (visible) => {
        feedVisibleRef.current = visible;
        Sensing.setFeedVisible(visible && AppState.currentState === 'active');
      },
      markImpression: (impressionId, itemId) => Sensing.markImpression(impressionId, itemId),
      recordTouch: (samples) => Sensing.recordTouch(samples),
    }),
    [consent, sensingOn, setTiers],
  );

  return (
    <SensingContext.Provider value={api}>
      {children}
    </SensingContext.Provider>
  );
}

export function useSensing(): SensingApi {
  const ctx = useContext(SensingContext);
  if (!ctx) throw new Error('useSensing must be used inside <SensingProvider>');
  return ctx;
}

export { Sensing };

