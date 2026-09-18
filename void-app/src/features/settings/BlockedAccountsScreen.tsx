// VMod.blockedSheet() as a screen: blocked Void accounts, hidden authors & sources,
// muted keywords, reported posts. Route-able (router.back on close) or hosted in a
// Modal by Settings (onClose prop).
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MUTED, moderation, srcName, voidUnmute, VoidAPI } from '../../core';
import { useTheme } from '../../theme';
import { FONTS, em } from '../../theme/palettes';
import { VText } from '../../ui/Text';
import { Icon } from '../../ui/icons/Icon';
import { voidToast } from '../../ui/Toast';
import { ensureCore } from '../auth/coreBridge';
import { VAv, VEmpty, VItem, VP, VSec, VTitle } from './vmod';

export default function BlockedAccountsScreen({ onClose }: { onClose?: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);

  useEffect(() => {
    ensureCore().then(async () => {
      refresh();
      if (await moderation.syncModeration().catch(() => false)) refresh();
    });
  }, []);

  const close = () => (onClose ? onClose() : router.canGoBack() ? router.back() : router.replace('/settings' as any));
  const blocks = moderation.getBlocks();
  const v = blocks.filter((b) => !b.external);
  const x = blocks.filter((b) => b.external);
  const muted = [...MUTED];
  const hiddenN = moderation.hiddenCount();
  const ready = VoidAPI._sbReady();

  const unblock = async (key: string) => {
    const msg = await moderation.unblock(key);
    refresh();
    if (msg) voidToast(msg);
  };

  const item = (b: moderation.Block) => (
    <VItem
      key={b.key}
      left={<VAv label={b.label || b.handle} seed={b.label} />}
      label={b.label || b.handle}
      sub={(b.hostOnly ? 'SOURCE' : '@' + (b.handle || '')) + (b.external ? ' · ' + srcName(b.source).toUpperCase() : '')}
      pill={b.external ? 'SHOW' : 'UNBLOCK'}
      onPill={() => unblock(b.key)}
    />
  );

  return (
    <View style={[st.fill, { backgroundColor: colors.bg }]}>
      <View style={[st.head, { paddingTop: 20 + insets.top }]}>
        <Pressable accessibilityLabel="Back" onPress={close} style={st.btn}>
          <Icon name="back" size={18} color={colors.dim} />
        </Pressable>
        <VText style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.3), color: colors.dim }}>SAFETY</VText>
        <Pressable accessibilityLabel="Close" onPress={close} style={[st.btn, { marginLeft: 'auto' }]}>
          <Icon name="x" size={16} color={colors.dim} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 10, paddingBottom: 32 + insets.bottom }}>
        <VTitle>Blocked accounts</VTitle>
        <VP>Blocked Void accounts cannot message you and their posts and replies are hidden everywhere. {ready ? 'Synced to your account.' : 'Stored on this device until you sign in.'}</VP>
        <View>{v.length ? v.map(item) : <VEmpty>NO BLOCKED ACCOUNTS</VEmpty>}</View>
        <VSec>HIDDEN AUTHORS & SOURCES</VSec>
        <View>{x.length ? x.map(item) : <VEmpty>NONE</VEmpty>}</View>
        <VSec>MUTED KEYWORDS</VSec>
        <View>
          {muted.length ? (
            muted.map((m) => (
              <VItem key={m} label={m} pill="UNMUTE" onPill={() => { voidUnmute(m); voidToast('UNMUTED · ' + m.toUpperCase()); refresh(); }} />
            ))
          ) : (
            <VEmpty>NONE</VEmpty>
          )}
        </View>
        {hiddenN ? (
          <>
            <VSec>REPORTED POSTS</VSec>
            <VItem
              label={hiddenN + ' hidden for you'}
              sub="Reports stay filed either way"
              pill="RESTORE"
              onPill={() => { moderation.restoreHidden(); voidToast('RESTORED · REFRESH TO SEE POSTS'); refresh(); }}
            />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  head: { paddingHorizontal: 24, paddingBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 12 },
  btn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});
