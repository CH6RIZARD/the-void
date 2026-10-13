// Suggest a question (handoff THE-VOID-22b §4): a bottom sheet in three steps with
// pips, write -> rank -> sent.
//   write  textarea 12–140 chars + counter. "Before it goes up, you vote on N on the
//          floor." N = GATE_SIZE capped by the floor questions you have not voted on;
//          none -> "Send for review" skips the gate.
//   rank   one candidate at a time, the N least-voted floor questions you have not
//          voted on. Up or down both count. "K more to go" -> "Publish for review".
//   sent   confirmation; the question joins the floor under Mine with 0/0.
// Closing after Sent resets the flow; closing mid-flow keeps the draft.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { useInk } from '../../theme/ink';
import { FONTS, em } from '../../theme/palettes';
import { Sheet } from '../../ui/Sheet';
import { Icon } from '../../ui/icons';
import { VText } from '../../ui/Text';
import { ago } from '../feed/format';
import { GATE_SIZE, MAXLEN, MINLEN, gateFor, publish, usePolls, vote, type FloorQ } from './pollsStore';

type Step = 'write' | 'rank' | 'sent';
const GOLD = '#c9a84c';

export function SuggestSheet({ visible, onClose, draft, setDraft }: { visible: boolean; onClose: () => void; draft: string; setDraft: (s: string) => void }) {
  const { colors } = useTheme();
  const ink = useInk();
  usePolls();
  const [step, setStep] = useState<Step>('write');
  const [gate, setGate] = useState<FloorQ[]>([]);
  const [done, setDone] = useState(0);
  const [sentQ, setSentQ] = useState('');

  const reset = () => {
    setStep('write');
    setGate([]);
    setDone(0);
    setDraft('');
  };
  useEffect(() => {
    if (!visible && step === 'sent') reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const okLen = draft.trim().length >= MINLEN;
  const req = Math.min(GATE_SIZE, gateFor(99).length);
  const send = () => {
    const f = publish(draft);
    setSentQ(f.q);
    setStep('sent');
  };
  const next = () => {
    if (!okLen) return;
    if (req === 0) return send();
    setGate(gateFor(GATE_SIZE));
    setDone(0);
    setStep('rank');
  };
  const cur = step === 'rank' && done < gate.length ? gate[done] : null;
  const gateDone = step === 'rank' && done >= gate.length;
  const gv = (dir: 1 | -1) => {
    if (!cur) return;
    vote(cur.id, dir);
    setDone((d) => d + 1);
  };

  return (
    <Sheet visible={visible} onClose={onClose} contentStyle={styles.body}>
      <View style={styles.pips}>
        {(['write', 'rank', 'sent'] as Step[]).map((s) => (
          <View key={s} style={[styles.pip, { backgroundColor: step === s ? GOLD : colors.navDim }]} />
        ))}
      </View>
      {step === 'write' ? (
        <>
          <VText style={[styles.title, { color: colors.white }]}>Suggest a question</VText>
          <TextInput
            value={draft}
            onChangeText={(t) => setDraft(t.slice(0, MAXLEN))}
            placeholder="What should The Void ask next?"
            placeholderTextColor={colors.navDim}
            multiline
            style={[styles.input, { color: colors.white, backgroundColor: colors.card }]}
            allowFontScaling={false}
          />
          <VText style={[styles.count, { color: colors.navDim }]}>{draft.length + ' / ' + MAXLEN}</VText>
          <VText style={[styles.note, { color: ink.muted }]}>
            {req === 0 ? 'Nothing is on the floor yet, so there is nothing to rank. Yours goes straight to the Void.' : `Before it goes up, you vote on ${req} on the floor. Ups and downs both show.`}
          </VText>
          <Pressable onPress={next} disabled={!okLen} style={[styles.btn, okLen ? styles.btnGold : styles.btnOff]}>
            <VText style={[styles.btnT, { color: okLen ? '#1a1030' : colors.navDim }]}>{!okLen ? 'At least ' + MINLEN + ' characters' : req === 0 ? 'Send for review' : 'Next · vote on ' + req}</VText>
          </Pressable>
        </>
      ) : step === 'rank' ? (
        <>
          <VText style={[styles.title, { color: colors.white }]}>{gateDone ? 'Done. Yours is ready.' : `Vote on ${gate.length} before yours goes up.`}</VText>
          <VText style={[styles.note, { color: ink.muted }]}>
            {gateDone ? 'Publish it and it joins the floor.' : gate.length < GATE_SIZE ? `Only ${gate.length} on the floor so far, so ${gate.length} it is.` : 'These have the fewest votes, so they need eyes most. Up or down, both count.'}
          </VText>
          <View style={styles.gatePips}>
            {gate.map((g, i) => (
              <View key={g.id} style={[styles.gatePip, i < done ? styles.gatePipOn : { backgroundColor: ink.card, boxShadow: 'inset 0px 1px 2px rgba(0,0,0,0.8), inset 0px 0px 0px 1px rgba(201,168,76,0.15)' }]} />
            ))}
          </View>
          {cur ? (
            <View style={[styles.cand, { backgroundColor: colors.card }]}>
              <VText style={[styles.candQ, { color: colors.white }]}>{cur.q}</VText>
              <VText style={[styles.candBy, { color: ink.muted }]}>{'@' + cur.by + ' · ' + ago(cur.t) + ' · ' + cur.up + ' up · ' + cur.down + ' down'}</VText>
              <View style={styles.candVotes}>
                <Pressable onPress={() => gv(1)} style={[styles.voteBtn, styles.btnGold]} accessibilityLabel="Up">
                  <Icon name="arrowUp" size={16} color="#1a1030" />
                  <VText style={[styles.btnT, { color: '#1a1030' }]}>Up</VText>
                </Pressable>
                <Pressable onPress={() => gv(-1)} style={[styles.voteBtn, styles.btnOff]} accessibilityLabel="Down">
                  <Icon name="arrowDown" size={16} color="#8d7cc0" />
                  <VText style={[styles.btnT, { color: ink.muted }]}>Down</VText>
                </Pressable>
              </View>
            </View>
          ) : null}
          <Pressable onPress={() => gateDone && send()} disabled={!gateDone} style={[styles.btn, gateDone ? styles.btnGold : styles.btnOff]}>
            <VText style={[styles.btnT, { color: gateDone ? '#1a1030' : colors.navDim }]}>{gateDone ? 'Publish for review' : gate.length - done + ' more to go'}</VText>
          </Pressable>
        </>
      ) : (
        <>
          <VText style={[styles.kicker, { color: GOLD }]}>SENT</VText>
          <VText style={[styles.title, { color: colors.white }]}>It is on the floor.</VText>
          <VText style={[styles.sentQ, { color: colors.white }]}>{sentQ}</VText>
          <VText style={[styles.note, { color: ink.muted }]}>Yours sits under Mine with 0 / 0 until the floor votes on it.</VText>
          <Pressable onPress={onClose} style={[styles.btn, styles.btnGold]}>
            <VText style={[styles.btnT, { color: '#1a1030' }]}>Done</VText>
          </Pressable>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 22, paddingTop: 12, gap: 12 },
  pips: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  pip: { width: 6, height: 6, borderRadius: 3 },
  kicker: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.25) },
  title: { fontFamily: FONTS.serif, fontSize: 24, lineHeight: 29 },
  input: { fontFamily: FONTS.serifItalic, fontSize: 18, lineHeight: 25, minHeight: 96, maxHeight: 160, borderRadius: 14, padding: 14, textAlignVertical: 'top' },
  count: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.1), textAlign: 'right' },
  note: { fontFamily: FONTS.sans, fontSize: 12.5, lineHeight: 18 },
  btn: { paddingVertical: 13, borderRadius: 22, alignItems: 'center' },
  btnGold: { backgroundColor: GOLD, boxShadow: 'inset 0px 1px 0px rgba(255,245,200,0.65), 0px 3px 10px rgba(201,168,76,0.28)' },
  btnOff: { backgroundColor: 'rgba(255,255,255,0.05)' },
  btnT: { fontFamily: FONTS.sansBold, fontSize: 12 },
  gatePips: { flexDirection: 'row', gap: 8 },
  gatePip: { flex: 1, height: 5, borderRadius: 3 },
  gatePipOn: { backgroundColor: GOLD, boxShadow: '0px 0px 8px rgba(201,168,76,0.35)' },
  cand: { borderRadius: 16, padding: 16, gap: 8 },
  candQ: { fontFamily: FONTS.serif, fontSize: 19, lineHeight: 25 },
  candBy: { fontFamily: FONTS.mono, fontSize: 8, letterSpacing: em(8, 0.08) },
  candVotes: { flexDirection: 'row', gap: 10, marginTop: 4 },
  voteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 20 },
  sentQ: { fontFamily: FONTS.serifItalic, fontSize: 19, lineHeight: 26 },
});
export default SuggestSheet;
