import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DEFAULT_DOG } from '@xzz/shared';
import { PixelSprite } from '../../../components/pixel/PixelSprite';
import { buildDogCharacter } from '../../../pixel/buildDog';
import { zh } from '../../../locales/zh-CN';
import { castMember } from './cast';
import { makeCourtyard, step, guardViews, type ProwlState, type Dir } from './prowl';
import type { Prowl } from './story';

const G = zh.games.drama;
const TILE = 36;

const HERO = buildDogCharacter(castMember('xuetuan')!.dog).still;
const GUARD = buildDogCharacter({ ...DEFAULT_DOG, coat: 'ebony', ears: 'pointy', tail: 'straight', personality: 'sassy' }).still;
const ARROW: Record<Dir, string> = { up: '▲', down: '▼', left: '◀', right: '▶' };

/** 月下夜探面板:摸到金门 → onResolved(true);被发现选「随机应变」/收手 → onResolved(false)。 */
export function ProwlPanel({ step: _step, onResolved }: { step: Prowl; onResolved: (solved: boolean) => void }) {
  const [state, setState] = useState<ProwlState>(() => makeCourtyard());
  const [moves, setMoves] = useState(0);
  const done = useRef(false);
  const L = state.level;

  useEffect(() => {
    if (!done.current && state.status === 'won') {
      done.current = true;
      onResolved(true);
    }
  }, [state, onResolved]);

  const act = (a: Dir | 'wait') => {
    if (state.status !== 'playing') return;
    const ns = step(state, a);
    if (ns === state) return;
    setState(ns);
    setMoves((m) => m + 1);
  };
  const reset = () => {
    setState(makeCourtyard());
    setMoves(0);
  };

  // 灯笼光锥覆盖 + 守卫位
  const views = guardViews(state);
  const lit = new Set<string>();
  for (const g of views) for (const c of g.cone) lit.add(`${c.r},${c.c}`);
  const guardAt = (r: number, c: number) => views.find((g) => g.pos.r === r && g.pos.c === c);
  const caught = state.status === 'caught';

  return (
    <View style={styles.box}>
      {_step.prompt ? <Text style={styles.prompt}>{_step.prompt}</Text> : null}
      <Text style={styles.hint}>{G.prowlHint}</Text>

      <View style={styles.board}>
        {Array.from({ length: L.rows }).map((_, r) => (
          <View key={r} style={styles.row}>
            {Array.from({ length: L.cols }).map((_, c) => {
              const wall = L.walls.has(`${r},${c}`);
              const isGoal = L.goal.r === r && L.goal.c === c;
              const isLit = lit.has(`${r},${c}`);
              const isPlayer = state.player.r === r && state.player.c === c;
              const g = guardAt(r, c);
              return (
                <View
                  key={c}
                  style={[styles.tile, wall ? styles.wall : styles.floor, isGoal && styles.goal]}
                >
                  {isLit && !wall ? <View style={styles.lit} /> : null}
                  {isGoal ? <Text style={styles.goalMark}>信</Text> : null}
                  {g ? (
                    <>
                      <PixelSprite sprite={GUARD} size={TILE} style={StyleSheet.absoluteFill} />
                      <Text style={styles.facing}>{ARROW[g.dir]}</Text>
                    </>
                  ) : null}
                  {isPlayer ? <PixelSprite sprite={HERO} size={TILE} style={StyleSheet.absoluteFill} /> : null}
                </View>
              );
            })}
          </View>
        ))}
      </View>

      <Text style={styles.moves}>{G.prowlMoves(moves)}</Text>

      {caught ? (
        <View style={styles.caughtRow}>
          <Text style={styles.caughtText}>{G.prowlCaught}</Text>
          <Pressable testID="prowl-reset" onPress={reset} style={styles.minorBtn}>
            <Text style={styles.minorText}>{G.prowlReset}</Text>
          </Pressable>
          <Pressable testID="prowl-improvise" onPress={() => onResolved(false)} style={styles.giveUpBtn}>
            <Text style={styles.giveUpText}>{G.prowlImprovise}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.pad}>
            <Pressable testID="prowl-up" onPress={() => act('up')} style={styles.padBtn}>
              <Text style={styles.padText}>↑</Text>
            </Pressable>
            <View style={styles.padMid}>
              <Pressable testID="prowl-left" onPress={() => act('left')} style={styles.padBtn}>
                <Text style={styles.padText}>←</Text>
              </Pressable>
              <Pressable testID="prowl-wait" onPress={() => act('wait')} style={[styles.padBtn, styles.waitBtn]}>
                <Text style={styles.waitText}>{G.prowlWait}</Text>
              </Pressable>
              <Pressable testID="prowl-right" onPress={() => act('right')} style={styles.padBtn}>
                <Text style={styles.padText}>→</Text>
              </Pressable>
            </View>
            <Pressable testID="prowl-down" onPress={() => act('down')} style={styles.padBtn}>
              <Text style={styles.padText}>↓</Text>
            </Pressable>
          </View>
          <Pressable testID="prowl-giveup" onPress={() => onResolved(false)} style={styles.giveUpBtnWide}>
            <Text style={styles.giveUpText}>{G.prowlGiveUp}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const INK = '#3D3229';

const styles = StyleSheet.create({
  box: { gap: 8, alignItems: 'center' },
  prompt: { fontSize: 15, fontWeight: '700', color: INK, alignSelf: 'stretch' },
  hint: { fontSize: 12, color: '#8A8377', alignSelf: 'stretch' },
  board: { borderWidth: 2, borderColor: INK, alignSelf: 'center' },
  row: { flexDirection: 'row' },
  tile: { width: TILE, height: TILE, alignItems: 'center', justifyContent: 'center' },
  floor: { backgroundColor: '#5C5340' },
  wall: { backgroundColor: '#2B241C' },
  goal: { backgroundColor: '#8A6E2E' },
  goalMark: { fontSize: 16, fontWeight: '800', color: '#F1D67E' },
  lit: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(231,192,110,0.5)' },
  facing: { position: 'absolute', top: 0, right: 2, fontSize: 10, color: '#C0392B', fontWeight: '900' },
  moves: { fontSize: 13, color: '#8A8377' },
  pad: { alignItems: 'center', gap: 6 },
  padMid: { flexDirection: 'row', gap: 6 },
  padBtn: {
    width: 56,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 6,
  },
  padText: { fontSize: 22, fontWeight: '800', color: INK },
  waitBtn: { backgroundColor: '#E7E0D2' },
  waitText: { fontSize: 14, fontWeight: '700', color: INK },
  caughtRow: { alignItems: 'center', gap: 8 },
  caughtText: { fontSize: 15, fontWeight: '800', color: '#B3402F' },
  minorBtn: { paddingHorizontal: 18, paddingVertical: 9, backgroundColor: '#FFFDF7', borderWidth: 2, borderColor: INK, borderRadius: 6 },
  minorText: { fontSize: 14, fontWeight: '700', color: INK },
  giveUpBtn: { paddingHorizontal: 18, paddingVertical: 9, backgroundColor: '#8A8377', borderRadius: 6 },
  giveUpBtnWide: { paddingHorizontal: 26, paddingVertical: 8, backgroundColor: '#8A8377', borderRadius: 6 },
  giveUpText: { fontSize: 14, fontWeight: '700', color: '#F4EFE4' },
});
