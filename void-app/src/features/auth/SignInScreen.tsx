// #signin — the identity gate. Anonymous by default; email / Google / Apple are optional.
// CSS 1:1 from void2-final.html lines 835-859.
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../theme';
import { FONTS, em, type RadialSpec } from '../../theme/palettes';
import { RadialFill } from '../../ui/Surface';
import { Pill } from '../../ui/Pill';
import { VText } from '../../ui/Text';
import { useAuth } from '../../lib/auth';
import { ROUTES } from '../../nav/routes';
import { useIdentity } from './coreBridge';
import { appleSignIn, continueAnonymously, emailAuth, enterWithHandle, oauthSignIn } from './authActions';
import { HANDLE_MAX, stripHandle } from './handles';

/** #signin background-image: radial-gradient(80% 60% at 50% 38%,#0d0620 0%,#04020c 70%) (VOID + DARK). */
const SIGNIN_RADIAL: RadialSpec = { rx: 80, ry: 60, cx: 50, cy: 38, stops: [{ color: '#0d0620', offset: 0 }, { color: '#04020c', offset: 0.7 }] };

function Field({ label, inputRef, ...props }: React.ComponentProps<typeof TextInput> & { label: string; inputRef?: React.Ref<TextInput> }) {
  const { colors } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={st.field}>
      <VText style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.22), color: colors.navDim }}>{label}</VText>
      <TextInput
        ref={inputRef}
        placeholderTextColor={colors.navDim}
        selectionColor={colors.gold}
        cursorColor={colors.gold}
        autoCorrect={false}
        spellCheck={false}
        {...props}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={[st.input, { color: colors.white }, focus ? { boxShadow: 'inset 0px 0px 0px 1px rgba(201,168,76,0.45)' } : null]}
      />
    </View>
  );
}

export default function SignInScreen() {
  const { colors, isLight } = useTheme();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const { user, ready } = useIdentity();
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [emailMode, setEmailMode] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const prefilled = useRef(false);
  const handleRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);

  // Prefill from whatever identity exists (web showSignIn()).
  useEffect(() => {
    if (!ready || prefilled.current) return;
    prefilled.current = true;
    setHandle(stripHandle(user.handle));
    if (user.name && user.name !== 'Anonymous') setName(user.name);
    const t = setTimeout(() => handleRef.current?.focus(), 260);
    return () => clearTimeout(t);
  }, [ready, user]);

  const done = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await auth.refreshSignedIn().catch(() => {});
    router.replace(ROUTES.void as any);
  };

  const run = async (fn: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const e = await fn();
      if (e === 'CANCELLED') return;
      if (e) setErr(e);
      else await done();
    } finally {
      setBusy(false);
    }
  };

  const submit = () => run(() => (emailMode ? emailAuth(email, pass, handle, name) : enterWithHandle(handle, name)));

  const toggleEmail = () => {
    setEmailMode((m) => !m);
    setErr('');
    if (!emailMode) setTimeout(() => emailRef.current?.focus(), 60);
  };

  return (
    <View style={[st.fill, { backgroundColor: colors.bg }]}>
      {isLight ? colors.bgRadial && <RadialFill spec={colors.bgRadial} /> : <RadialFill spec={SIGNIN_RADIAL} />}
      <KeyboardAvoidingView style={st.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[st.scroll, { paddingTop: 32 + insets.top, paddingBottom: 32 + insets.bottom }]}
        >
          <View style={st.inner}>
            <VText align="center" style={{ fontFamily: FONTS.sansExtraBold, fontSize: 22, letterSpacing: em(22, 0.18), color: colors.white }}>
              THE
              <VText style={{ fontFamily: FONTS.sansExtraBold, fontSize: 22, color: colors.gold, textShadowColor: 'rgba(201,168,76,0.6)', textShadowRadius: 24 }}>{'⬡'}</VText>
              VOID
            </VText>
            <VText align="center" style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.3), color: colors.navDim, marginTop: 18 }}>
              IDENTITY
            </VText>
            <VText align="center" style={{ fontFamily: FONTS.serifItalic, fontSize: 21, lineHeight: 21 * 1.38, color: colors.white, marginTop: 12 }}>
              {'Anonymous by default.\nKnown only by your signal.'}
            </VText>

            <Field
              label="HANDLE"
              inputRef={handleRef}
              value={handle}
              onChangeText={setHandle}
              placeholder="yourhandle"
              maxLength={HANDLE_MAX}
              autoCapitalize="none"
              autoComplete="off"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <Field label="DISPLAY NAME" value={name} onChangeText={setName} placeholder="what they call you" maxLength={32} autoComplete="off" returnKeyType="go" onSubmitEditing={submit} />
            {emailMode ? (
              <>
                <Field
                  label="EMAIL"
                  inputRef={emailRef}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="go"
                  onSubmitEditing={submit}
                />
                <Field
                  label="PASSWORD"
                  value={pass}
                  onChangeText={setPass}
                  placeholder="8+ characters"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={submit}
                />
              </>
            ) : null}

            <VText style={{ minHeight: 14, fontFamily: FONTS.mono, fontSize: 7.5, letterSpacing: em(7.5, 0.14), color: colors.red, marginTop: 10, marginBottom: 0 }}>{err}</VText>

            <Pill variant="gold" label={emailMode ? 'SIGN IN / SIGN UP' : 'ENTER THE VOID'} onPress={submit} disabled={busy} style={{ marginTop: 0 }} />
            <Pill variant="ghost" label="CONTINUE ANONYMOUSLY" onPress={() => run(continueAnonymously)} disabled={busy} style={{ marginTop: 12 }} />

            <View style={st.alt}>
              <Pill variant="chip" label="EMAIL & PASSWORD" active={emailMode} onPress={toggleEmail} disabled={busy} />
              <Pill variant="chip" label="GOOGLE" onPress={() => run(() => oauthSignIn('google', handle, name))} disabled={busy} />
              <Pill variant="chip" label="APPLE" onPress={() => run(() => appleSignIn(handle, name))} disabled={busy} />
            </View>

            <VText align="center" style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.2), color: colors.muted, marginTop: 22 }}>
              {emailMode ? 'AN ACCOUNT SYNCS YOUR SIGNAL ACROSS DEVICES' : 'NO EMAIL · NO PASSWORD · STORED ON THIS DEVICE'}
            </VText>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26 },
  inner: { width: '100%', maxWidth: 340 },
  field: { gap: 7, marginTop: 22 },
  input: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 15, fontFamily: FONTS.sans, fontSize: 14 },
  alt: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' },
});
