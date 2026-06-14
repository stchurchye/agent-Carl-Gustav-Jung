import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PixelSprite } from '../../../components/pixel/PixelSprite';
import { buildDogCharacter } from '../../../pixel/buildDog';
import { zh } from '../../../locales/zh-CN';
import { mulberry32, randomSeed } from '../shared/rng';
import { generateCase, SNIFFABLE_ATTRS, survivingSuspects, type Clue, type SniffAttr } from '../sleuth/engine';
import { attrLabel, valueLabel } from '../sleuth/labels';
import type { Deduce } from './story';

const G = zh.games.drama;

/** 剧情查案戏点:复用嗅探引擎——嗅特征缩小嫌疑、指认真凶,猜错即 fail。比合集版更难(嫌疑多、嗅探紧)。 */
export function DeducePanel({ step, onResolved }: { step: Deduce; onResolved: (solved: boolean) => void }) {
  const count = step.count ?? 6;
  const budget = step.budget ?? 2;
  const theCase = useMemo(
    () => generateCase(mulberry32(step.seed ?? randomSeed()), { count, budget }),
    [step.seed, count, budget],
  );
  const [clues, setClues] = useState<Clue[]>([]);

  const sniffed = useMemo(() => new Set(clues.map((c) => c.attr)), [clues]);
  const survivors = useMemo(() => new Set(survivingSuspects(theCase.suspects, clues)), [theCase, clues]);
  const sniffsLeft = budget - clues.length;
  const remaining = SNIFFABLE_ATTRS.filter((a) => !sniffed.has(a));

  const sniff = (attr: SniffAttr) => {
    if (sniffsLeft <= 0 || sniffed.has(attr)) return;
    setClues((cs) => [...cs, { attr, value: theCase.suspects[theCase.culpritIndex][attr] }]);
  };
  const accuse = (i: number) => onResolved(i === theCase.culpritIndex);

  return (
    <View style={styles.box}>
      {step.prompt ? <Text style={styles.prompt}>{step.prompt}</Text> : null}
      <Text style={styles.status}>{G.deduceStatus(sniffsLeft)}</Text>
      <Text style={styles.hint}>{G.deduceAccuseHint}</Text>

      <View style={styles.lineup}>
        {theCase.suspects.map((dog, i) => {
          const alive = survivors.has(i);
          return (
            <Pressable
              key={i}
              testID={`suspect-${i}`}
              onPress={alive ? () => accuse(i) : undefined}
              disabled={!alive}
              style={[styles.suspect, !alive && styles.out]}
            >
              <PixelSprite sprite={buildDogCharacter(dog).still} size={52} />
            </Pressable>
          );
        })}
      </View>

      {clues.length ? (
        <View style={styles.clues}>
          {clues.map((c) => (
            <Text key={c.attr} style={styles.clue}>
              {`${attrLabel(c.attr)} = ${valueLabel(c.attr, c.value)}`}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={styles.muted}>{G.deduceNoClues}</Text>
      )}

      {sniffsLeft > 0 ? (
        <View style={styles.sniffRow}>
          {remaining.map((a) => (
            <Pressable key={a} testID={`sniff-${a}`} onPress={() => sniff(a)} style={styles.sniffBtn}>
              <Text style={styles.sniffText}>{attrLabel(a)}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.muted}>{G.deduceOutOfSniffs}</Text>
      )}
    </View>
  );
}

const INK = '#3D3229';

const styles = StyleSheet.create({
  box: { gap: 8 },
  prompt: { fontSize: 15, fontWeight: '700', color: INK },
  status: { fontSize: 14, fontWeight: '700', color: '#B3402F' },
  hint: { fontSize: 13, color: '#8A8377' },
  lineup: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', rowGap: 8 },
  suspect: {
    width: '15%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 4,
  },
  out: { opacity: 0.28 },
  clues: { gap: 2 },
  clue: { fontSize: 14, color: INK },
  muted: { fontSize: 13, color: '#8A8377' },
  sniffRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sniffBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 4,
  },
  sniffText: { fontSize: 13, fontWeight: '600', color: INK },
});
