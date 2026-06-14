import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { zh } from '../../../locales/zh-CN';
import { makePairing, cycleMark, clearMarks, isCorrect, type PairingState } from './pairing';
import type { Pairing } from './story';

const G = zh.games.drama;

/** 验毒配伍面板:凭医案逐格标 安/烈,呈对 → onResolved(true);标错/弃局 → false。 */
export function PairingPanel({ step, onResolved }: { step: Pairing; onResolved: (solved: boolean) => void }) {
  const [state, setState] = useState<PairingState>(() =>
    makePairing({ n: step.n ?? 5, clueBudget: step.clueBudget, useCounts: step.useCounts, seed: step.seed }),
  );
  const n = state.n;
  const TILE = n >= 6 ? 32 : 38;

  const unknown = useMemo(() => {
    let c = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (state.marks[i][j] === 'unknown') c++;
    return c;
  }, [state, n]);

  const tap = (i: number, j: number) => setState((s) => cycleMark(s, i, j));

  const cellGlyph = (m: string) => (m === 'lethal' ? '烈' : m === 'safe' ? '安' : '');

  return (
    <View style={styles.box}>
      {step.prompt ? <Text style={styles.prompt}>{step.prompt}</Text> : null}
      <Text style={styles.hint}>{G.pairingHint}</Text>

      <View style={styles.grid}>
        {/* 表头行:左上角空 + 各药名 */}
        <View style={styles.row}>
          <View style={[styles.head, { width: TILE, height: TILE }]} />
          {state.names.map((nm, j) => (
            <View key={`h${j}`} style={[styles.head, { width: TILE, height: TILE }]}>
              <Text style={styles.headText}>{nm}</Text>
            </View>
          ))}
        </View>
        {state.names.map((nm, i) => (
          <View key={`r${i}`} style={styles.row}>
            <View style={[styles.head, { width: TILE, height: TILE }]}>
              <Text style={styles.headText}>{nm}</Text>
            </View>
            {state.names.map((_, j) => {
              if (i === j) return <View key={j} style={[styles.cell, styles.diag, { width: TILE, height: TILE }]} />;
              const m = state.marks[i][j];
              return (
                <Pressable
                  key={j}
                  testID={`cell-${i}-${j}`}
                  onPress={() => tap(i, j)}
                  style={[
                    styles.cell,
                    { width: TILE, height: TILE },
                    m === 'lethal' && styles.lethal,
                    m === 'safe' && styles.safe,
                  ]}
                >
                  <Text style={[styles.cellText, m === 'lethal' ? styles.lethalText : styles.safeText]}>
                    {cellGlyph(m)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <Text style={styles.count}>{G.pairingUnknown(unknown)}</Text>

      <ScrollView style={styles.clues} contentContainerStyle={styles.cluesInner}>
        {state.clues.map((c, i) => (
          <Text key={i} style={styles.clue}>
            朱批 · {c.text}
          </Text>
        ))}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable testID="pairing-reset" onPress={() => setState((s) => clearMarks(s))} style={styles.minorBtn}>
          <Text style={styles.minorText}>{G.pairingReset}</Text>
        </Pressable>
        <Pressable testID="pairing-giveup" onPress={() => onResolved(false)} style={styles.giveUpBtn}>
          <Text style={styles.giveUpText}>{G.pairingGiveUp}</Text>
        </Pressable>
        <Pressable
          testID="pairing-submit"
          disabled={unknown > 0}
          onPress={() => onResolved(isCorrect(state))}
          style={[styles.submitBtn, unknown > 0 && styles.submitOff]}
        >
          <Text style={styles.submitText}>{G.pairingSubmit}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const INK = '#3D3229';

const styles = StyleSheet.create({
  box: { gap: 8 },
  prompt: { fontSize: 15, fontWeight: '700', color: INK },
  hint: { fontSize: 13, color: '#8A8377' },
  grid: { alignSelf: 'center', borderWidth: 2, borderColor: INK },
  row: { flexDirection: 'row' },
  head: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#E7DCC2', borderWidth: 0.5, borderColor: '#B7A985' },
  headText: { fontSize: 11, fontWeight: '700', color: INK },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF7',
    borderWidth: 0.5,
    borderColor: '#B7A985',
  },
  diag: { backgroundColor: '#CDBE9C' },
  lethal: { backgroundColor: '#9E3B2E' },
  safe: { backgroundColor: '#C99A3B' },
  cellText: { fontSize: 16, fontWeight: '800' },
  lethalText: { color: '#F4EFE4' },
  safeText: { color: '#3D3229' },
  count: { fontSize: 13, color: '#B3402F', fontWeight: '700', textAlign: 'center' },
  clues: { maxHeight: 116, alignSelf: 'stretch', backgroundColor: '#FFFDF7', borderWidth: 2, borderColor: INK, borderRadius: 6 },
  cluesInner: { padding: 8, gap: 4 },
  clue: { fontSize: 13, color: INK, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  minorBtn: { paddingHorizontal: 16, paddingVertical: 9, backgroundColor: '#FFFDF7', borderWidth: 2, borderColor: INK, borderRadius: 6 },
  minorText: { fontSize: 14, fontWeight: '700', color: INK },
  giveUpBtn: { paddingHorizontal: 16, paddingVertical: 9, backgroundColor: '#8A8377', borderRadius: 6 },
  giveUpText: { fontSize: 14, fontWeight: '700', color: '#F4EFE4' },
  submitBtn: { paddingHorizontal: 22, paddingVertical: 9, backgroundColor: INK, borderRadius: 6 },
  submitOff: { opacity: 0.45 },
  submitText: { fontSize: 14, fontWeight: '800', color: '#F4EFE4' },
});
