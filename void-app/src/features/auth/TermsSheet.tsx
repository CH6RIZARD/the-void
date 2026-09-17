// VMod.termsSheet + gate(fn): the EULA sheet shown before the first write (drop, DM).
//   const { gate, termsSheet } = useTermsGate();
//   gate(() => send());          // runs now if accepted (locally or on another device)
//   return <>{...}{termsSheet}</>;
import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { moderation } from '../../core';
import { useTheme } from '../../theme';
import { FONTS } from '../../theme/palettes';
import { Sheet } from '../../ui/Sheet';
import { VText } from '../../ui/Text';
import { voidToast } from '../../ui/Toast';
import { VBtn, VHeader, VLink, VP, VTitle } from '../settings/vmod';
import { ensureCore } from './coreBridge';

const TERMS: Array<[string | null, string]> = [
  ['Zero tolerance.', ' The Void does not tolerate objectionable content or abusive users.'],
  [null, 'No harassment, hate, threats or glorified violence, sexual content involving minors or anyone without consent, spam, scams or deliberate misinformation.'],
  [null, 'Anyone can report a post, reply or account. We review reports within 24 hours, remove content that breaks these terms and ban the accounts that post it.'],
  [null, 'You can block an account, hide a source or mute a keyword from ··· on any post.'],
];

export function TermsSheet({ visible, onAgree, onClose }: { visible: boolean; onAgree: () => void; onClose: () => void }) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <VHeader title="BEFORE YOU POST" onClose={onClose} />
      <VTitle>Terms of use</VTitle>
      <View style={{ marginTop: 4, marginHorizontal: 2 }}>
        {TERMS.map(([b, t], i) => (
          <View key={i} style={[st.li, { boxShadow: `inset 0px -1px 0px ${colors.hairline}` }]}>
            <View style={[st.dash, { backgroundColor: colors.gold }]} />
            <VText style={{ fontFamily: FONTS.sans, fontSize: 12.5, lineHeight: 12.5 * 1.5, color: colors.white }}>
              {b ? <VText style={{ fontFamily: FONTS.sansBold, fontSize: 12.5, color: colors.gold }}>{b}</VText> : null}
              {t}
            </VText>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <VLink label="READ THE FULL TERMS (EULA)" url={moderation.TERMS_URL} />
        <VLink label="PRIVACY" url={moderation.PRIVACY_URL} />
      </View>
      <VP style={{ marginTop: 14, fontSize: 11, lineHeight: 11 * 1.55 }}>By tapping I AGREE you accept the Terms of Use and confirm you will not post objectionable content or abuse other users.</VP>
      <VBtn label="I AGREE" onPress={onAgree} />
      <VBtn label="NOT NOW" kind="ghost" onPress={onClose} />
    </Sheet>
  );
}

export function useTermsGate() {
  const [open, setOpen] = useState(false);
  const pending = useRef<null | (() => void)>(null);

  const gate = useCallback(async (fn: () => void) => {
    await ensureCore();
    if (await moderation.termsGate()) return fn();
    pending.current = fn;
    setOpen(true);
  }, []);

  const agree = useCallback(async () => {
    const run = pending.current;
    pending.current = null;
    setOpen(false);
    await moderation.acceptTerms();
    voidToast('TERMS ACCEPTED');
    if (run) setTimeout(run, 240);
  }, []);

  const close = useCallback(() => {
    pending.current = null;
    setOpen(false);
  }, []);

  /** Read-only open (Settings → Terms of use). */
  const show = useCallback(() => setOpen(true), []);

  const termsSheet = <TermsSheet visible={open} onAgree={agree} onClose={close} />;
  return { gate, termsSheet, show };
}

const st = StyleSheet.create({
  li: { paddingVertical: 9, paddingLeft: 18, position: 'relative' },
  dash: { position: 'absolute', left: 2, top: 16, width: 6, height: 1.5 },
});
