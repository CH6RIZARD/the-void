// VMod sheets (void2-final.html MODERATION / UGC SAFETY): the ⋯ menu for a post or a
// reply, Report (7 reasons + note), Block / Hide author / Hide source, Mute a keyword,
// the author sheet (tap the OP avatar/name) and the terms gate before any write.
//
// Open from anywhere: openPostMenu(post), openCommentMenu(comment, post),
// openAuthorSheet(post), requireTerms(run). The sheet renders in the top-most mounted
// <ModerationHost/> (feed screen, thread screen and the reply overlay each mount one,
// so the sheet always presents above the surface that asked for it).
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { moderation, MUTED, srcName, voidMute, voidUnmute, type Comment, type Post } from '../../core';
import { Sheet } from '../../ui/Sheet';
import { VText } from '../../ui/Text';
import { Icon } from '../../ui/icons';
import { voidToast } from '../../ui/Toast';
import { useTheme } from '../../theme/ThemeProvider';
import { FONTS, em } from '../../theme/palettes';
import { PersonPfp } from '../../ui/Pfp';
import { openUser } from './navigation';
import { sweepModeration } from './stores';
import { VmodIcon, type VmodIconName } from './vmodIcons';

type Author = moderation.Author;

type View_ =
  | { kind: 'menu' }
  | { kind: 'report'; scope: 'post' | 'comment' | 'account' }
  | { kind: 'mute' }
  | { kind: 'author' }
  | { kind: 'terms' };

interface Target {
  kind: 'post' | 'comment';
  id: string;
  p: Post | null;
  c?: Comment;
  a: Author | null;
}

let target: Target | null = null;
let view: View_ | null = null;
let pendingRun: (() => void) | null = null;
let version = 0;
const subs = new Set<() => void>();
const emit = () => {
  version++;
  subs.forEach((f) => f());
};
const sub = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

const baseId = (id: string) => String(id || '').split('~')[0];

export function openPostMenu(p: Post): void {
  target = { kind: 'post', id: baseId(p.id), p, a: moderation.authorOf(p) };
  view = { kind: 'menu' };
  emit();
}
export function openCommentMenu(c: Comment, post: Post | null | undefined): void {
  target = { kind: 'comment', id: c.id, c, p: post || null, a: moderation.authorOfComment(c, post) };
  view = { kind: 'menu' };
  emit();
}
export function openAuthorSheet(p: Post): void {
  const a = moderation.authorOf(p);
  if (!a) {
    if (!p._user) voidToast('NO ACCOUNT TO SHOW');
    return;
  }
  if (a.uid && openUser(a.handle)) return; // a Void account: its profile has block / report
  target = { kind: 'post', id: baseId(p.id), p, a };
  view = { kind: 'author' };
  emit();
}
/** VMod.gate(fn): run now if terms are accepted, else show the terms sheet and run on I AGREE. */
export async function requireTerms(run: () => void): Promise<void> {
  if (await moderation.termsGate()) return run();
  pendingRun = run;
  view = { kind: 'terms' };
  emit();
}
function close() {
  view = null;
  pendingRun = null;
  emit();
}
function go(v: View_) {
  view = v;
  emit();
}

// ─── host stack ───────────────────────────────────────────────────────────
const hosts: number[] = [];
let hostSeq = 0;
const hostSubs = new Set<() => void>();

export function ModerationHost() {
  const [id] = useState(() => ++hostSeq);
  useEffect(() => {
    hosts.push(id);
    hostSubs.forEach((f) => f());
    return () => {
      const i = hosts.indexOf(id);
      if (i >= 0) hosts.splice(i, 1);
      hostSubs.forEach((f) => f());
    };
  }, [id]);
  const top = useSyncExternalStore(
    (f) => {
      hostSubs.add(f);
      return () => {
        hostSubs.delete(f);
      };
    },
    () => hosts[hosts.length - 1],
    () => hosts[hosts.length - 1],
  );
  useSyncExternalStore(sub, () => version, () => version);
  if (top !== id) return null;
  return <SheetBody />;
}

function SheetBody() {
  // Keep the last content on screen while the sheet slides away.
  const last = useRef<View_ | null>(null);
  if (view) last.current = view;
  const v = view || last.current;
  return (
    <Sheet visible={!!view} onClose={close}>
      {v?.kind === 'menu' ? <MenuView /> : null}
      {v?.kind === 'report' ? <ReportView scope={v.scope} /> : null}
      {v?.kind === 'mute' ? <MuteView /> : null}
      {v?.kind === 'author' ? <AuthorView /> : null}
      {v?.kind === 'terms' ? <TermsView /> : null}
    </Sheet>
  );
}

// ─── pieces ───────────────────────────────────────────────────────────────
function Hdr({ title }: { title: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.hdr}>
      <VText numberOfLines={1} style={[styles.eyebrow, { color: colors.navDim }]}>
        {title.toUpperCase()}
      </VText>
      <Pressable onPress={close} style={styles.x} accessibilityLabel="Close" hitSlop={8}>
        <Icon name="x" size={15} color={colors.dim} />
      </Pressable>
    </View>
  );
}

function Row({ icon, label, sub, onPress, tone, last, radio }: { icon?: VmodIconName; label: string; sub?: string; onPress: () => void; tone?: 'danger' | 'on'; last?: boolean; radio?: boolean | null }) {
  const { colors } = useTheme();
  const iconColor = tone === 'danger' ? colors.red : tone === 'on' ? colors.gold : colors.dim;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, !last && { boxShadow: `inset 0px -1px 0px ${colors.hairline}` }, pressed && { opacity: 0.72 }]}>
      {icon ? <VmodIcon name={icon} size={18} color={iconColor} /> : null}
      {radio != null ? (
        <View
          style={[
            styles.radio,
            radio
              ? { boxShadow: `inset 0px 0px 0px 1.5px ${colors.gold}, inset 0px 0px 0px 4.5px ${colors.sheet}, inset 0px 0px 0px 9px ${colors.gold}` }
              : { boxShadow: `inset 0px 0px 0px 1.5px ${colors.dim}` },
          ]}
        />
      ) : null}
      <View style={styles.rowT}>
        <VText numberOfLines={1} style={[styles.rowL, { color: tone === 'danger' ? colors.red : colors.white }]}>
          {label}
        </VText>
        {sub ? <VText style={[styles.rowS, { color: colors.dim }]}>{sub}</VText> : null}
      </View>
    </Pressable>
  );
}

function Btn({ label, onPress, variant, disabled }: { label: string; onPress: () => void; variant?: 'ghost' | 'red'; disabled?: boolean }) {
  const { colors } = useTheme();
  const border = variant === 'ghost' ? 'transparent' : variant === 'red' ? 'rgba(239,68,68,0.55)' : 'rgba(201,168,76,0.5)';
  const color = variant === 'ghost' ? colors.dim : variant === 'red' ? colors.red : colors.gold;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.btn, { borderColor: border, marginTop: variant === 'ghost' ? 10 : 14, opacity: disabled ? 0.4 : 1 }, variant === 'ghost' && { boxShadow: 'inset 0px 0px 0px 1px rgba(255,255,255,0.12)' }]}
    >
      <VText style={[styles.btnT, { color }]}>{label}</VText>
    </Pressable>
  );
}

function P({ children, style }: { children: React.ReactNode; style?: any }) {
  const { colors } = useTheme();
  return <VText style={[styles.p, { color: colors.dim }, style]}>{children}</VText>;
}

function Title({ children, center }: { children: React.ReactNode; center?: boolean }) {
  const { colors } = useTheme();
  return <VText style={[styles.title, { color: colors.white }, center && { textAlign: 'center' }]}>{children}</VText>;
}

const who = (a: Author | null) => (a ? (a.hostOnly ? a.handle : '@' + (a.handle || a.label)) : '');
const blockLabel = (a: Author) => (a.hostOnly ? 'Hide this source' : a.external ? 'Hide @' + a.handle : 'Block @' + (a.handle || a.label));

async function doToggleBlock() {
  const a = target?.a;
  if (!a) return;
  const wasBlocked = moderation.isBlocked(a);
  if (!wasBlocked) close();
  const msg = await moderation.toggleBlock(a);
  sweepModeration();
  if (wasBlocked) close();
  if (msg) voidToast(msg);
}

function MenuView() {
  const t = target;
  if (!t) return null;
  const a = t.a;
  const what = t.kind === 'comment' ? 'reply' : 'post';
  const w = who(a);
  const blocked = a ? moderation.isBlocked(a) : false;
  return (
    <View>
      <Hdr title={w ? `${what.toUpperCase()} BY ${w}` : what.toUpperCase()} />
      <Row icon="flag" label={'Report ' + what} sub="Tell us what is wrong. It is hidden for you right away" onPress={() => go({ kind: 'report', scope: t.kind })} />
      {a ? (
        blocked ? (
          <Row icon="block" tone="on" label={a.external ? `Show ${w} again` : `Unblock ${w}`} onPress={doToggleBlock} />
        ) : (
          <Row
            icon={a.external ? 'eyeOff' : 'block'}
            tone="danger"
            label={blockLabel(a)}
            sub={a.external ? 'Their posts stop appearing on this device' : 'They can no longer reach you; their posts disappear everywhere'}
            onPress={doToggleBlock}
          />
        )
      ) : null}
      <Row icon="mute" label="Mute a keyword" sub="Posts containing it stop appearing" onPress={() => go({ kind: 'mute' })} last />
    </View>
  );
}

function ReportView({ scope }: { scope: 'post' | 'comment' | 'account' }) {
  const { colors } = useTheme();
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const t = target;
  if (!t) return null;
  const what = scope === 'account' ? 'account' : t.kind === 'comment' ? 'reply' : 'post';
  const send = async () => {
    if (!reason) return;
    close();
    const msg = await moderation.submitReport({ scope, id: t.id, post: t.p, author: t.a }, reason, note);
    sweepModeration();
    voidToast(msg);
  };
  return (
    <View>
      <Hdr title={'REPORT ' + what} />
      <Title>Why are you reporting this {what}?</Title>
      <P>Reports are private. We review every report within 24 hours and remove content and accounts that break the terms.</P>
      <View style={styles.list}>
        {moderation.REPORT_REASONS.map(([k, l, s], i) => (
          <Row key={k} radio={reason === k} label={l} sub={s} onPress={() => setReason(k)} last={i === moderation.REPORT_REASONS.length - 1} />
        ))}
      </View>
      <TextInput
        value={note}
        onChangeText={setNote}
        maxLength={1000}
        multiline
        placeholder="Add a note (optional)"
        placeholderTextColor={colors.dim}
        style={[styles.input, styles.ta, { color: colors.white }]}
      />
      <Btn label="SEND REPORT" disabled={!reason} onPress={send} />
    </View>
  );
}

function MuteView() {
  const { colors } = useTheme();
  const [v, setV] = useState('');
  const [, setN] = useState(0);
  const list = [...MUTED];
  const doMute = () => {
    const term = v.trim();
    if (!term) return;
    voidMute(term);
    close();
    sweepModeration();
    voidToast('MUTED · ' + term.toUpperCase());
  };
  return (
    <View>
      <Hdr title="MUTE A KEYWORD" />
      <P>Posts containing this word or phrase are removed from every surface on this device.</P>
      <TextInput
        value={v}
        onChangeText={setV}
        maxLength={60}
        autoFocus
        placeholder="word or phrase"
        placeholderTextColor={colors.dim}
        onSubmitEditing={doMute}
        returnKeyType="done"
        style={[styles.input, { color: colors.white }]}
      />
      <Btn label="MUTE" onPress={doMute} />
      {list.length ? (
        <>
          <VText style={[styles.sec, { color: colors.navDim }]}>MUTED</VText>
          <View style={styles.list}>
            {list.map((m) => (
              <View key={m} style={[styles.item, { boxShadow: `inset 0px -1px 0px ${colors.hairline}` }]}>
                <View style={styles.rowT}>
                  <VText style={[styles.rowL, { color: colors.white }]}>{m}</VText>
                </View>
                <Pressable
                  style={styles.pill}
                  onPress={() => {
                    voidUnmute(m);
                    voidToast('UNMUTED · ' + String(m).toUpperCase());
                    sweepModeration();
                    setN((n) => n + 1);
                  }}
                >
                  <VText style={[styles.pillT, { color: colors.white }]}>UNMUTE</VText>
                </Pressable>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function AuthorView() {
  const { colors } = useTheme();
  const t = target;
  const a = t?.a;
  if (!t || !a) return null;
  const b = moderation.isBlocked(a);
  return (
    <View>
      <Hdr title={a.external ? srcName(a.source).toUpperCase() + ' ACCOUNT' : 'VOID ACCOUNT'} />
      <View style={[styles.avBig, { overflow: 'hidden' }]}>
        <PersonPfp uid={a.uid} handle={a.handle} label={a.label} size={56} />
      </View>
      <Title center>{a.label}</Title>
      <P style={{ textAlign: 'center', fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.1) }}>
        {who(a)}
        {b ? ' · ' + (a.external ? 'HIDDEN' : 'BLOCKED') : ''}
      </P>
      {b ? (
        <Btn label={a.external ? 'SHOW AGAIN' : 'UNBLOCK'} onPress={doToggleBlock} />
      ) : (
        <Btn variant="red" label={a.external ? (a.hostOnly ? 'HIDE THIS SOURCE' : 'HIDE THIS AUTHOR') : 'BLOCK'} onPress={doToggleBlock} />
      )}
      <Btn variant="ghost" label="REPORT ACCOUNT" onPress={() => go({ kind: 'report', scope: 'account' })} />
    </View>
  );
}

const TERMS: Array<[string | null, string]> = [
  ['Zero tolerance.', ' The Void does not tolerate objectionable content or abusive users.'],
  [null, 'No harassment, hate, threats or glorified violence, sexual content involving minors or anyone without consent, spam, scams or deliberate misinformation.'],
  [null, 'Anyone can report a post, reply or account. We review reports within 24 hours, remove content that breaks these terms and ban the accounts that post it.'],
  [null, 'You can block an account, hide a source or mute a keyword from ··· on any post.'],
];

function TermsView() {
  const { colors } = useTheme();
  const agree = async () => {
    const run = pendingRun;
    pendingRun = null;
    view = null;
    emit();
    await moderation.acceptTerms();
    voidToast('TERMS ACCEPTED');
    try {
      run?.();
    } catch {}
  };
  return (
    <View>
      <Hdr title="BEFORE YOU POST" />
      <Title>Terms of use</Title>
      <View style={styles.terms}>
        {TERMS.map(([b, txt], i) => (
          <View key={i} style={[styles.termLi, { boxShadow: `inset 0px -1px 0px ${colors.hairline}` }]}>
            <View style={[styles.termDash, { backgroundColor: colors.gold }]} />
            <VText style={[styles.termT, { color: colors.white }]}>
              {b ? (
                <VText weight={700} style={[styles.termT, { color: colors.gold }]}>
                  {b}
                </VText>
              ) : null}
              {txt}
            </VText>
          </View>
        ))}
      </View>
      <View style={styles.links}>
        <Pressable onPress={() => Linking.openURL(moderation.TERMS_URL).catch(() => {})} style={styles.link}>
          <VText style={[styles.linkT, { color: colors.gold }]}>READ THE FULL TERMS (EULA)</VText>
          <VmodIcon name="ext" size={12} color={colors.gold} />
        </Pressable>
        <Pressable onPress={() => Linking.openURL(moderation.PRIVACY_URL).catch(() => {})} style={styles.link}>
          <VText style={[styles.linkT, { color: colors.gold }]}>PRIVACY</VText>
          <VmodIcon name="ext" size={12} color={colors.gold} />
        </Pressable>
      </View>
      <P style={{ marginTop: 14, fontSize: 11, lineHeight: 11 * 1.55 }}>By tapping I AGREE you accept the Terms of Use and confirm you will not post objectionable content or abuse other users.</P>
      <Btn label="I AGREE" onPress={agree} />
      <Btn variant="ghost" label="NOT NOW" onPress={close} />
    </View>
  );
}

const styles = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 18, paddingBottom: 8, paddingHorizontal: 2 },
  eyebrow: { flexShrink: 1, fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.28) },
  x: { marginLeft: 'auto', width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: FONTS.serif, fontSize: 22, lineHeight: 22 * 1.2, marginTop: 2, marginBottom: 6, marginHorizontal: 2 },
  p: { fontFamily: FONTS.sans, fontSize: 12.5, lineHeight: 12.5 * 1.55, marginHorizontal: 2, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, width: '100%', paddingVertical: 14, paddingHorizontal: 2 },
  rowT: { flex: 1, minWidth: 0 },
  rowL: { fontFamily: FONTS.sansSemiBold, fontSize: 13 },
  rowS: { fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: em(8.5, 0.06), marginTop: 3 },
  radio: { width: 16, height: 16, borderRadius: 8 },
  list: { marginTop: 4 },
  input: { width: '100%', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, fontFamily: FONTS.sans, fontSize: 13, paddingVertical: 11, paddingHorizontal: 14, marginTop: 10, marginBottom: 4 },
  ta: { minHeight: 70, textAlignVertical: 'top' },
  btn: { width: '100%', padding: 13, borderWidth: 1, borderRadius: 24, alignItems: 'center' },
  btnT: { fontFamily: FONTS.mono, fontSize: 9, letterSpacing: em(9, 0.2) },
  sec: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.28), marginTop: 18, marginHorizontal: 2, marginBottom: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 2 },
  pill: { borderRadius: 16, paddingVertical: 7, paddingHorizontal: 13, boxShadow: 'inset 0px 0px 0px 1px rgba(255,255,255,0.14)' },
  pillT: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.16) },
  avBig: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 4, marginBottom: 10 },
  terms: { marginTop: 4, marginHorizontal: 2 },
  termLi: { paddingVertical: 9, paddingLeft: 18, position: 'relative' },
  termDash: { position: 'absolute', left: 2, top: 16, width: 6, height: 1.5 },
  termT: { fontFamily: FONTS.sans, fontSize: 12.5, lineHeight: 12.5 * 1.5 },
  links: { flexDirection: 'row', flexWrap: 'wrap' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, marginRight: 8, marginLeft: 2 },
  linkT: { fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: em(8.5, 0.16) },
});
