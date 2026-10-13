// .settings-modal — every web settings section (void2-final.html 1492-1600, CSS 587-650),
// plus the VMod Safety pages and the native Body signals entry.
import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hideSlop, moderation, setHideSlop, wipeLocalAccountData } from '../../core';
import { useTheme } from '../../theme';
import { FONTS, em, type RadialSpec, type ThemeName } from '../../theme/palettes';
import { RadialFill } from '../../ui/Surface';
import { Sheet } from '../../ui/Sheet';
import { VText } from '../../ui/Text';
import { Icon } from '../../ui/icons/Icon';
import { voidToast } from '../../ui/Toast';
import { useAuth } from '../../lib/auth';
import { clearUserData } from '../../lib/storage';
import { useSensing } from '../../lib/sensing';
import { BodySignalsSection } from './BodySignals';
import { ROUTES } from '../../nav/routes';
import { signOutEverywhere } from '../auth/authActions';
import { ensureCore, useIdentity } from '../auth/coreBridge';
import { useTermsGate } from '../auth/TermsSheet';
import { saveProfile } from '../profile/profileApi';
import BlockedAccountsScreen from './BlockedAccountsScreen';
import DeleteAccountSheet from './DeleteAccountSheet';
import { LANGUAGES, setPrefs, usePrefs } from './prefs';
import { MiniIcon, Toggle, VHeader, VItem, VLink, VP, VRow, VTitle } from './vmod';

// TODO(owner): replace with the real, monitored support inbox before store submission.
export const SUPPORT_EMAIL = moderation.SUPPORT_EMAIL;

/** .settings-modal background: radial-gradient(120% 40% at 50% 0%,#10082a 0%,#04020c 60%) */
const SETTINGS_RADIAL: RadialSpec = { rx: 120, ry: 40, cx: 50, cy: 0, stops: [{ color: '#10082a', offset: 0 }, { color: '#04020c', offset: 0.6 }] };

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={st.section}>
      <VText style={{ fontFamily: FONTS.serif, fontSize: 20, color: colors.white }}>{label}</VText>
      <LinearGradient colors={['rgba(201,168,76,0.4)', 'rgba(201,168,76,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={st.sectionLine} />
      {children}
    </View>
  );
}

function Row({ label, sub, children, onPress, labelStyle }: { label: string; sub?: string; children?: React.ReactNode; onPress?: () => void; labelStyle?: any }) {
  const { colors } = useTheme();
  const Wrap: any = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={st.row}>
      <View style={st.rowInfo}>
        <VText style={[{ fontFamily: FONTS.sansSemiBold, fontSize: 13, color: colors.white }, labelStyle]}>{label}</VText>
        {sub ? <VText style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.06), color: colors.dim, marginTop: 2 }}>{sub}</VText> : null}
      </View>
      {children}
    </Wrap>
  );
}

function EditInput(props: React.ComponentProps<typeof TextInput>) {
  const { colors } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <TextInput
      placeholderTextColor={colors.dim}
      selectionColor={colors.gold}
      autoCorrect={false}
      {...props}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={[st.editInput, { color: colors.white }, focus ? { boxShadow: 'inset 0px 0px 0px 1px rgba(124,58,237,0.5)' } : null]}
    />
  );
}

/** .si-ghost at width:auto;padding:8px 16px (+ .da-danger) */
function GhostBtn({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  const { colors, isLight } = useTheme();
  const ring = danger ? `${colors.red}73` : isLight ? colors.hairline : 'rgba(255,255,255,0.12)';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.ghost, { boxShadow: `inset 0px 0px 0px 1px ${ring}` }, pressed && danger ? { backgroundColor: `${colors.red}2e` } : null]}>
      {({ pressed }) => <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.2), color: pressed ? colors.white : danger ? colors.red : colors.dim }}>{label}</VText>}
    </Pressable>
  );
}

const SWATCH: Record<ThemeName, { bg: string[]; radial?: RadialSpec; bar: string; barShadow?: string; dot: string }> = {
  void: { bg: [], radial: { rx: 120, ry: 70, cx: 50, cy: 0, stops: [{ color: '#160b38', offset: 0 }, { color: '#04020c', offset: 0.65 }] }, bar: '#0d0820', dot: '#c9a84c' },
  dark: { bg: ['#0a0a0c'], bar: '#1a1a1e', dot: '#c9a84c' },
  light: { bg: [], radial: { rx: 120, ry: 70, cx: 50, cy: 0, stops: [{ color: '#f2ecdd', offset: 0 }, { color: '#e7e0cf', offset: 0.6 }] }, bar: '#f6f1e6', barShadow: '0px 2px 5px rgba(26,20,36,0.14)', dot: '#9a7b2d' },
};

function ThemeCard({ t }: { t: ThemeName }) {
  const { colors, saved, setTheme } = useTheme();
  const on = saved === t;
  const sw = SWATCH[t];
  return (
    <Pressable onPress={() => setTheme(t)} style={[st.themeCard, on ? { boxShadow: 'inset 0px 0px 0px 1px rgba(201,168,76,0.7)' } : null]}>
      <View style={[st.swatch, sw.bg[0] ? { backgroundColor: sw.bg[0] } : { backgroundColor: sw.radial!.stops[1].color }]}>
        {sw.radial ? <RadialFill spec={sw.radial} /> : null}
        <View style={[st.swI, { backgroundColor: sw.bar }, sw.barShadow ? { boxShadow: sw.barShadow } : null]} />
        <View style={[st.swB, { backgroundColor: sw.dot }]} />
      </View>
      <VText align="center" style={{ fontFamily: FONTS.mono, fontSize: 7.5, letterSpacing: em(7.5, 0.2), color: on ? colors.gold : colors.navDim, marginTop: 7 }}>{t.toUpperCase()}</VText>
    </Pressable>
  );
}

function ContactSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <VHeader title="CONTACT & SUPPORT" onClose={onClose} />
      <VTitle>Talk to a person</VTitle>
      <VP>Questions, appeals, safety concerns or content that should come down. We answer within 24 hours, and act on reports of objectionable content within 24 hours.</VP>
      <VItem left={<MiniIcon name="mail" color={colors.dim} />} sub="SUPPORT & SAFETY">
        <Pressable onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('The Void support')}`).catch(() => {})}>
          <VText style={{ fontFamily: FONTS.mono, fontSize: 12, letterSpacing: em(12, 0.04), color: colors.gold }}>{SUPPORT_EMAIL}</VText>
        </Pressable>
      </VItem>
      <VItem left={<MiniIcon name="flag" color={colors.dim} />} label="Report from the app" sub="TAP ··· ON ANY POST, REPLY OR ACCOUNT" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <VLink label="TERMS OF USE" url={moderation.TERMS_URL} />
        <VLink label="PRIVACY POLICY" url={moderation.PRIVACY_URL} />
      </View>
    </Sheet>
  );
}

function LanguageSheet({ visible, value, onPick, onClose }: { visible: boolean; value: string; onPick: (v: string) => void; onClose: () => void }) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <VHeader title="TRANSLATE POSTS TO" onClose={onClose} />
      {LANGUAGES.map(([code, label], i) => (
        <VRow key={code} label={label} last={i === LANGUAGES.length - 1} onPress={() => onPick(code)} right={value === code ? <MiniIcon name="chev" size={15} color={colors.gold} /> : null} />
      ))}
    </Sheet>
  );
}

/** Sensing is optional at runtime (provider may be absent in tests / previews). */
function useSafeSensing() {
  try {
    return useSensing();
  } catch {
    return null;
  }
}

export default function SettingsScreen({ onClose }: { onClose?: () => void }) {
  const { colors, name: themeName, matchSystem, matchSystemSub, toggleMatchSystem } = useTheme();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const sensing = useSafeSensing();
  const { user, ready } = useIdentity();
  const prefs = usePrefs();
  const { show: showTerms, termsSheet } = useTermsGate();

  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [lang, setLang] = useState(prefs.lang);
  const [autoplay, setAutoplay] = useState(prefs.autoplay);
  const [notify, setNotify] = useState(prefs.notify);
  const [grid3, setGrid3] = useState(prefs.grid3);
  const [gfx, setGfx] = useState(true);
  const [slopOn, setSlopOn] = useState(hideSlop);
  const [blockCount, setBlockCount] = useState(0);
  const [sheet, setSheet] = useState<null | 'delete' | 'contact' | 'lang' | 'blocked'>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ready) return;
    setName(user.name);
    setHandle(user.handle);
    setBio(user.bio || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    setLang(prefs.lang);
    setAutoplay(prefs.autoplay);
    setNotify(prefs.notify);
    setGrid3(prefs.grid3);
  }, [prefs]);

  const syncSafety = () => {
    setGfx(moderation.graphicVeilOn());
    setBlockCount(moderation.getBlocks().length);
  };
  useEffect(() => {
    ensureCore().then(syncSafety);
  }, []);

  const close = () => (onClose ? onClose() : router.canGoBack() ? router.back() : router.replace(ROUTES.profile as any));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setPrefs({ lang, autoplay, notify, grid3 });
    const err = await saveProfile({ name, handle, bio });
    setSaving(false);
    if (err) {
      voidToast(err);
      return;
    }
    close();
  };

  const signOut = async () => {
    await signOutEverywhere();
    await auth.refreshSignedIn().catch(() => {});
    router.replace(ROUTES.onboardingLogin as any);
  };

  const clearAll = () => {
    Alert.alert('Clear all void data?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await ensureCore();
          await signOutEverywhere();
          wipeLocalAccountData();
          await clearUserData();
          await auth.refreshSignedIn().catch(() => {});
          router.replace(ROUTES.onboarding as any);
        },
      },
    ]);
  };

  const langLabel = (LANGUAGES.find(([c]) => c === lang) || LANGUAGES[0])[1];

  return (
    <View style={[st.fill, { backgroundColor: colors.bg }]}>
      {themeName === 'void' ? <RadialFill spec={SETTINGS_RADIAL} /> : colors.bgRadial ? <RadialFill spec={colors.bgRadial} /> : null}
      <KeyboardAvoidingView style={st.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[st.head, { paddingTop: 20 + insets.top }]}>
          <Pressable accessibilityLabel="Back" onPress={close} style={st.back}>
            <Icon name="back" size={18} color={colors.dim} />
          </Pressable>
          <VText style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.3), color: colors.dim }}>SETTINGS</VText>
          <Pressable accessibilityLabel="Close" onPress={close} style={st.closeBtn}>
            <Icon name="x" size={16} color={colors.dim} />
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom }}>
          <View style={st.body}>
            <Section label="Identity">
              <Row label="Display Name">
                <EditInput value={name} onChangeText={setName} placeholder="Your name" maxLength={32} />
              </Row>
              <Row label="Handle">
                <EditInput value={handle} onChangeText={setHandle} placeholder="@handle" maxLength={21} autoCapitalize="none" />
              </Row>
              <Row label="Bio">
                <EditInput value={bio} onChangeText={setBio} placeholder="what you stand for…" maxLength={80} />
              </Row>
              <Row label="Sign out" sub="Return to the identity screen">
                <GhostBtn label="SIGN OUT" onPress={signOut} />
              </Row>
              <Row label="Delete account" sub="Permanently erase your account and everything you posted">
                <GhostBtn label="DELETE" danger onPress={() => setSheet('delete')} />
              </Row>
            </Section>

            <Section label="Language">
              <Row label="Translate posts to" sub="Tap TR on any post in feed to translate">
                <Pressable onPress={() => setSheet('lang')} style={st.select}>
                  <VText style={{ fontFamily: FONTS.mono, fontSize: 10.5, color: colors.white }}>{langLabel}</VText>
                </Pressable>
              </Row>
            </Section>

            <Section label="Appearance">
              <View style={st.themeCards}>
                <ThemeCard t="void" />
                <ThemeCard t="dark" />
                <ThemeCard t="light" />
              </View>
              <Row label="Match system" sub={matchSystemSub}>
                <Toggle on={matchSystem} onPress={toggleMatchSystem} />
              </Row>
            </Section>

            <Section label="Content">
              <Row label="Autoplay Videos" sub="Load video embeds in feed">
                <Toggle on={autoplay} onPress={() => setAutoplay((v) => !v)} />
              </Row>
              <Row label="Notifications" sub="Thread activity alerts">
                <Toggle on={notify} onPress={() => setNotify((v) => !v)} />
              </Row>
              <Row label="Hide slop" sub="AI filler, engagement bait and spam, checked by a local model">
                <Toggle on={slopOn} onPress={() => { setHideSlop(!slopOn); setSlopOn(!slopOn); }} />
              </Row>
              <Row label="Hide graphic content" sub="Blur graphic media until you tap it">
                <Toggle
                  on={gfx}
                  onPress={() => {
                    moderation.setGraphicVeil(!gfx);
                    setGfx(!gfx);
                  }}
                />
              </Row>

            </Section>

            <Section label="Safety">
              <Row label="Blocked accounts" sub={blockCount ? blockCount + ' HIDDEN OR BLOCKED' : 'Accounts and sources you hid'} onPress={() => setSheet('blocked')}>
                <MiniIcon name="chev" size={15} color={colors.dim} />
              </Row>
              <Row label="Contact & support" sub="Support email, terms and privacy" onPress={() => setSheet('contact')}>
                <MiniIcon name="chev" size={15} color={colors.dim} />
              </Row>
              <Row label="Terms of use" sub="Zero tolerance for abuse and objectionable content" onPress={showTerms}>
                <MiniIcon name="chev" size={15} color={colors.dim} />
              </Row>
            </Section>

            <Section label="Body signals">
              {/* One switch per signal; the camera / fingertip / Bluetooth ones ask with a
                  single consent box when switched on (BodySignals.tsx). */}
              <BodySignalsSection sensing={sensing} Row={Row} />
            </Section>

            <Section label="About">
              <Row label="THE VOID" sub="v2.0 · signal in the noise" />
              <Row label="Clear All Data" sub="Reset profile and preferences" onPress={clearAll} labelStyle={{ color: colors.red, fontFamily: FONTS.sansBold }}>
                <VText style={{ color: colors.red, fontSize: 16 }}>›</VText>
              </Row>
            </Section>
          </View>

          <Pressable onPress={save} disabled={saving} style={({ pressed }) => [st.saveBtn, pressed ? { backgroundColor: 'rgba(201,168,76,0.08)' } : null]}>
            <VText style={{ fontFamily: FONTS.sansExtraBold, fontSize: 12, letterSpacing: em(12, 0.1), color: colors.gold }}>{saving ? 'SAVING…' : 'SAVE CHANGES'}</VText>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <DeleteAccountSheet visible={sheet === 'delete'} onClose={() => setSheet(null)} />
      <ContactSheet visible={sheet === 'contact'} onClose={() => setSheet(null)} />
      <LanguageSheet visible={sheet === 'lang'} value={lang} onPick={(v) => { setLang(v); setSheet(null); }} onClose={() => setSheet(null)} />
      <Modal visible={sheet === 'blocked'} animationType="slide" onRequestClose={() => { setSheet(null); syncSafety(); }}>
        <BlockedAccountsScreen onClose={() => { setSheet(null); syncSafety(); }} />
      </Modal>
      {termsSheet}
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  head: { paddingHorizontal: 24, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  closeBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' },
  body: { paddingTop: 10, paddingHorizontal: 24, paddingBottom: 24 },
  section: { paddingTop: 14, paddingBottom: 6 },
  sectionLine: { height: 1, marginTop: 8, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  rowInfo: { flex: 1 },
  editInput: { flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', fontFamily: FONTS.sans, fontSize: 13, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12, marginLeft: 10 },
  ghost: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 24 },
  select: { backgroundColor: 'rgba(255,255,255,0.06)', paddingVertical: 5, paddingHorizontal: 11, borderRadius: 16 },
  themeCards: { flexDirection: 'row', gap: 10, paddingTop: 4, paddingBottom: 10 },
  themeCard: { flex: 1, borderRadius: 14, padding: 6 },
  swatch: { height: 58, borderRadius: 10, overflow: 'hidden' },
  swI: { position: 'absolute', left: 8, right: 8, top: 12, height: 16, borderRadius: 5 },
  swB: { position: 'absolute', left: 8, top: 36, width: 22, height: 5, borderRadius: 3 },
  saveBtn: { marginTop: 16, marginHorizontal: 24, marginBottom: 32, padding: 13, borderWidth: 1, borderColor: 'rgba(201,168,76,0.5)', borderRadius: 24, alignItems: 'center' },
});
