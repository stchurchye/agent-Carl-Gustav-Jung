import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { zh } from '../../../locales/zh-CN';
import { castMember } from './cast';
import { buildDebate, rebut, MOMENTUM_MAX, WIN_AT, type DebateState } from './debate';
import type { Debate } from './story';

const G = zh.games.drama;

/** 公堂辩论面板:逐轮择驳词对垒气势。压服→onResolved(true);被驳哑/认输→false。 */
export function DebatePanel({ step, onResolved }: { step: Debate; onResolved: (won: boolean) => void }) {
  const [state, setState] = useState<DebateState>(() => buildDebate(step.rounds));
  const done = useRef(false);

  useEffect(() => {
    if (!done.current && state.status === 'won') {
      done.current = true;
      onResolved(true);
    }
  }, [state, onResolved]);

  const pick = (i: number) => setState((s) => rebut(s, i));
  const reset = () => {
    done.current = false;
    setState(buildDebate(step.rounds));
  };

  const round = state.rounds[state.idx];
  const lost = state.status === 'lost';
  const pct = Math.round((state.momentum / MOMENTUM_MAX) * 100);
  const argWho = round?.who ? castMember(round.who)?.name : undefined;
  // 被驳哑(气势归零)与落下风(辩完气势不足)两种败北,文案分开
  const lostText = state.momentum <= 0 ? G.debateLost : G.debateLostFell;

  return (
    <View style={styles.box}>
      {step.prompt ? <Text style={styles.prompt}>{step.prompt}</Text> : null}
      <Text style={styles.hint}>{G.debateHint}</Text>

      {/* 气势条(含压服线) */}
      <View style={styles.meterRow}>
        <Text style={styles.meterLabel}>{G.debateMomentum}</Text>
        <View style={styles.barBg}>
          <View style={[styles.barFill, { width: `${pct}%` }, state.momentum < WIN_AT && styles.barLow]} />
          <View style={[styles.winMark, { left: `${WIN_AT}%` }]} />
        </View>
        {state.lastDelta !== 0 ? (
          <Text style={[styles.delta, state.lastDelta > 0 ? styles.deltaUp : styles.deltaDown]}>
            {G.debateGain(state.lastDelta)}
          </Text>
        ) : null}
      </View>

      {lost ? (
        <View style={styles.center}>
          <Text style={styles.lostText}>{lostText}</Text>
          <View style={styles.actions}>
            <Pressable testID="debate-reset" onPress={reset} style={styles.minorBtn}>
              <Text style={styles.minorText}>{G.debateReset}</Text>
            </Pressable>
            <Pressable testID="debate-giveup" onPress={() => onResolved(false)} style={styles.giveUpBtn}>
              <Text style={styles.giveUpText}>{G.debateGiveUp}</Text>
            </Pressable>
          </View>
        </View>
      ) : round ? (
        <>
          <Text style={styles.roundNo}>{G.debateRound(state.idx + 1, state.rounds.length)}</Text>
          <View style={styles.argueBox}>
            {argWho ? <Text style={styles.argueWho}>{argWho}</Text> : null}
            <Text style={styles.argueText}>{round.argument}</Text>
          </View>
          {round.rebuttals.map((r, i) => (
            <Pressable key={i} testID={`debate-rebut-${i}`} onPress={() => pick(i)} style={styles.optBtn}>
              <Text style={styles.optText}>{r.label}</Text>
            </Pressable>
          ))}
        </>
      ) : null}
    </View>
  );
}

const INK = '#3D3229';

const styles = StyleSheet.create({
  box: { gap: 8 },
  prompt: { fontSize: 15, fontWeight: '700', color: INK },
  hint: { fontSize: 12, color: '#8A8377' },
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meterLabel: { fontSize: 13, fontWeight: '700', color: INK },
  barBg: { flex: 1, height: 16, backgroundColor: '#E7DCC2', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#B7A985' },
  barFill: { height: '100%', backgroundColor: '#C99A3B' },
  barLow: { backgroundColor: '#8A8377' },
  winMark: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#3F7A4E' },
  delta: { fontSize: 13, fontWeight: '800', minWidth: 56, textAlign: 'right' },
  deltaUp: { color: '#3F7A4E' },
  deltaDown: { color: '#B3402F' },
  roundNo: { fontSize: 13, color: '#8A8377', fontWeight: '700' },
  argueBox: { backgroundColor: '#FFFDF7', borderWidth: 2, borderColor: INK, borderRadius: 8, padding: 12, gap: 4 },
  argueWho: { fontSize: 13, fontWeight: '800', color: '#B3402F' },
  argueText: { fontSize: 15, color: INK, lineHeight: 22 },
  optBtn: { backgroundColor: '#FFFDF7', borderWidth: 2, borderColor: INK, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 11 },
  optText: { fontSize: 15, color: INK },
  center: { alignItems: 'center', gap: 10 },
  lostText: { fontSize: 16, fontWeight: '800', color: '#B3402F' },
  actions: { flexDirection: 'row', gap: 12 },
  minorBtn: { paddingHorizontal: 18, paddingVertical: 9, backgroundColor: '#FFFDF7', borderWidth: 2, borderColor: INK, borderRadius: 6 },
  minorText: { fontSize: 14, fontWeight: '700', color: INK },
  giveUpBtn: { paddingHorizontal: 18, paddingVertical: 9, backgroundColor: '#8A8377', borderRadius: 6 },
  giveUpText: { fontSize: 14, fontWeight: '700', color: '#F4EFE4' },
});
