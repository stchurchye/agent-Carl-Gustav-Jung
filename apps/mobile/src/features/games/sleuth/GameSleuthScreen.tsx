import { useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WeChatChatHeader } from '../../../components/WeChatChatHeader';
import { PixelSprite } from '../../../components/pixel/PixelSprite';
import { buildDogCharacter } from '../../../pixel/buildDog';
import { wechatChatStyles } from '../../../theme/wechatChat';
import { zh } from '../../../locales/zh-CN';
import type { GroupStackParamList } from '../../../navigation/types';
import { randomSeed } from '../shared/rng';
import { SNIFFABLE_ATTRS, survivingSuspects, type SniffAttr } from './engine';
import { accuse, sniff, startRun, type RunState } from './run';
import { attrLabel, valueLabel } from './labels';

const G = zh.games.sleuth;

type Props = NativeStackScreenProps<GroupStackParamList, 'GameSleuth'>;

/** 群嗅探案:嗅特征缩小嫌疑、指认真凶的推理 roguelike */
export function GameSleuthScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const [run, setRun] = useState<RunState>(() => startRun(route.params?.seed ?? randomSeed()));

  const survivors = useMemo(
    () => new Set(survivingSuspects(run.case.suspects, run.clues)),
    [run.case, run.clues],
  );
  const sniffed = useMemo(() => new Set(run.clues.map((c) => c.attr)), [run.clues]);
  const remainingAttrs = SNIFFABLE_ATTRS.filter((a) => !sniffed.has(a));

  const onSniff = (attr: SniffAttr) => setRun((s) => sniff(s, attr));
  const onAccuse = (i: number) => setRun((s) => accuse(s, i));
  const restart = () => setRun(startRun(randomSeed()));

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={G.name} showBack />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <Text style={styles.status}>{G.status(run.caseNum, run.solved, run.sniffsLeft)}</Text>
        <Text style={styles.hint}>{G.accuseHint}</Text>

        <View style={styles.lineup}>
          {run.case.suspects.map((dog, i) => {
            const alive = survivors.has(i);
            return (
              <Pressable
                key={i}
                testID={`suspect-${i}`}
                onPress={alive ? () => onAccuse(i) : undefined}
                disabled={!alive || run.status !== 'sniffing'}
                style={[styles.suspect, !alive && styles.suspectOut]}
              >
                <PixelSprite sprite={buildDogCharacter(dog).still} size={64} />
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>{G.cluesTitle}</Text>
        {run.clues.length === 0 ? (
          <Text style={styles.muted}>{G.noClues}</Text>
        ) : (
          <View style={styles.cluesBox}>
            {run.clues.map((c) => (
              <Text key={c.attr} style={styles.clue}>
                {G.clue(attrLabel(c.attr), valueLabel(c.attr, c.value))}
              </Text>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>{G.sniffTitle}</Text>
        {run.sniffsLeft > 0 ? (
          <View style={styles.sniffRow}>
            {remainingAttrs.map((a) => (
              <Pressable key={a} testID={`sniff-${a}`} onPress={() => onSniff(a)} style={styles.sniffBtn}>
                <Text style={styles.sniffText}>{attrLabel(a)}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.muted}>{G.outOfSniffs}</Text>
        )}
      </ScrollView>

      {run.status === 'lost' ? (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <Text style={styles.overTitle}>{G.gameOver}</Text>
            <PixelSprite
              sprite={buildDogCharacter(run.case.suspects[run.case.culpritIndex]).still}
              size={96}
              style={styles.reveal}
            />
            <Text style={styles.overScore}>{G.finalScore(run.solved)}</Text>
            <Pressable onPress={restart} style={styles.restartBtn}>
              <Text style={styles.restartText}>{G.restart}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const INK = '#3D3229';

const styles = StyleSheet.create({
  content: { paddingTop: 12, paddingHorizontal: 16 },
  status: { fontSize: 15, fontWeight: '700', color: INK, marginBottom: 4 },
  hint: { fontSize: 13, color: '#8A8377', marginBottom: 12 },
  lineup: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', rowGap: 10 },
  suspect: {
    width: '23%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 4,
  },
  suspectOut: { opacity: 0.28 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: INK, marginTop: 18, marginBottom: 8 },
  muted: { fontSize: 13, color: '#8A8377' },
  cluesBox: { gap: 4 },
  clue: { fontSize: 15, color: INK },
  sniffRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sniffBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 4,
  },
  sniffText: { fontSize: 14, fontWeight: '600', color: INK },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayCard: {
    backgroundColor: '#F4EFE4',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 6,
    paddingHorizontal: 28,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 10,
  },
  overTitle: { fontSize: 18, fontWeight: '800', color: INK },
  reveal: { marginVertical: 4 },
  overScore: { fontSize: 15, color: INK },
  restartBtn: {
    marginTop: 6,
    paddingHorizontal: 22,
    paddingVertical: 10,
    backgroundColor: INK,
    borderRadius: 4,
  },
  restartText: { fontSize: 15, fontWeight: '700', color: '#F4EFE4' },
});
