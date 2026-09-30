// Jump In, screen 3: the Signal Card — account creation (NEW USER) or login.
// A port of "Void Card Gate.dc.html". The one behavioural change the handoff asks
// for: the success state (⬡ + gold bar) plays only after the server has approved
// the credential. Until then the pressed control shows pending and errors print in
// the red mono line with the card left on screen.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Line, LinearGradient as SvgGrad, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONTS, em } from '../../theme/palettes';
import { VText } from '../../ui/Text';
import { RadialFill } from '../../ui/Surface';
import type { RadialSpec } from '../../theme/palettes';
import { t } from './copy';
import {
  claimCheck,
  createWithEmail,
  createWithProvider,
  enterBlank,
  handleProblem,
  loginWithEmail,
  loginWithHandle,
  loginWithProvider,
  type AuthResult,
  type Via,
} from './onboardAuth';
import { CTA, DIM, Enter, GOLD, LAV, Mono, RED, WHITE } from './parts';

/** radial-gradient(70% 45% at 50% 40%, #1a0c44 0%, #0a0620 65%) */
const BG: RadialSpec = { rx: 70, ry: 45, cx: 50, cy: 40, stops: [{ color: '#1a0c44', offset: 0 }, { color: '#0a0620', offset: 0.65 }] };
const OK_EMAIL = /^\S+@\S+\.\S+$/;

// ─── THE LANYARD ────────────────────────────────────────────────────────
// Six straps, drawn in the mock's 402x874 screen space and scaled to whatever
// this phone actually is. The path is a function of the slot's position because
// the strap has to END IN THE HOLE: the slot is measured at runtime rather than
// assumed, so it stays in the hole at any screen size, with any font scale, and
// with the keyboard open.
//
// Each strap is drawn twice. Once behind everything, and once more clipped to
// the band between the tag's top edge and the slot's lower lip, painted over the
// tag - which is what makes it read as passing THROUGH the hole rather than
// stopping at it. Nothing interactive sits above either copy.
const LANYARD_W = 402;
const LANYARD_H = 874;
const LANYARDS: { d: (x: number, y: number) => string; gold?: boolean }[] = [
  { d: (x, y) => `M-20 -20 C 110 40, ${x - 90} ${y - 120}, ${x} ${y - 40} L ${x} ${y}` },
  { d: (x, y) => `M60 -20 C 90 110, ${x - 40} ${y - 110}, ${x} ${y - 40} L ${x} ${y} M340 -20 C 310 110, ${x + 40} ${y - 110}, ${x} ${y - 40} L ${x} ${y}` },
  { d: (x, y) => `M230 -20 C 330 60, 370 150, ${x + 90} ${y - 130} C ${x + 40} ${y - 100}, ${x} ${y - 90}, ${x} ${y - 40} L ${x} ${y}` },
  { d: (x, y) => `M120 -20 C 260 80, ${x - 70} ${y - 160}, ${x} ${y - 40} L ${x} ${y} M120 -20 C 40 110, ${x + 50} ${y - 140}, ${x} ${y - 40} L ${x} ${y}` },
  { d: (x, y) => `M-20 -20 C 110 40, ${x - 90} ${y - 120}, ${x} ${y - 40} L ${x} ${y}`, gold: true },
  { d: (x, y) => `M-10 -20 L ${x} ${y - 40} L ${x} ${y} M412 -20 L ${x} ${y - 40} L ${x} ${y}` },
];

/** Where the slot sits, in the lanyard's coordinate space. */
interface SlotGeom { x: number; y: number; tagTop: number }

function Lanyard({ idx, slot, over }: { idx: number; slot: SlotGeom; over?: boolean }) {
  const v = LANYARDS[idx] || LANYARDS[0];
  const d = v.d(slot.x, slot.y);
  const stroke = v.gold ? '#c9a84c' : 'url(#strapGrad)';
  return (
    <Svg
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      viewBox={`0 0 ${LANYARD_W} ${LANYARD_H}`}
      preserveAspectRatio="none"
    >
      <Defs>
        <SvgGrad id="strapGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1a1030" />
          <Stop offset="0.5" stopColor="#2a1a52" />
          <Stop offset="1" stopColor="#1a1030" />
        </SvgGrad>
        {over ? (
          <ClipPath id="slotBand">
            {/* Only the tag's top-to-slot band, so the strap appears over the
                tag exactly as far as the hole and no further. */}
            <Rect x={0} y={slot.tagTop} width={LANYARD_W} height={Math.max(0, slot.y - slot.tagTop)} />
          </ClipPath>
        ) : null}
      </Defs>
      <G clipPath={over ? 'url(#slotBand)' : undefined}>
        <Path d={d} stroke={stroke} strokeWidth={15} fill="none" strokeLinecap="butt" />
        <Path d={d} stroke="#c9a84c" strokeWidth={1} strokeDasharray="4 5" fill="none" opacity={0.55} strokeLinecap="butt" />
      </G>
    </Svg>
  );
}

type Mode = 'create' | 'login';
type Stage = 'providers' | 'email' | 'password';

function today(): string {
  const d = new Date();
  return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
}

// ── icons (paths from the mock) ─────────────────────────────────────────────
const AppleIcon = ({ c }: { c: string }) => (
  <Svg width={13} height={13} viewBox="0 0 24 24" fill={c}>
    <Path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.6-1-2.6-3.9zM14 5.4c.7-.8 1.1-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" />
  </Svg>
);
const GoogleIcon = () => (
  <Svg width={13} height={13} viewBox="0 0 24 24">
    <Path fill="#EA4335" d="M12 5.4c1.6 0 3 .6 4.1 1.6l3-3A10.4 10.4 0 0 0 12 1.5 10.5 10.5 0 0 0 2.6 7.3l3.5 2.7A6.3 6.3 0 0 1 12 5.4z" />
    <Path fill="#4285F4" d="M22.3 12.2c0-.8-.1-1.4-.2-2H12v4h5.9a5 5 0 0 1-2.2 3.3l3.4 2.6c2-1.8 3.2-4.6 3.2-7.9z" />
    <Path fill="#FBBC05" d="M6.1 14.2a6.3 6.3 0 0 1 0-4.2L2.6 7.3a10.5 10.5 0 0 0 0 9.4l3.5-2.5z" />
    <Path fill="#34A853" d="M12 22.5c2.8 0 5.2-.9 7-2.5l-3.4-2.6c-.9.6-2.1 1-3.6 1a6.3 6.3 0 0 1-5.9-4.2l-3.5 2.6A10.5 10.5 0 0 0 12 22.5z" />
  </Svg>
);
const MailIcon = ({ c }: { c: string }) => (
  <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={1.6}>
    <Rect x={3} y={5} width={18} height={14} rx={2} />
    <Path d="m3 7 9 6 9-6" />
  </Svg>
);
const GlobeIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 24 24" style={{ opacity: 0.9 }}>
    <Defs>
      <RadialGradient id="cgS" cx="35%" cy="30%" r="75%">
        <Stop offset="0" stopColor={GOLD} stopOpacity={0.28} />
        <Stop offset="1" stopColor={GOLD} stopOpacity={0} />
      </RadialGradient>
    </Defs>
    <Circle cx={12} cy={12} r={10.5} fill="url(#cgS)" />
    <G fill="none" stroke="rgba(0,0,0,0.85)" strokeWidth={1} transform="translate(0,0.6)">
      <Circle cx={12} cy={12} r={10.5} />
      <Ellipse cx={12} cy={12} rx={4.6} ry={10.5} />
      <Line x1={1.5} y1={12} x2={22.5} y2={12} />
    </G>
    <G fill="none" stroke={GOLD} strokeWidth={0.9} strokeLinecap="round">
      <Circle cx={12} cy={12} r={10.5} />
      <Ellipse cx={12} cy={12} rx={4.6} ry={10.5} />
      <Line x1={1.5} y1={12} x2={22.5} y2={12} />
      <Path d="M3.4 6.8h17.2M3.4 17.2h17.2" opacity={0.55} />
    </G>
  </Svg>
);

function ProviderBtn({ label, icon, onPress, disabled, ring }: { label: string; icon: React.ReactNode; onPress: () => void; disabled?: boolean; ring?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [s.provider, { boxShadow: `inset 0px 0px 0px 1px ${ring || pressed ? GOLD : 'rgba(255,255,255,0.12)'}` }, disabled ? { opacity: 0.5 } : null]}
    >
      {icon}
      <Mono size={7.5} tracking={0.18} color={WHITE}>
        {label}
      </Mono>
    </Pressable>
  );
}

function Input(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor="#3a2f60"
      selectionColor={GOLD}
      cursorColor={GOLD}
      autoCorrect={false}
      spellCheck={false}
      autoCapitalize="none"
      {...props}
      style={[s.input, props.style]}
    />
  );
}

/** The card's gold shimmer band: linear-gradient(115deg, … rgba(201,168,76,.08) 45% …) 5s. */
function Shimmer({ width }: { width: number }) {
  const x = useSharedValue(-1);
  useEffect(() => {
    x.value = withRepeat(withTiming(1, { duration: 5000, easing: Easing.linear }), -1, false);
  }, [x]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * width }, { rotate: '25deg' }] }));
  if (!width) return null;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -width * 0.3, bottom: -width * 0.3, left: 0, width: width * 0.5 }, a]}>
      <LinearGradient colors={['transparent', 'rgba(201,168,76,0.08)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

function Success({ via, handle, onDone }: { via: Via; handle: string; onDone: () => void }) {
  const bar = useSharedValue(0);
  useEffect(() => {
    bar.value = withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) });
    const id = setTimeout(onDone, 1600);
    return () => clearTimeout(id);
  }, [bar, onDone]);
  const fill = useAnimatedStyle(() => ({ width: `${bar.value * 100}%` }));
  const welcome =
    via === 'anon' ? t('s3.done.anon') : via === 'login' ? (handle ? t('s3.done.login', { handle }) : t('s3.done.login.noHandle')) : t('s3.done.new', { handle });
  return (
    <Enter style={s.done}>
      <VText style={{ fontSize: 40, color: GOLD, textShadowColor: 'rgba(201,168,76,0.7)', textShadowRadius: 30 }}>⬡</VText>
      <VText align="center" style={{ fontFamily: FONTS.serifItalic, fontSize: 26, lineHeight: 26 * 1.2, color: WHITE, marginTop: 22 }}>
        {welcome}
      </VText>
      <View style={s.barTrack}>
        <Animated.View style={[{ height: '100%', overflow: 'hidden' }, fill]}>
          <LinearGradient colors={['#7c3aed', GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: 150, height: '100%' }} />
        </Animated.View>
      </View>
      <Mono tracking={0.35} style={{ marginTop: 14 }}>
        {via === 'login' ? t('s3.done.label.login') : t('s3.done.label.new')}
      </Mono>
    </Enter>
  );
}

export function CardGate({ stepLabel, initialMode = 'create', onEnter }: { stepLabel: string; initialMode?: Mode; onEnter: (via: Via, handle: string) => void }) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [handle, setHandle] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [email, setEmail] = useState('');
  const [flipped, setFlipped] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [stage, setStage] = useState<Stage>('providers');
  const [loginEmailOpen, setLoginEmailOpen] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ via: Via; handle: string } | null>(null);
  const [cardW, setCardW] = useState(0);
  // Rolled once per mount, as the notes require - there is no default variant.
  const [lanyardIdx] = useState(() => Math.floor(Math.random() * LANYARDS.length));
  const [slot, setSlot] = useState<SlotGeom | null>(null);
  const zoneRef = useRef<View>(null);
  const slotRef = useRef<View>(null);

  const login = mode === 'login';
  const h = handle.replace(/^@/, '');
  const H = h.toUpperCase().slice(0, 14);

  // cardIn: translateY(40) → 0, .7s
  const cardIn = useSharedValue(0);
  useEffect(() => {
    cardIn.value = withTiming(1, { duration: 700, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
  }, [cardIn]);
  const cardAnim = useAnimatedStyle(() => ({ opacity: cardIn.value, transform: [{ translateY: (1 - cardIn.value) * 40 }] }));

  // globeLift: the card's globe rises and glows once a password is typed.
  const lift = useSharedValue(0);
  const armed = flipped && !!pass;
  useEffect(() => {
    lift.value = armed ? withRepeat(withSequence(withTiming(1, { duration: 640 }), withTiming(0.85, { duration: 320 }), withTiming(0, { duration: 640 })), -1, false) : withTiming(0);
  }, [armed, lift]);
  const liftAnim = useAnimatedStyle(() => ({ transform: [{ translateY: -7 * lift.value }, { scale: 1 + 0.12 * lift.value }] }));
  const glowAnim = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * lift.value }));

  // The strap is hidden until this has run, so it can never paint misaligned.
  const measureSlot = useCallback(() => {
    const z = zoneRef.current as any;
    const sl = slotRef.current as any;
    if (!z || !sl || !z.measure || !sl.measure) return;
    z.measure((_x: number, _y: number, zw: number, zh: number, zpx: number, zpy: number) => {
      if (!zw || !zh) return;
      sl.measure((_a: number, _b: number, sw: number, sh: number, spx: number, spy: number) => {
        const kx = LANYARD_W / zw;
        const ky = LANYARD_H / zh;
        const next = {
          x: (spx - zpx + sw / 2) * kx,
          y: (spy - zpy + sh) * ky,
          tagTop: (spy - zpy - 22) * ky, // the tag's own top edge, one pad above the slot
        };
        setSlot((p) => (p && Math.abs(p.x - next.x) < 0.5 && Math.abs(p.y - next.y) < 0.5 ? p : next));
      });
    });
  }, []);

  const reset = (m: Mode) => {
    setMode(m);
    setErr('');
    setFlipped(false);
    setStage('providers');
    setLoginEmailOpen(false);
    setPass('');
    setPass2('');
  };

  const needHandle = (): boolean => {
    const p = handleProblem(handle, mode);
    setErr(p);
    return !p;
  };

  const run = async (fn: () => Promise<AuthResult>) => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await fn();
      if (r.err) {
        if (r.err !== 'CANCELLED') setErr(r.err);
        return;
      }
      const ok = r as Extract<AuthResult, { via: Via }>;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDone({ via: ok.via, handle: ok.handle });
    } finally {
      setBusy(false);
    }
  };

  const provider = (p: 'apple' | 'google') => () => {
    if (login) return run(() => loginWithProvider(p));
    if (!needHandle()) return;
    run(() => createWithProvider(p, handle));
  };
  const cardEnter = () => {
    if (!needHandle()) return;
    if (!pass) return setErr(t('err.pass.missing'));
    run(() => loginWithHandle(handle, pass));
  };
  const loginEmailGo = () => {
    if (!OK_EMAIL.test(email)) return setErr(t('err.email'));
    if (!pass) return setErr(t('err.pass.missing'));
    run(() => loginWithEmail(email, pass));
  };
  const viaEmail = async () => {
    if (login) {
      setLoginEmailOpen((o) => !o);
      setErr('');
      return;
    }
    if (!needHandle() || busy) return;
    // HANDLE TAKEN surfaces here, before an email and password are asked for.
    setBusy(true);
    const e = await claimCheck(handle).catch(() => '');
    setBusy(false);
    if (e) return setErr(e);
    setStage('email');
  };
  const emailNext = () => {
    if (!OK_EMAIL.test(email)) return setErr(t('err.email'));
    setErr('');
    setStage('password');
  };
  const createGo = () => {
    if (pass.length < 8) return setErr(t('err.pass.short'));
    if (pass !== pass2) return setErr(t('err.pass.mismatch'));
    run(() => createWithEmail(handle, email, pass));
  };

  const finish = useMemo(() => () => done && onEnter(done.via, done.handle), [done, onEnter]);

  const tabBg = (on: boolean) => ({ backgroundColor: on ? 'rgba(255,255,255,0.07)' : 'transparent' });
  const pass2Ring = pass2 && pass2 !== pass ? 'rgba(239,68,68,0.6)' : pass2 && pass2 === pass ? 'rgba(16,185,129,0.6)' : 'rgba(201,168,76,0.35)';
  const errLine = (
    <VText align="center" style={{ minHeight: 12, fontFamily: FONTS.mono, fontSize: 7.5, letterSpacing: em(7.5, 0.14), color: RED }}>
      {err}
    </VText>
  );

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0a0620' }]}>
      <RadialFill spec={BG} />
      {done ? (
        <Success via={done.via} handle={done.handle} onDone={finish} />
      ) : (
        <KeyboardAvoidingView style={[s.page, { paddingTop: 78 + insets.top, paddingBottom: 40 + insets.bottom }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.head}>
            <Mono color={DIM}>{t('s3.eyebrow', { step: stepLabel })}</Mono>
            <View style={s.tabs}>
              <Pressable onPress={() => reset('create')} style={[s.tab, tabBg(!login)]}>
                <Mono size={7.5} tracking={0.18} color={login ? DIM : GOLD}>
                  {t('s3.tab.new')}
                </Mono>
              </Pressable>
              <Pressable onPress={() => reset('login')} style={[s.tab, tabBg(login)]}>
                <Mono size={7.5} tracking={0.18} color={login ? GOLD : DIM}>
                  {t('s3.tab.login')}
                </Mono>
              </Pressable>
            </View>
          </View>
          <VText style={{ fontFamily: FONTS.serifItalic, fontSize: 27, lineHeight: 27 * 1.2, color: WHITE, marginTop: 10 }}>
            {login ? t('s3.login.headline') : t('s3.new.headline')}
          </VText>

          {/* CARD */}
          <View style={s.cardZone} ref={zoneRef} onLayout={measureSlot}>
            {slot ? <Lanyard idx={lanyardIdx} slot={slot} /> : null}
            <Animated.View
              style={[s.card, cardAnim]}
              onLayout={(e) => {
                setCardW(e.nativeEvent.layout.width);
                measureSlot();
              }}
            >
              <LinearGradient colors={['#0d0820', '#04020c', '#0f0a26']} locations={[0, 0.6, 1]} start={{ x: 0.3, y: 0 }} end={{ x: 0.7, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 18 }]} />
              <Shimmer width={cardW} />
              {/* The slot the strap goes through. Measured, not assumed. */}
              <View ref={slotRef} onLayout={measureSlot} style={s.slot} />
              <View style={s.cardTop}>
                <VText style={{ fontFamily: FONTS.sansExtraBold, fontSize: 13, letterSpacing: em(13, 0.14), color: WHITE }}>
                  THE<VText style={{ fontFamily: FONTS.sansExtraBold, fontSize: 13, color: GOLD }}>⬡</VText>VOID
                </VText>
                {/* Empty for a new tag; a returning one says so. */}
                <Mono size={7} tracking={0.2} color={GOLD}>
                  {login ? t('s3.tag.returning') : ''}
                </Mono>
              </View>
              {flipped ? (
                <View style={s.fieldRow}>
                  <VText style={s.fieldMark}>✱</VText>
                  <Input
                    value={pass}
                    onChangeText={(v) => {
                      setPass(v);
                      setErr('');
                    }}
                    secureTextEntry={!showPass}
                    placeholder={t('s3.login.pass.placeholder')}
                    autoFocus
                    returnKeyType="go"
                    onSubmitEditing={cardEnter}
                    style={s.cardInput}
                  />
                  <Pressable onPress={() => setShowPass((v) => !v)} hitSlop={8}>
                    <Mono size={7} tracking={0.14} color={LAV}>
                      {showPass ? t('s3.login.hide') : t('s3.login.show')}
                    </Mono>
                  </Pressable>
                </View>
              ) : (
                <View style={s.fieldRow}>
                  <VText style={s.fieldMark}>@</VText>
                  <Input
                    value={handle}
                    onChangeText={(v) => {
                      setHandle(v);
                      setErr('');
                    }}
                    placeholder={login ? t('s3.login.handle.placeholder') : t('s3.new.handle.placeholder')}
                    maxLength={20}
                    returnKeyType={login ? 'next' : 'done'}
                    onSubmitEditing={() => login && needHandle() && setFlipped(true)}
                    style={s.cardInput}
                  />
                </View>
              )}
              <View style={s.cardBottom}>
                {/* Barcode and globe are ONE button, and it is the way in. */}
                <Pressable onPress={() => flipped && cardEnter()} disabled={!armed || busy} accessibilityLabel="Enter" hitSlop={10}>
                  <Animated.View style={[s.stamp, liftAnim]}>
                    <Animated.View style={[s.globeGlow, armed ? glowAnim : { opacity: 0 }]} pointerEvents="none" />
                    <View style={s.barcode}>
                      {/* Eleven bars, fixed - a barcode that changes is a barcode
                          nobody believes. */}
                      {[3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3].map((w, i) => (
                        <View key={i} style={[s.bar, { width: w }]} />
                      ))}
                    </View>
                    <GlobeIcon />
                  </Animated.View>
                </Pressable>
                <Mono size={7.5} tracking={0.22} color={LAV}>
                  {today()}
                </Mono>
              </View>
            </Animated.View>
            {slot ? <Lanyard idx={lanyardIdx} slot={slot} over /> : null}

            <View style={s.underCard}>
              {login ? (
                <>
                  <Pressable
                    onPress={() => {
                      if (!flipped && !needHandle()) return;
                      setFlipped((f) => !f);
                      setErr('');
                    }}
                    style={s.flipBtn}
                  >
                    <VText style={{ fontSize: 12, color: GOLD }}>⟲</VText>
                    <Mono tracking={0.22} color={GOLD}>
                      {flipped ? t('s3.login.toggle.toHandle') : t('s3.login.toggle.toPass')}
                    </Mono>
                  </Pressable>
                  {flipped ? (
                    <Mono size={7} tracking={0.2} color={pass ? GOLD : DIM}>
                      {t('s3.login.globeHint')}
                    </Mono>
                  ) : null}
                </>
              ) : null}
            </View>
          </View>

          {/* BOTTOM */}
          {stage === 'providers' || login ? (
            <View style={s.bottom}>
              <View style={s.orRow}>
                <View style={s.hair} />
                <Mono size={7} tracking={0.22} color={DIM}>
                  {login ? t('s3.login.providers') : h ? t('s3.new.providers.filled', { HANDLE: H }) : t('s3.new.providers.empty')}
                </Mono>
                <View style={s.hair} />
              </View>
              <View style={s.providers}>
                <ProviderBtn label="APPLE" icon={<AppleIcon c={WHITE} />} onPress={provider('apple')} disabled={busy} />
                <ProviderBtn label="GOOGLE" icon={<GoogleIcon />} onPress={provider('google')} disabled={busy} />
                <ProviderBtn label="EMAIL" icon={<MailIcon c={WHITE} />} onPress={viaEmail} disabled={busy} ring={login && loginEmailOpen} />
              </View>
              {login && loginEmailOpen ? (
                <Enter style={{ gap: 8 }}>
                  <Input value={email} onChangeText={setEmail} placeholder={t('s3.login.email.placeholder')} keyboardType="email-address" autoComplete="email" style={s.boxInput} />
                  <Input
                    value={pass}
                    onChangeText={setPass}
                    placeholder={t('s3.login.email.pass')}
                    secureTextEntry
                    autoComplete="current-password"
                    returnKeyType="go"
                    onSubmitEditing={loginEmailGo}
                    style={s.boxInput}
                  />
                  <CTA label={t('s3.login.email.cta')} onPress={loginEmailGo} disabled={busy} style={{ paddingVertical: 14 }} />
                </Enter>
              ) : null}
              {errLine}
              {!login && !h ? <CTA label={t('s3.new.blank.cta')} onPress={() => run(enterBlank)} disabled={busy} /> : null}
              <Mono size={7} tracking={0.2} color={DIM} style={{ textAlign: 'center' }}>
                {login ? t('s3.login.legal') : h ? t('s3.new.legal.filled') : t('s3.new.legal.blank')}
              </Mono>
            </View>
          ) : stage === 'email' ? (
            <Enter style={s.bottom}>
              <View style={s.stepHead}>
                <Pressable onPress={() => (setStage('providers'), setErr(''))} hitSlop={10}>
                  <VText style={{ fontSize: 16, color: LAV }}>‹</VText>
                </Pressable>
                <Mono size={7} tracking={0.22} color={DIM}>
                  {t('s3.new.email.eyebrow', { HANDLE: H })}
                </Mono>
              </View>
              <Input
                value={email}
                onChangeText={(v) => (setEmail(v), setErr(''))}
                placeholder={t('s3.new.email.placeholder')}
                keyboardType="email-address"
                autoComplete="email"
                autoFocus
                returnKeyType="next"
                onSubmitEditing={emailNext}
                style={s.boxInput}
              />
              {errLine}
              <CTA label={t('s3.new.email.cta')} onPress={emailNext} />
              <Mono size={7} tracking={0.2} color={DIM} style={{ textAlign: 'center' }}>
                {t('s3.new.email.legal')}
              </Mono>
            </Enter>
          ) : (
            <Enter style={s.bottom}>
              <View style={s.stepHead}>
                <Pressable onPress={() => (setStage('email'), setErr(''))} hitSlop={10}>
                  <VText style={{ fontSize: 16, color: LAV }}>‹</VText>
                </Pressable>
                <Mono size={7} tracking={0.22} color={DIM}>
                  {t('s3.new.pass.eyebrow', { EMAIL: email.toUpperCase().slice(0, 18) })}
                </Mono>
              </View>
              <Input
                value={pass}
                onChangeText={(v) => (setPass(v), setErr(''))}
                placeholder={t('s3.new.pass.placeholder')}
                secureTextEntry
                autoComplete="new-password"
                autoFocus
                style={s.boxInput}
              />
              <Input
                value={pass2}
                onChangeText={(v) => (setPass2(v), setErr(''))}
                placeholder={t('s3.new.pass2.placeholder')}
                secureTextEntry
                autoComplete="new-password"
                returnKeyType="go"
                onSubmitEditing={createGo}
                style={[s.boxInput, { boxShadow: `inset 0px 0px 0px 1px ${pass2Ring}` }]}
              />
              {errLine}
              <CTA label={t('s3.new.pass.cta')} onPress={createGo} disabled={busy} />
            </Enter>
          )}
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 28 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tabs: { flexDirection: 'row', gap: 2, padding: 3, borderRadius: 20, backgroundColor: 'rgba(13,8,32,0.72)', boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.08)' },
  tab: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16 },
  cardZone: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    width: '100%',
    aspectRatio: 1.586,
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    overflow: 'hidden',
    boxShadow: '0px 40px 80px rgba(0,0,0,0.7), 0px 0px 0px 1px rgba(201,168,76,0.35), inset 0px 1px 0px rgba(255,255,255,0.08)',
  },
  slot: { alignSelf: 'center', width: 34, height: 9, borderRadius: 5, backgroundColor: '#04020c', marginBottom: 10, boxShadow: 'inset 0px 1px 2px rgba(0,0,0,0.9), 0px 1px 0px rgba(201,168,76,0.22)' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fieldMark: { fontFamily: FONTS.serifItalic, fontSize: 30, color: GOLD },
  cardInput: { flex: 1, fontFamily: FONTS.serifItalic, fontSize: 30, color: WHITE, padding: 0, backgroundColor: 'transparent', minWidth: 0 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  stamp: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barcode: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 22 },
  bar: { height: 22, backgroundColor: 'rgba(233,230,245,0.85)' },
  // transform-origin is the left edge, so the globe lifts away from the barcode
  // rather than the pair scaling about its middle.
  globeGlow: { position: 'absolute', left: -4, top: -4, right: -4, bottom: -4, borderRadius: 30, backgroundColor: 'rgba(201,168,76,0.25)' },
  underCard: { height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 14 },
  flipBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 10 },
  bottom: { gap: 10 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hair: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  providers: { flexDirection: 'row', gap: 8 },
  provider: { flex: 1, paddingVertical: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  input: { color: WHITE },
  boxInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    fontFamily: FONTS.sans,
    fontSize: 14,
    color: WHITE,
    boxShadow: 'inset 0px 0px 0px 1px rgba(201,168,76,0.35)',
  },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  barTrack: { width: 150, height: 2, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 1, overflow: 'hidden', marginTop: 26 },
});
