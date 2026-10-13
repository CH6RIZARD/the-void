// The Jump In flow: Jump In → The Globe → The Signal Card → Ignite → Lit → the app.
// Shown on an install's first launch (index.tsx), and by Settings → Sign out, which
// opens it straight on the card in LOGIN mode (?mode=login).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { ROUTES } from '../../nav/routes';
import { t, type Topic } from './copy';
import { markOnboarded } from './flag';
import { RESUME_KEY } from './onboardAuth';
import { env } from '../../core';
import { seedFeed } from './seed';
import type { LivePlace } from './places';
import type { Via } from './onboardAuth';
import { JumpIn } from './JumpIn';
import { GlobeIntro } from './GlobeIntro';
import { CardGate } from './CardGate';
import { Ignite } from './Ignite';
import { Enter, Mono, Serif, useOb } from './parts';
import { VText } from '../../ui/Text';

type Step = 0 | 1 | 2 | 3 | 4;

function litLine(via: Via | null, topics: Topic[], places: LivePlace[]): string {
  if (via === 'login') return t('s5.line.login');
  if (!topics.length && !places.length) return t('s5.line.empty');
  const names = places.map((p) => p.city);
  const where = names.length ? names.slice(0, 2).join(' and ') + (names.length > 2 ? ' and ' + (names.length - 2) + ' more' : '') : 'Everywhere';
  const tuned = topics.length ? ', tuned to ' + topics.slice(0, 3).join(', ').toLowerCase() : '';
  return where + tuned + '.';
}

function Dots({ step }: { step: Step }) {
  const { GOLD, RING } = useOb();
  const insets = useSafeAreaInsets();
  const at = Math.min(step, 3);
  return (
    <View pointerEvents="none" style={[s.dots, { top: 58 + insets.top }]}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ width: i === at ? 18 : 6, height: 2, borderRadius: 1, backgroundColor: i === at ? GOLD : i < step ? 'rgba(201,168,76,0.4)' : RING }} />
      ))}
    </View>
  );
}

export default function OnboardingScreen() {
  const params = useLocalSearchParams<{ mode?: string; resume?: string }>();
  const loginFirst = params.mode === 'login';
  // Back from an email confirmation link: the card is issued, pick up at Ignite.
  const resumeIgnite = params.resume === 'ignite';
  const auth = useAuth();
  const [step, setStep] = useState<Step>(resumeIgnite ? 3 : loginFirst ? 2 : 0);
  const [cardMode, setCardMode] = useState<'create' | 'login'>(loginFirst ? 'login' : 'create');
  const [via, setVia] = useState<Via | null>(resumeIgnite ? 'email' : null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [places, setPlaces] = useState<LivePlace[]>([]);
  const { GOLD, DIM, BG } = useOb();
  const leaving = useRef(false);
  // Read at exit time only: auth is rebuilt on unrelated renders, which would keep
  // restarting the Lit timer.
  const authRef = useRef(auth);
  authRef.current = auth;

  // Android back walks the flow backwards; once past the card it stays put, since
  // the account already exists and there's nothing to undo.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 1 || (step === 2 && !loginFirst)) {
        setStep((step - 1) as Step);
        return true;
      }
      return step >= 2;
    });
    return () => sub.remove();
  }, [step, loginFirst]);

  const onEnter = useCallback((v: Via) => {
    setVia(v);
    setStep(v === 'login' ? 4 : 3);
  }, []);

  const ignite = () => {
    seedFeed(topics, places);
    setStep(4);
  };

  // Lit: 1.6 s, then the app. No consent screen follows: body signals are opt-in per
  // signal in Settings (see lib/sensing.tsx).
  useEffect(() => {
    if (step !== 4 || leaving.current) return;
    const id = setTimeout(async () => {
      leaving.current = true;
      markOnboarded();
      try {
        env.storage.removeItem(RESUME_KEY);
      } catch {}
      await authRef.current.refreshSignedIn().catch(() => {});
      router.replace(ROUTES.void as any);
    }, 1600);
    return () => clearTimeout(id);
  }, [step]);

  return (
    <View style={[s.fill, { backgroundColor: BG }]}>
      {step === 0 ? (
        <JumpIn
          onNext={() => setStep(1)}
          onSignIn={() => {
            setCardMode('login');
            setStep(2);
          }}
        />
      ) : null}
      {step === 1 ? <GlobeIntro onNext={() => setStep(2)} /> : null}
      {step === 2 ? <CardGate key={cardMode} stepLabel="3 OF 4" initialMode={cardMode} onEnter={onEnter} /> : null}
      {step === 3 ? (
        <Ignite
          topics={topics}
          places={places}
          onToggleTopic={(tp) => setTopics((l) => (l.includes(tp) ? l.filter((x) => x !== tp) : [...l, tp]))}
          onTogglePlace={(p) => setPlaces((l) => (l.some((x) => x.city === p.city) ? l.filter((x) => x.city !== p.city) : [...l, p]))}
          onIgnite={ignite}
        />
      ) : null}
      {step === 4 ? (
        <Enter style={[s.lit, { backgroundColor: BG }]}>
          <VText style={{ fontSize: 44, color: GOLD, textShadowColor: 'rgba(201,168,76,0.7)', textShadowRadius: 34 }}>⬡</VText>
          <Serif size={26} style={{ lineHeight: 26 * 1.25, marginTop: 24, textAlign: 'center' }}>
            {litLine(via, topics, places)}
          </Serif>
          <Mono tracking={0.35} color={DIM} style={{ marginTop: 18 }}>
            {t('s5.label')}
          </Mono>
        </Enter>
      ) : null}
      <Dots step={step} />
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#04020c' },
  dots: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6, zIndex: 20 },
  lit: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#04020c', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
});
