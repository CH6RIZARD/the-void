// VMod.author() + reportSheet('account') — block / unblock / report a Void account.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { moderation } from '../../core';
import { useTheme } from '../../theme';
import { FONTS, em } from '../../theme/palettes';
import { Sheet } from '../../ui/Sheet';
import { VText } from '../../ui/Text';
import { voidToast } from '../../ui/Toast';
import { ensureCore } from '../auth/coreBridge';
import { VAv, VBtn, VHeader, VInput, VP, VTitle } from '../settings/vmod';

export function voidAuthor(p: { id: string; handle: string; name?: string | null }): moderation.Author {
  const handle = String(p.handle || '').replace(/^@/, '').toLowerCase();
  return { key: 'uid:' + p.id, uid: p.id, handle, label: p.name || handle || 'Void user', source: 'void', external: false };
}

function Radio({ on }: { on: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[st.radio, { borderColor: on ? colors.gold : colors.dim }]}>
      {on ? <View style={[st.radioDot, { backgroundColor: colors.gold }]} /> : null}
    </View>
  );
}

export function ReportSheet({ visible, author, onClose }: { visible: boolean; author: moderation.Author | null; onClose: () => void }) {
  const { colors } = useTheme();
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (visible) {
      setReason(null);
      setNote('');
    }
  }, [visible]);
  const send = async () => {
    if (!author || !reason) return;
    onClose();
    await ensureCore();
    const msg = await moderation.submitReport({ scope: 'account', id: author.uid || author.key, author }, reason, note);
    voidToast(msg);
  };
  return (
    <Sheet visible={visible} onClose={onClose}>
      <VHeader title="REPORT ACCOUNT" onClose={onClose} />
      <VTitle>Why are you reporting this account?</VTitle>
      <VP>Reports are private. We review every report within 24 hours and remove content and accounts that break the terms.</VP>
      <View style={{ marginTop: 4 }}>
        {moderation.REPORT_REASONS.map(([k, l, s], i) => (
          <Pressable key={k} onPress={() => setReason(k)} style={[st.row, i < moderation.REPORT_REASONS.length - 1 ? { boxShadow: `inset 0px -1px 0px ${colors.hairline}` } : null]}>
            <Radio on={reason === k} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <VText numberOfLines={1} style={{ fontFamily: FONTS.sansSemiBold, fontSize: 13, color: colors.white }}>{l}</VText>
              <VText style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: em(8.5, 0.06), color: colors.dim, marginTop: 3 }}>{s}</VText>
            </View>
          </Pressable>
        ))}
      </View>
      <VInput area value={note} onChangeText={setNote} maxLength={1000} placeholder="Add a note (optional)" />
      <VBtn label="SEND REPORT" disabled={!reason} onPress={send} />
    </Sheet>
  );
}

/** The account sheet: avatar, name, handle, BLOCK / UNBLOCK, REPORT ACCOUNT. */
export function AccountSheet({ visible, author, onClose, onChanged }: { visible: boolean; author: moderation.Author | null; onClose: () => void; onChanged?: () => void }) {
  const { colors } = useTheme();
  const [reporting, setReporting] = useState(false);
  const blocked = !!author && moderation.isBlocked(author);
  const toggle = async () => {
    if (!author) return;
    onClose();
    await ensureCore();
    const msg = await moderation.toggleBlock(author);
    if (msg) voidToast(msg);
    onChanged?.();
  };
  return (
    <>
      <Sheet visible={visible && !reporting} onClose={onClose}>
        <VHeader title="VOID ACCOUNT" onClose={onClose} />
        {author ? (
          <>
            <VAv big label={author.label} uid={author.uid} handle={author.handle} />
            <VTitle center>{author.label}</VTitle>
            <VP style={{ textAlign: 'center', fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.1) }}>
              {'@' + (author.handle || author.label) + (blocked ? ' · BLOCKED' : '')}
            </VP>
            {blocked ? <VBtn label="UNBLOCK" onPress={toggle} /> : <VBtn label="BLOCK" kind="red" onPress={toggle} />}
            <VBtn label="REPORT ACCOUNT" kind="ghost" onPress={() => setReporting(true)} />
          </>
        ) : null}
      </Sheet>
      <ReportSheet
        visible={visible && reporting}
        author={author}
        onClose={() => {
          setReporting(false);
          onClose();
        }}
      />
    </>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 2 },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 7, height: 7, borderRadius: 3.5 },
});
