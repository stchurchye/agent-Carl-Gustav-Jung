import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { zh } from '../../../locales/zh-CN';
import { makeKoulli, tapGesture, resetKoulli, type KoulliState, type Gesture } from './koulli';
import type { Koulli } from './story';

const G = zh.games.drama;

/** 默宫仪面板:看礼(示范)→ 复现(跳过禁手)。通仪→onResolved(true);失仪告退→false。 */
export function KoulliPanel({ step, onResolved }: { step: Koulli; onResolved: (solved: boolean) => void }) {
  const [state, setState] = useState<KoulliState>(() =>
    makeKoulli({ length: step.length, paletteSize: step.paletteSize, seed: step.seed }),
  );
  const [phase, setPhase] = useState<'study' | 'input'>('study');
  const done = useRef(false);

  useEffect(() => {
    if (!done.current && state.status === 'won') {
      done.current = true;
      onResolved(true);
    }
  }, [state, onResolved]);
  // 进入新一轮 → 回到看礼
  useEffect(() => {
    if (state.status === 'playing') setPhase('study');
  }, [state.round, state.status]);

  const tap = (g: Gesture) => setState((s) => tapGesture(s, g));
  const retry = () => {
    setState((s) => resetKoulli(s));
    setPhase('study');
  };

  const demo = state.sequence.slice(0, state.round);
  const lost = state.status === 'lost';

  return (
    <View style={styles.box}>
      {step.prompt ? <Text style={styles.prompt}>{step.prompt}</Text> : null}
      <Text style={styles.hint}>{G.koulliHint(state.forbidden)}</Text>

      {lost ? (
        <View style={styles.center}>
          <Text style={styles.failText}>{G.koulliFail}</Text>
          <View style={styles.actions}>
            <Pressable testID="koulli-reset" onPress={retry} style={styles.minorBtn}>
              <Text style={styles.minorText}>{G.koulliReset}</Text>
            </Pressable>
            <Pressable testID="koulli-giveup" onPress={() => onResolved(false)} style={styles.giveUpBtn}>
              <Text style={styles.giveUpText}>{G.koulliGiveUp}</Text>
            </Pressable>
          </View>
        </View>
      ) : phase === 'study' ? (
        <View style={styles.center}>
          <Text style={styles.phaseLabel}>
            {G.koulliWatch}(第 {state.round} 式)
          </Text>
          <View style={styles.demoRow}>
            {demo.map((g, i) => {
              const trap = g === state.forbidden;
              return (
                <View key={i} style={[styles.chip, trap && styles.trapChip]}>
                  <Text style={[styles.chipText, trap && styles.trapText]}>{g}</Text>
                  {trap ? <Text style={styles.trapBadge}>禁</Text> : null}
                </View>
              );
            })}
          </View>
          <Pressable testID="koulli-start" onPress={() => setPhase('input')} style={styles.startBtn}>
            <Text style={styles.startText}>{G.koulliStart}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={styles.phaseLabel}>{G.koulliYourTurn}</Text>
          <View style={styles.demoRow}>
            {Array.from({ length: state.sequence.slice(0, state.round).filter((g) => g !== state.forbidden).length }).map(
              (_, i) => (
                <View key={i} style={[styles.dot, i < state.pos && styles.dotOn]} />
              ),
            )}
          </View>
          <View style={styles.palette}>
            {state.palette.map((g) => {
              const trap = g === state.forbidden;
              return (
                <Pressable
                  key={g}
                  testID={`koulli-g-${g}`}
                  onPress={() => tap(g)}
                  style={[styles.gBtn, trap && step.revealTrap && styles.trapChip]}
                >
                  <Text style={[styles.gText, trap && step.revealTrap && styles.trapText]}>{g}</Text>
                  {trap && step.revealTrap ? <Text style={styles.trapBadge}>禁</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const INK = '#3D3229';

const styles = StyleSheet.create({
  box: { gap: 8 },
  prompt: { fontSize: 15, fontWeight: '700', color: INK },
  hint: { fontSize: 12, color: '#8A8377' },
  center: { alignItems: 'center', gap: 12 },
  phaseLabel: { fontSize: 14, fontWeight: '700', color: '#B3402F' },
  demoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  chip: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: '#E7DCC2',
    borderWidth: 2,
    borderColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trapChip: { backgroundColor: '#9E3B2E', borderColor: '#6E1F16' },
  chipText: { fontSize: 22, fontWeight: '800', color: INK },
  trapText: { color: '#F4EFE4' },
  trapBadge: { position: 'absolute', top: 0, right: 2, fontSize: 9, fontWeight: '900', color: '#F1D67E' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#D8CBB0' },
  dotOn: { backgroundColor: '#3F7A4E' },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  gBtn: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gText: { fontSize: 26, fontWeight: '800', color: INK },
  startBtn: { paddingHorizontal: 24, paddingVertical: 10, backgroundColor: INK, borderRadius: 6 },
  startText: { fontSize: 15, fontWeight: '700', color: '#F4EFE4' },
  failText: { fontSize: 16, fontWeight: '800', color: '#B3402F' },
  actions: { flexDirection: 'row', gap: 12 },
  minorBtn: { paddingHorizontal: 18, paddingVertical: 9, backgroundColor: '#FFFDF7', borderWidth: 2, borderColor: INK, borderRadius: 6 },
  minorText: { fontSize: 14, fontWeight: '700', color: INK },
  giveUpBtn: { paddingHorizontal: 18, paddingVertical: 9, backgroundColor: '#8A8377', borderRadius: 6 },
  giveUpText: { fontSize: 14, fontWeight: '700', color: '#F4EFE4' },
});
