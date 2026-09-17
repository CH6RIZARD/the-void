// Account deletion (Apple 5.1.1(v) / Google Play) — openDeleteAccount / runDeleteAccount,
// CSS .da-* (void2-final.html 606-623). Type DELETE, then core deleteAccount() with the
// web's exact error texts. The Apple token saved at sign-in rides along for the revoke.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteAccount, VoidAuth } from '../../core';
import { useTheme } from '../../theme';
import { FONTS, em } from '../../theme/palettes';
import { Sheet } from '../../ui/Sheet';
import { Pill } from '../../ui/Pill';
import { VText } from '../../ui/Text';
import { clearUserData } from '../../lib/storage';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { ROUTES } from '../../nav/routes';
import { setDmUnread } from '../../nav/badges';
import { APPLE_REFRESH_TOKEN_KEY } from '../auth/authActions';
import { ensureCore } from '../auth/coreBridge';

const LIST = [
  'Your profile, handle and display name',
  'Your posts and replies, their media, and replies under them',
  'Your ranks and slashes, follows and followers',
  'Your messages, conversations and device keys',
  'Notifications, reports and blocks you made, synced taste',
  'Your login, and the data stored on this device',
];

function whoText(): string {
  const s = VoidAuth.session;
  const u = s && s.user;
  if (!s) return 'This device has no server account, so only the data stored on this device will be erased.';
  if (u && u.is_anonymous) return 'You are signed in anonymously. Your anonymous account still exists on our server and will be deleted with everything attached to it.';
  return 'You are signed in' + (u && u.email ? ' as ' + u.email : '') + '. The account and everything attached to it will be deleted from our server.';
}

export default function DeleteAccountSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, isLight } = useTheme();
  const auth = useAuth();
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [who, setWho] = useState('');
  const inputRef = useRef<TextInput>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) return;
    setValue('');
    setErr('');
    setDone(null);
    ensureCore().then(() => setWho(whoText()));
    const t = setTimeout(() => inputRef.current?.focus(), 240);
    return () => clearTimeout(t);
  }, [visible]);

  useEffect(() => () => { if (reloadTimer.current) clearTimeout(reloadTimer.current); }, []);

  const ok = value.trim().toUpperCase() === 'DELETE';

  const returnToSignIn = async () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    await auth.refreshSignedIn().catch(() => {});
    onClose();
    router.replace(ROUTES.signIn as any);
  };

  const run = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setErr('');
    await ensureCore();
    // Apple revoke: hand the token kept at sign-in to the Edge Function.
    try {
      const s = VoidAuth.session;
      if (s) {
        const rt = await AsyncStorage.getItem(APPLE_REFRESH_TOKEN_KEY);
        if (rt && !s.provider_refresh_token) s.provider_refresh_token = rt;
        // TODO(backend): delete-account accepts only Apple refresh/access tokens. The native
        // authorizationCode is kept under APPLE_AUTH_CODE_KEY (auth/authActions); the function
        // must exchange it at appleid.apple.com/auth/token before it can revoke.
      }
    } catch {}
    const r = await deleteAccount();
    setBusy(false);
    if (!r.ok) {
      setErr(r.message);
      return;
    }
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {}
    await clearUserData();
    setDmUnread(false);
    setDone(r.message);
    reloadTimer.current = setTimeout(returnToSignIn, 6000);
  };

  const close = () => {
    if (busy) return;
    if (done) returnToSignIn();
    else onClose();
  };

  const eyebrow = { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.3), color: colors.red };
  const title = { fontFamily: FONTS.serif, fontSize: 24, lineHeight: 24 * 1.2, color: colors.white, marginTop: 8 };
  const text = { fontFamily: FONTS.sans, fontSize: 13, lineHeight: 13 * 1.5, color: colors.dim, marginTop: 10 };

  return (
    <Sheet visible={visible} onClose={close} dismissOnScrim={!busy} draggable={!busy} contentStyle={{ paddingTop: 2 }}>
      {done ? (
        <>
          <VText style={eyebrow}>ACCOUNT DELETED</VText>
          <VText style={title}>You have left the void.</VText>
          <VText style={text}>{done}</VText>
          <DangerButton label="RETURN TO SIGN-IN" onPress={returnToSignIn} style={{ marginTop: 18 }} />
        </>
      ) : (
        <>
          <VText style={eyebrow}>DELETE ACCOUNT</VText>
          <VText style={title}>This cannot be undone.</VText>
          <VText style={text}>{who}</VText>
          <View style={{ marginTop: 12 }}>
            {LIST.map((l) => (
              <View key={l} style={{ paddingVertical: 7, boxShadow: `inset 0px -1px 0px ${isLight ? colors.hairline : 'rgba(255,255,255,0.06)'}` }}>
                <VText style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: em(9.5, 0.06), color: colors.white }}>{l}</VText>
              </View>
            ))}
          </View>
          <VText style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.22), color: colors.dim, marginTop: 18 }}>TYPE DELETE TO CONFIRM</VText>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={setValue}
            placeholder="DELETE"
            placeholderTextColor={colors.dim}
            autoCapitalize="characters"
            autoCorrect={false}
            spellCheck={false}
            selectionColor={colors.red}
            editable={!busy}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            onSubmitEditing={run}
            style={[st.input, { color: colors.white }, focus ? { boxShadow: `inset 0px 0px 0px 1px ${colors.red}8c` } : null]}
          />
          <VText style={{ minHeight: 14, fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.12), lineHeight: 8 * 1.5, color: colors.red, marginTop: 10 }}>{err}</VText>
          <DangerButton label={busy ? 'DELETING…' : 'DELETE MY ACCOUNT'} disabled={!ok || busy} onPress={run} style={{ marginTop: 6 }} />
          <Pill variant="ghost" label="CANCEL" onPress={close} disabled={busy} style={{ marginTop: 12 }} />
        </>
      )}
    </Sheet>
  );
}

/** .da-go: red pill, Syne 700 12 .24em white; disabled opacity .35 */
function DangerButton({ label, onPress, disabled, style }: { label: string; onPress: () => void; disabled?: boolean; style?: any }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[st.go, { backgroundColor: colors.red, opacity: disabled ? 0.35 : 1 }, style]}>
      <VText style={{ fontFamily: FONTS.sansBold, fontSize: 12, letterSpacing: em(12, 0.24), color: '#fff' }}>{label}</VText>
    </Pressable>
  );
}

const st = StyleSheet.create({
  input: { marginTop: 8, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 15, fontFamily: FONTS.mono, fontSize: 14, letterSpacing: 14 * 0.2 },
  go: { alignSelf: 'stretch', padding: 13, borderRadius: 24, alignItems: 'center' },
});
