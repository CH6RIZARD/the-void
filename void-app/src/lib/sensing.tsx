// Body-signal sensing lifecycle (was the WebView bridge in the old App.tsx).
// The native module is modules/expo-void-sensing; the consent UI is src/ConsentScreen.tsx.
//
//   const s = useSensing();
//   s.affect            latest quantized AffectState (or null)
//   s.setFeedVisible(v) front-camera sensing only runs while the feed is visible + foreground
//   s.markImpression(impressionId, itemId)
//   s.openConsent()     show the consent screen again (Settings)
//   s.setKillSwitch(on) body signals on/off (persisted natively)
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import * as Sensing from '../../modules/expo-void-sensing';
import { ConsentScreen } from '../ConsentScreen';

export interface SensingApi {
  native: boolean;
  consent: Sensing.ConsentState;
  sensingOn: boolean;
  affect: Sensing.AffectState | null;
  consentOpen: boolean;
  openConsent: () => void;
  setKillSwitch: (on: boolean) => void;
  setFeedVisible: (visible: boolean) => void;
  markImpression: (impressionId: string, itemId: string) => void;
  recordTouch: (samples: Sensing.TouchSample[]) => void;
}

const SensingContext = createContext<SensingApi | null>(null);

export function SensingProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<Sensing.ConsentState>(() => Sensing.getConsent());
  const [consentOpen, setConsentOpen] = useState<boolean>(() => !Sensing.getConsent().hasChosen);
  const [sensingOn, setSensingOn] = useState<boolean>(() => Sensing.isKillSwitchEnabled());
  const [affect, setAffect] = useState<Sensing.AffectState | null>(null);
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

  useEffect(() => {
    const sub = Sensing.addAffectListener((s) => setAffect(s));
    return () => sub.remove();
  }, []);

  // The front camera must never run while the app is backgrounded.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      Sensing.setFeedVisible(st === 'active' ? feedVisibleRef.current : false);
    });
    return () => sub.remove();
  }, []);

  const onConsentDone = useCallback((state: Sensing.ConsentState) => {
    setConsent(state);
    setConsentOpen(false);
  }, []);

  const api = useMemo<SensingApi>(
    () => ({
      native: Sensing.hasNativeSensing(),
      consent,
      sensingOn,
      affect,
      consentOpen,
      openConsent: () => setConsentOpen(true),
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
    [consent, sensingOn, affect, consentOpen],
  );

  return (
    <SensingContext.Provider value={api}>
      {children}
      {consentOpen ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay]}>
          <ConsentScreen onDone={onConsentDone} />
        </View>
      ) : null}
    </SensingContext.Provider>
  );
}

export function useSensing(): SensingApi {
  const ctx = useContext(SensingContext);
  if (!ctx) throw new Error('useSensing must be used inside <SensingProvider>');
  return ctx;
}

export { Sensing };

const styles = StyleSheet.create({
  overlay: { backgroundColor: '#04020c', zIndex: 400 },
});
