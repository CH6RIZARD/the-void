// EDIT PROFILE — name / handle / bio / avatar. Field styling follows .si-field (the
// web's only form vocabulary); saving mirrors saveSettings() + a profiles upsert.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../theme';
import { FONTS, em } from '../../theme/palettes';
import { Sheet } from '../../ui/Sheet';
import { Pill } from '../../ui/Pill';
import { VText } from '../../ui/Text';
import { voidToast } from '../../ui/Toast';
import { useIdentity } from '../auth/coreBridge';
import { HANDLE_MAX, stripHandle } from '../auth/handles';
import { pickMedia, type PickedMedia } from '../composer/media';
import { VHeader } from '../settings/vmod';
import { ProfileAvatar } from './ProfileAvatar';
import { saveProfile } from './profileApi';

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { colors } = useTheme();
  const [focus, setFocus] = useState(false);
  const { label, ...rest } = props;
  return (
    <View style={st.field}>
      <VText style={{ fontFamily: FONTS.mono, fontSize: 7, letterSpacing: em(7, 0.22), color: colors.navDim }}>{label}</VText>
      <TextInput
        placeholderTextColor={colors.navDim}
        selectionColor={colors.gold}
        cursorColor={colors.gold}
        autoCorrect={false}
        {...rest}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={[st.input, { color: colors.white }, focus ? { boxShadow: 'inset 0px 0px 0px 1px rgba(201,168,76,0.45)' } : null]}
      />
    </View>
  );
}

export function EditProfileSheet({ visible, onClose, avatarUrl, onSaved }: { visible: boolean; onClose: () => void; avatarUrl?: string | null; onSaved?: () => void }) {
  const { colors } = useTheme();
  const { user } = useIdentity();
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<PickedMedia | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(user.name || '');
    setHandle(stripHandle(user.handle));
    setBio(user.bio || '');
    setAvatar(null);
    setErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pick = async () => {
    try {
      const [m] = await pickMedia({ multiple: false, imagesOnly: true, square: true });
      if (m) setAvatar(m);
    } catch (e: any) {
      voidToast(String((e && e.message) || 'GALLERY UNAVAILABLE'));
    }
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    const e = await saveProfile({ name, handle, bio, avatar });
    setBusy(false);
    if (e) {
      setErr(e);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    voidToast('PROFILE SAVED');
    onSaved?.();
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <VHeader title="EDIT PROFILE" onClose={onClose} />
      <Pressable onPress={pick} style={st.avRow} accessibilityLabel="Change avatar">
        {avatar ? (
          <View style={st.avWrap}>
            <Image source={{ uri: avatar.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          </View>
        ) : (
          <ProfileAvatar name={name || user.name} url={avatarUrl} />
        )}
        <VText style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.2), color: colors.gold }}>CHANGE AVATAR</VText>
      </Pressable>
      <Field label="DISPLAY NAME" value={name} onChangeText={setName} placeholder="Your name" maxLength={32} />
      <Field label="HANDLE" value={handle} onChangeText={setHandle} placeholder="handle" autoCapitalize="none" maxLength={HANDLE_MAX} />
      <Field label="BIO" value={bio} onChangeText={setBio} placeholder="what you stand for…" maxLength={80} />
      <VText style={{ minHeight: 14, fontFamily: FONTS.mono, fontSize: 7.5, letterSpacing: em(7.5, 0.14), color: colors.red, marginTop: 10 }}>{err}</VText>
      <Pill variant="gold" label={busy ? 'SAVING…' : 'SAVE CHANGES'} onPress={save} disabled={busy} style={{ marginTop: 6 }} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  avRow: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingTop: 8 },
  avWrap: { width: 72, height: 72, borderRadius: 36, overflow: 'hidden', boxShadow: '0px 0px 0px 1px rgba(201,168,76,0.45)' },
  field: { gap: 7, marginTop: 22 },
  input: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 15, fontFamily: FONTS.sans, fontSize: 14 },
});
