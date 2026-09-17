// The ⋯ menu and author sheet on a reel (web VMod.menu(id) / VMod.author(id) /
// reportSheet / pick / submitReport / toggleBlock / muteSheet). Logic lives in
// core/api/moderation; this is the sheet UI.
//
// .vmod-hdr{gap:10px;padding:18px 2px 8px}  .vmod-eyebrow{'Syne Mono' 8px .28em var(--nav-dim) uppercase}
// .vmod-x{margin-left:auto;26x26;color:var(--dim)} .vi 15px
// .vmod-title{'DM Serif Display' 22px/1.2;margin:2px 2px 6px}  .vmod-p{'Syne' 12.5px/1.55 var(--dim);margin:0 2px 10px}
// .vmod-row{gap:14px;padding:14px 2px;box-shadow:inset 0 -1px 0 var(--hairline)} (last: none)  .vi 18px var(--dim)
//   .vmod-row-l{'Syne' 600 13px var(--white)}  .vmod-row-s{'Syne Mono' 8.5px .06em var(--dim);margin-top:3px}
//   .danger → label + icon var(--red);  .on .vi → var(--gold)
// .vmod-radio{16px circle, inset ring 1.5px var(--dim)}  .on → gold ring + 9px gold dot
// .vmod-ta{bg rgba(255,255,255,.04);radius 14;'Syne' 13px;padding 11px 14px;margin 10px 0 4px;min-height 70}
// .vmod-btn{margin-top:14px;padding:13px;border:1px solid rgba(201,168,76,.5);color:var(--gold);'Syne Mono' 9px .2em;radius 24}
//   [disabled] opacity .4   .ghost{border transparent; inset ring rgba(255,255,255,.12); color var(--dim); margin-top 10}
//   .red{border rgba(239,68,68,.55); color var(--red)}
// .vmod-av.big{56px;font 22px;margin:4px auto 10px;background:var(--card2)}
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MUTED, findPost, moderation, voidMute, voidUnmute } from '../../core';
import type { Post } from '../../core';
import { Sheet } from '../../ui/Sheet';
import { Icon } from '../../ui/icons';
import { voidToast } from '../../ui/Toast';
import { useTheme } from '../../theme/tokens';
import { FONTS, em } from '../../theme/palettes';
import { baseId } from '../search/format';
import { ModIcon, type ModIconName } from './ModIcons';

export type ModTarget = { kind: 'menu' | 'author'; post: Post } | null;

type Page = 'menu' | 'author' | 'report' | 'mute';

export function ReelModSheet({ target, onClose, onChanged }: { target: ModTarget; onClose(): void; onChanged(): void }) {
  const { colors } = useTheme();
  const [page, setPage] = useState<Page>('menu');
  const [scope, setScope] = useState<'post' | 'account'>('post');
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [mute, setMute] = useState('');
  const [, force] = useState(0);

  useEffect(() => {
    if (!target) return;
    setPage(target.kind);
    setReason(null);
    setNote('');
    setMute('');
  }, [target]);

  const p = target ? findPost(baseId(target.post.id)) || target.post : null;
  const a = p ? moderation.authorOf(p) : null;
  const id = p ? baseId(p.id) : '';

  const done = (msg: string) => {
    onClose();
    onChanged();
    if (msg) voidToast(msg);
  };

  const Hdr = ({ t }: { t: string }) => (
    <View style={styles.hdr}>
      <Text allowFontScaling={false} numberOfLines={1} style={[styles.eyebrow, { color: colors.navDim }]}>
        {t.toUpperCase()}
      </Text>
      <Pressable onPress={onClose} style={styles.x} accessibilityLabel="Close" hitSlop={8}>
        <Icon name="x" size={15} color={colors.dim} />
      </Pressable>
    </View>
  );
  const Row = ({ icon, l, s, on, cls, last }: { icon?: ModIconName; l: string; s?: string; on(): void; cls?: 'danger' | 'on'; last?: boolean }) => (
    <Pressable
      onPress={on}
      style={({ pressed }) => [styles.row, !last && { boxShadow: `inset 0px -1px 0px ${colors.hairline}` } as any, { opacity: pressed ? 0.72 : 1 }]}
    >
      {icon ? <ModIcon name={icon} size={18} color={cls === 'danger' ? colors.red : cls === 'on' ? colors.gold : colors.dim} /> : null}
      <View style={styles.rowT}>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.rowL, { color: cls === 'danger' ? colors.red : colors.white }]}>
          {l}
        </Text>
        {s ? (
          <Text allowFontScaling={false} style={[styles.rowS, { color: colors.dim }]}>
            {s}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
  const Btn = ({ label, on, variant, disabled }: { label: string; on(): void; variant?: 'ghost' | 'red'; disabled?: boolean }) => (
    <Pressable
      disabled={disabled}
      onPress={on}
      style={[
        styles.btn,
        variant === 'ghost' && { borderColor: 'transparent', boxShadow: 'inset 0px 0px 0px 1px rgba(255,255,255,0.12)', marginTop: 10 },
        variant === 'red' && { borderColor: 'rgba(239,68,68,0.55)' },
        disabled && { opacity: 0.4 },
      ] as any}
    >
      <Text allowFontScaling={false} style={[styles.btnText, { color: variant === 'ghost' ? colors.dim : variant === 'red' ? colors.red : colors.gold }]}>
        {label}
      </Text>
    </Pressable>
  );

  let body: React.ReactNode = null;
  if (p) {
    const who = a ? (a.hostOnly ? a.handle : '@' + (a.handle || a.label)) : '';
    const blocked = a ? moderation.isBlocked(a) : false;
    const doBlock = async () => {
      if (!a) return;
      const msg = await moderation.toggleBlock(a);
      done(msg);
    };
    if (page === 'menu') {
      body = (
        <>
          <Hdr t={who ? 'POST BY ' + who : 'POST'} />
          <Row icon="flag" l="Report post" s="Tell us what is wrong. It is hidden for you right away" on={() => { setScope('post'); setReason(null); setPage('report'); }} />
          {a ? (
            blocked ? (
              <Row icon="block" l={a.external ? 'Show ' + who + ' again' : 'Unblock ' + who} on={doBlock} cls="on" />
            ) : (
              <Row
                icon={a.external ? 'eyeOff' : 'block'}
                l={a.hostOnly ? 'Hide this source' : a.external ? 'Hide @' + a.handle : 'Block @' + (a.handle || a.label)}
                s={a.external ? 'Their posts stop appearing on this device' : 'They can no longer reach you; their posts disappear everywhere'}
                on={doBlock}
                cls="danger"
              />
            )
          ) : null}
          <Row icon="mute" l="Mute a keyword" s="Posts containing it stop appearing" on={() => setPage('mute')} last />
        </>
      );
    } else if (page === 'author') {
      if (a) {
        body = (
          <>
            <Hdr t={a.external ? String(a.source).toUpperCase() + ' ACCOUNT' : 'VOID ACCOUNT'} />
            <View style={[styles.avBig, { backgroundColor: colors.card2 }]}>
              <Text allowFontScaling={false} style={[styles.avBigText, { color: colors.white }]}>
                {String(a.label || '?')[0].toUpperCase()}
              </Text>
            </View>
            <Text allowFontScaling={false} style={[styles.title, { color: colors.white, textAlign: 'center' }]}>
              {a.label}
            </Text>
            <Text allowFontScaling={false} style={[styles.p, { color: colors.dim, textAlign: 'center', fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.1) }]}>
              {who}
              {blocked ? ' · ' + (a.external ? 'HIDDEN' : 'BLOCKED') : ''}
            </Text>
            {blocked ? (
              <Btn label={a.external ? 'SHOW AGAIN' : 'UNBLOCK'} on={doBlock} />
            ) : (
              <Btn label={a.external ? (a.hostOnly ? 'HIDE THIS SOURCE' : 'HIDE THIS AUTHOR') : 'BLOCK'} on={doBlock} variant="red" />
            )}
            <Btn label="REPORT ACCOUNT" variant="ghost" on={() => { setScope('account'); setReason(null); setPage('report'); }} />
          </>
        );
      }
    } else if (page === 'report') {
      const what = scope === 'account' ? 'account' : 'post';
      body = (
        <>
          <Hdr t={'REPORT ' + what} />
          <Text allowFontScaling={false} style={[styles.title, { color: colors.white }]}>
            Why are you reporting this {what}?
          </Text>
          <Text allowFontScaling={false} style={[styles.p, { color: colors.dim }]}>
            Reports are private. We review every report within 24 hours and remove content and accounts that break the terms.
          </Text>
          <View style={styles.list}>
            {moderation.REPORT_REASONS.map(([k, l, s], i) => {
              const on = reason === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => setReason(k)}
                  style={[styles.row, i < moderation.REPORT_REASONS.length - 1 && ({ boxShadow: `inset 0px -1px 0px ${colors.hairline}` } as any)]}
                >
                  <View style={[styles.radio, { borderColor: on ? colors.gold : colors.dim }]}>{on ? <View style={[styles.radioDot, { backgroundColor: colors.gold }]} /> : null}</View>
                  <View style={styles.rowT}>
                    <Text allowFontScaling={false} style={[styles.rowL, { color: colors.white }]}>
                      {l}
                    </Text>
                    <Text allowFontScaling={false} style={[styles.rowS, { color: colors.dim }]}>
                      {s}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={note}
            onChangeText={setNote}
            maxLength={1000}
            multiline
            placeholder="Add a note (optional)"
            placeholderTextColor={colors.dim}
            style={[styles.ta, { color: colors.white }]}
          />
          <Btn
            label="SEND REPORT"
            disabled={!reason}
            on={async () => {
              if (!reason) return;
              const msg = await moderation.submitReport({ scope, id, post: p, author: a }, reason, note);
              done(msg);
            }}
          />
        </>
      );
    } else if (page === 'mute') {
      const list = [...MUTED];
      const doMute = () => {
        const v = mute.trim();
        if (!v) return;
        voidMute(v);
        done('MUTED · ' + v.toUpperCase());
      };
      body = (
        <>
          <Hdr t="MUTE A KEYWORD" />
          <Text allowFontScaling={false} style={[styles.p, { color: colors.dim }]}>
            Posts containing this word or phrase are removed from every surface on this device.
          </Text>
          <TextInput
            value={mute}
            onChangeText={setMute}
            maxLength={60}
            autoFocus
            onSubmitEditing={doMute}
            placeholder="word or phrase"
            placeholderTextColor={colors.dim}
            style={[styles.ta, styles.in, { color: colors.white }]}
          />
          <Btn label="MUTE" on={doMute} />
          {list.length ? (
            <>
              <Text allowFontScaling={false} style={[styles.sec, { color: colors.navDim }]}>
                MUTED
              </Text>
              {list.map((m) => (
                <View key={m} style={[styles.item, { boxShadow: `inset 0px -1px 0px ${colors.hairline}` } as any]}>
                  <Text allowFontScaling={false} numberOfLines={1} style={[styles.rowL, styles.rowT, { color: colors.white }]}>
                    {m}
                  </Text>
                  <Pressable
                    onPress={() => {
                      voidUnmute(m);
                      voidToast('UNMUTED · ' + String(m).toUpperCase());
                      onChanged();
                      force((n) => n + 1);
                    }}
                    style={styles.pill}
                  >
                    <Text allowFontScaling={false} style={[styles.pillText, { color: colors.white }]}>
                      UNMUTE
                    </Text>
                  </Pressable>
                </View>
              ))}
            </>
          ) : null}
        </>
      );
    }
  }

  return (
    <Sheet visible={!!target && !!body} onClose={onClose}>
      {body}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 18, paddingHorizontal: 2, paddingBottom: 8 },
  eyebrow: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.28), flexShrink: 1 },
  x: { marginLeft: 'auto', width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: FONTS.serif, fontSize: 22, lineHeight: 22 * 1.2, marginTop: 2, marginHorizontal: 2, marginBottom: 6 },
  p: { fontFamily: FONTS.sans, fontSize: 12.5, lineHeight: 12.5 * 1.55, marginHorizontal: 2, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 2 },
  rowT: { flex: 1, minWidth: 0 },
  rowL: { fontFamily: FONTS.sansSemiBold, fontSize: 13 },
  rowS: { fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: em(8.5, 0.06), marginTop: 3 },
  list: { marginTop: 4 },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 7, height: 7, borderRadius: 3.5 },
  ta: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    fontFamily: FONTS.sans,
    fontSize: 13,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginTop: 10,
    marginBottom: 4,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  in: { minHeight: 0 },
  btn: { marginTop: 14, padding: 13, borderWidth: 1, borderColor: 'rgba(201,168,76,0.5)', borderRadius: 24, alignItems: 'center' },
  btnText: { fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.2) },
  avBig: { width: 56, height: 56, borderRadius: 28, alignSelf: 'center', marginTop: 4, marginBottom: 10, alignItems: 'center', justifyContent: 'center' },
  avBigText: { fontFamily: FONTS.sansBold, fontSize: 22 },
  sec: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.28), marginTop: 18, marginHorizontal: 2, marginBottom: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 2 },
  pill: { boxShadow: 'inset 0px 0px 0px 1px rgba(255,255,255,0.14)', borderRadius: 16, paddingVertical: 7, paddingHorizontal: 13 } as any,
  pillText: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.16) },
});
