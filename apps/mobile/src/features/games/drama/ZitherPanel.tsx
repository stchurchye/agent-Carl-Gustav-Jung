import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { zh } from '../../../locales/zh-CN';
import { buildZither, resolveBeat, isFlourish, COMPOSURE_MAX, WATCH_CHART, type ZitherState, type Quality } from './zither';
import type { Zither } from './story';

const G = zh.games.drama;
const BEAT_MS = 720; // 更鼓一拍

/** 听更夜奏面板:更鼓定速跑拍,亮拍拨弦、留白屏息。通仪→onResolved(true);失态/搁琴→false。 */
export function ZitherPanel({ step, onResolved }: { step: Zither; onResolved: (solved: boolean) => void }) {
  const [state, setState] = useState<ZitherState>(() => buildZither(WATCH_CHART));
  const [phase, setPhase] = useState<'ready' | 'play'>('ready');
  const [flash, setFlash] = useState(false);
  const tapOffset = useRef<number | null>(null); // 本拍拨弦距下拍起点的毫秒;null=没拨
  const beatStart = useRef(0);
  const done = useRef(false);

  // 更鼓节拍:每拍结算当前拍(拨没拨 + 拨得准不准)
  useEffect(() => {
    if (phase !== 'play') return;
    beatStart.current = Date.now();
    const id = setInterval(() => {
      const off = tapOffset.current;
      const played = off !== null;
      // 越贴下拍起点越准:前 1/4 拍=绝、前半拍=稳、拖到后半拍=飘
      const q: Quality = !played ? '稳' : off < BEAT_MS * 0.25 ? '绝' : off < BEAT_MS * 0.5 ? '稳' : '飘';
      tapOffset.current = null;
      beatStart.current = Date.now();
      setState((s) => {
        const ns = resolveBeat(s, played, q);
        if (isFlourish(ns)) {
          setFlash(true);
          setTimeout(() => setFlash(false), 260);
        }
        return ns;
      });
    }, BEAT_MS);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (done.current) return;
    if (state.status === 'won') {
      done.current = true;
      onResolved(true);
    }
  }, [state.status, onResolved]);

  const restart = () => {
    setState(buildZither(WATCH_CHART));
    setPhase('ready');
    tapOffset.current = null;
  };

  const lost = state.status === 'lost';
  const composurePct = Math.round((state.composure / COMPOSURE_MAX) * 100);
  const curRest = phase === 'play' && state.chart[state.idx] === 'rest';

  return (
    <View style={styles.box}>
      {step.prompt ? <Text style={styles.prompt}>{step.prompt}</Text> : null}
      <Text style={styles.hint}>{G.zitherHint}</Text>

      {/* 谱面轨:亮拍/留白/光标 */}
      <View style={styles.track}>
        {state.chart.map((b, i) => (
          <View
            key={i}
            style={[
              styles.beat,
              b === 'rest' ? styles.rest : styles.noteBeat,
              i === state.idx && phase === 'play' && styles.cursor,
              i < state.idx && styles.passed,
            ]}
          >
            <Text style={styles.beatText}>{b === 'rest' ? '·' : '丨'}</Text>
          </View>
        ))}
      </View>

      {/* 仪态条 + 连击 */}
      <View style={styles.statusRow}>
        <Text style={styles.statLabel}>{G.zitherComposure}</Text>
        <View style={styles.barBg}>
          <View style={[styles.barFill, { width: `${composurePct}%` }, composurePct < 60 && styles.barLow]} />
        </View>
        <Text style={styles.combo}>{G.zitherCombo(state.combo)}</Text>
      </View>
      {flash ? <Text style={styles.flourish}>{G.zitherFlourish}</Text> : null}

      {lost ? (
        <View style={styles.actions}>
          <Text style={styles.failText}>{G.zitherFail}</Text>
          <Pressable testID="zither-reset" onPress={restart} style={styles.minorBtn}>
            <Text style={styles.minorText}>{G.zitherReset}</Text>
          </Pressable>
          <Pressable testID="zither-giveup" onPress={() => onResolved(false)} style={styles.giveUpBtn}>
            <Text style={styles.giveUpText}>{G.zitherGiveUp}</Text>
          </Pressable>
        </View>
      ) : phase === 'ready' ? (
        <Pressable testID="zither-start" onPress={() => setPhase('play')} style={styles.startBtn}>
          <Text style={styles.startText}>{G.zitherStart}</Text>
        </Pressable>
      ) : (
        <View style={styles.playRow}>
          <Pressable
            testID="zither-pluck"
            onPress={() => {
              if (tapOffset.current === null) tapOffset.current = Date.now() - beatStart.current;
            }}
            style={[styles.pluck, curRest && styles.pluckWarn]}
          >
            <Text style={styles.pluckText}>{curRest ? G.zitherRest : G.zitherPluck}</Text>
          </Pressable>
          <Pressable testID="zither-giveup" onPress={() => onResolved(false)} style={styles.giveUpBtnSmall}>
            <Text style={styles.giveUpText}>{G.zitherGiveUp}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const INK = '#3D3229';

const styles = StyleSheet.create({
  box: { gap: 10, alignItems: 'center' },
  prompt: { fontSize: 15, fontWeight: '700', color: INK, alignSelf: 'stretch' },
  hint: { fontSize: 12, color: '#8A8377', alignSelf: 'stretch' },
  track: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'center' },
  beat: { width: 30, height: 38, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#B7A985' },
  noteBeat: { backgroundColor: '#C99A3B' },
  rest: { backgroundColor: '#E7DCC2' },
  cursor: { borderWidth: 3, borderColor: '#B3402F' },
  passed: { opacity: 0.4 },
  beatText: { fontSize: 18, fontWeight: '800', color: INK },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch' },
  statLabel: { fontSize: 13, fontWeight: '700', color: INK },
  barBg: { flex: 1, height: 14, backgroundColor: '#E7DCC2', borderRadius: 7, overflow: 'hidden', borderWidth: 1, borderColor: '#B7A985' },
  barFill: { height: '100%', backgroundColor: '#3F7A4E' },
  barLow: { backgroundColor: '#B3402F' },
  combo: { fontSize: 13, fontWeight: '700', color: '#8A6E2E' },
  flourish: { fontSize: 14, fontWeight: '800', color: '#C99A3B' },
  playRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pluck: { paddingHorizontal: 44, paddingVertical: 16, backgroundColor: INK, borderRadius: 10 },
  pluckWarn: { backgroundColor: '#9E3B2E' },
  pluckText: { fontSize: 18, fontWeight: '800', color: '#F4EFE4' },
  startBtn: { paddingHorizontal: 30, paddingVertical: 12, backgroundColor: INK, borderRadius: 8 },
  startText: { fontSize: 16, fontWeight: '700', color: '#F4EFE4' },
  actions: { alignItems: 'center', gap: 8, flexDirection: 'row' },
  failText: { fontSize: 15, fontWeight: '800', color: '#B3402F' },
  minorBtn: { paddingHorizontal: 16, paddingVertical: 9, backgroundColor: '#FFFDF7', borderWidth: 2, borderColor: INK, borderRadius: 6 },
  minorText: { fontSize: 14, fontWeight: '700', color: INK },
  giveUpBtn: { paddingHorizontal: 16, paddingVertical: 9, backgroundColor: '#8A8377', borderRadius: 6 },
  giveUpBtnSmall: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#8A8377', borderRadius: 6 },
  giveUpText: { fontSize: 14, fontWeight: '700', color: '#F4EFE4' },
});
