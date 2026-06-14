import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PixelSprite } from '../../../components/pixel/PixelSprite';
import { buildDogCharacter } from '../../../pixel/buildDog';
import { compileSprite } from '../../../pixel/compile';
import { zh } from '../../../locales/zh-CN';
import { castMember } from './cast';
import { parseLevel, move, isSolved, tileAt, boxAt, KUFANG_LEVEL, type Dir } from './sokoban';
import type { Sokoban } from './story';

const G = zh.games.drama;
const TILE = 34;

/** 朱漆木箱瓦片:红漆箱身 + 中央金锁带 + 金角(与宫廷像素调色一致) */
const BOX = compileSprite(
  [
    'KKKKKKKKKK',
    'KGRRRRRRGK',
    'KRRRRRRRRK',
    'KRRRRRRRRK',
    'KGGGGGGGGK',
    'KHHHHHHHHK',
    'KRRRRRRRRK',
    'KRRRRRRRRK',
    'KGRRRRRRGK',
    'KKKKKKKKKK',
  ],
  { K: '#3D3229', R: '#9E3B2E', G: '#C99A3B', H: '#E5C06A' },
);
const DOG = buildDogCharacter(castMember('xuetuan')!.dog).still;

/** 推箱子脱困面板:推宫箱上机关 → 解开(onResolved true);放弃突围 → onResolved false。 */
export function SokobanPanel({ step, onResolved }: { step: Sokoban; onResolved: (solved: boolean) => void }) {
  const level = step.level ?? KUFANG_LEVEL;
  const [state, setState] = useState(() => parseLevel(level));
  const [moves, setMoves] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (!done.current && isSolved(state)) {
      done.current = true;
      onResolved(true);
    }
  }, [state, onResolved]);

  const doMove = (dir: Dir) => {
    if (done.current) return;
    const ns = move(state, dir);
    if (ns === state) return;
    setState(ns);
    setMoves((m) => m + 1);
  };
  const reset = () => {
    done.current = false;
    setState(parseLevel(level));
    setMoves(0);
  };

  return (
    <View style={styles.box}>
      {step.prompt ? <Text style={styles.prompt}>{step.prompt}</Text> : null}
      <Text style={styles.hint}>{G.sokoHint}</Text>

      <View style={styles.board}>
        {Array.from({ length: state.rows }).map((_, r) => (
          <View key={r} style={styles.row}>
            {Array.from({ length: state.cols }).map((_, c) => {
              const t = tileAt(state, r, c);
              const hasBox = boxAt(state, r, c);
              const isPlayer = state.player.r === r && state.player.c === c;
              const onTarget = t === 'target';
              return (
                <View
                  key={c}
                  style={[
                    styles.tile,
                    t === 'wall' ? styles.wall : styles.floor,
                    hasBox && onTarget && styles.tileSolved,
                  ]}
                >
                  {onTarget ? <View style={styles.targetRing} /> : null}
                  {hasBox ? <PixelSprite sprite={BOX} size={TILE} style={StyleSheet.absoluteFill} /> : null}
                  {isPlayer ? <PixelSprite sprite={DOG} size={TILE} style={StyleSheet.absoluteFill} /> : null}
                </View>
              );
            })}
          </View>
        ))}
      </View>

      <Text style={styles.moves}>{G.sokoMoves(moves)}</Text>

      {/* 方向键 */}
      <View style={styles.pad}>
        <Pressable testID="dpad-up" onPress={() => doMove('up')} style={styles.padBtn}>
          <Text style={styles.padText}>↑</Text>
        </Pressable>
        <View style={styles.padMid}>
          <Pressable testID="dpad-left" onPress={() => doMove('left')} style={styles.padBtn}>
            <Text style={styles.padText}>←</Text>
          </Pressable>
          <Pressable testID="dpad-down" onPress={() => doMove('down')} style={styles.padBtn}>
            <Text style={styles.padText}>↓</Text>
          </Pressable>
          <Pressable testID="dpad-right" onPress={() => doMove('right')} style={styles.padBtn}>
            <Text style={styles.padText}>→</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable testID="soko-reset" onPress={reset} style={styles.minorBtn}>
          <Text style={styles.minorText}>{G.sokoReset}</Text>
        </Pressable>
        <Pressable testID="soko-giveup" onPress={() => onResolved(false)} style={styles.giveUpBtn}>
          <Text style={styles.giveUpText}>{G.sokoGiveUp}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const INK = '#3D3229';

const styles = StyleSheet.create({
  box: { gap: 8, alignItems: 'center' },
  prompt: { fontSize: 15, fontWeight: '700', color: INK, alignSelf: 'stretch' },
  hint: { fontSize: 13, color: '#8A8377', alignSelf: 'stretch' },
  board: { borderWidth: 2, borderColor: INK, alignSelf: 'center' },
  row: { flexDirection: 'row' },
  tile: { width: TILE, height: TILE, alignItems: 'center', justifyContent: 'center' },
  floor: { backgroundColor: '#CDB07A' },
  wall: { backgroundColor: '#5A4632', borderTopWidth: 2, borderTopColor: '#6E5942' },
  tileSolved: { backgroundColor: '#E0C97E' },
  targetRing: {
    width: TILE * 0.5,
    height: TILE * 0.5,
    borderRadius: 3,
    borderWidth: 3,
    borderColor: '#C99A3B',
  },
  moves: { fontSize: 13, color: '#8A8377' },
  pad: { alignItems: 'center', gap: 6 },
  padMid: { flexDirection: 'row', gap: 6 },
  padBtn: {
    width: 52,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 6,
  },
  padText: { fontSize: 22, fontWeight: '800', color: INK },
  actions: { flexDirection: 'row', gap: 12, marginTop: 2 },
  minorBtn: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 6,
  },
  minorText: { fontSize: 14, fontWeight: '700', color: INK },
  giveUpBtn: { paddingHorizontal: 18, paddingVertical: 9, backgroundColor: '#8A8377', borderRadius: 6 },
  giveUpText: { fontSize: 14, fontWeight: '700', color: '#F4EFE4' },
});
