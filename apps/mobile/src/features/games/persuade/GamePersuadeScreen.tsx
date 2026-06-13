import { useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEFAULT_DOG, type DogPersonality } from '@xzz/shared';
import { WeChatChatHeader } from '../../../components/WeChatChatHeader';
import { PixelCharacter } from '../../../components/pixel/PixelCharacter';
import { buildDogCharacter } from '../../../pixel/buildDog';
import { PERSONALITY_MOTION } from '../../../pixel/palette';
import { api } from '../../../lib/api';
import { wechatChatStyles } from '../../../theme/wechatChat';
import { zh } from '../../../locales/zh-CN';
import type { GroupStackParamList } from '../../../navigation/types';
import { randomSeed } from '../shared/rng';
import {
  applyTurn,
  DUEL_START_STUBBORNNESS,
  startDuel,
  type DuelMood,
  type DuelState,
} from './duel';

const G = zh.games.persuade;

/** 心情 → 狗的性格表情(驱动 PixelCharacter 的脸与动画) */
const MOOD_PERSONALITY: Record<DuelMood, DogPersonality> = {
  stubborn: 'sassy',
  annoyed: 'sassy',
  wavering: 'calm',
  won_over: 'sweet',
};

type Props = NativeStackScreenProps<GroupStackParamList, 'GamePersuade'>;

export function GamePersuadeScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const [duel, setDuel] = useState<DuelState>(() =>
    startDuel(route.params?.seed ?? randomSeed(), DEFAULT_DOG.personality),
  );
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const character = useMemo(
    () => buildDogCharacter({ ...DEFAULT_DOG, personality: MOOD_PERSONALITY[duel.mood] }),
    [duel.mood],
  );
  const motion = PERSONALITY_MOTION[MOOD_PERSONALITY[duel.mood]];
  const lastReply = [...duel.history].reverse().find((h) => h.role === 'dog')?.text;
  const stubbornPct = Math.max(0, Math.round((duel.stubbornness / DUEL_START_STUBBORNNESS) * 100));

  const send = async () => {
    const line = input.trim();
    if (!line || busy || duel.status !== 'arguing') return;
    setBusy(true);
    try {
      const res = await api.persuade({
        demand: duel.demand,
        personality: duel.personality,
        stubbornness: duel.stubbornness,
        history: duel.history,
        playerLine: line,
      });
      setDuel((d) => applyTurn(d, line, res.data));
      setInput('');
    } catch {
      // 网络/密钥失败:留住输入,玩家可重试
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setInput('');
    setBusy(false);
    setDuel(startDuel(randomSeed(), DEFAULT_DOG.personality));
  };

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={G.name} showBack />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Text style={styles.demand}>{G.demandTitle(duel.demand)}</Text>
        <Text style={styles.turns}>{G.turnsLeft(duel.turnsLeft)}</Text>

        <View style={styles.stubbornRow}>
          <Text style={styles.stubbornLabel}>{G.stubbornLabel}</Text>
          <View style={styles.stubbornTrack}>
            <View style={[styles.stubbornFill, { width: `${stubbornPct}%` }]} />
          </View>
        </View>

        <View style={styles.dogWrap}>
          <PixelCharacter character={character} size={128} motion={motion} animated speaking={busy} />
        </View>

        {busy ? (
          <Text style={styles.thinking}>{G.thinking}</Text>
        ) : lastReply ? (
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>{lastReply}</Text>
          </View>
        ) : null}

        {duel.status === 'arguing' ? (
          <View style={styles.inputRow}>
            <TextInput
              testID="persuade-input"
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder={G.inputPlaceholder}
              placeholderTextColor="#A89F8E"
              multiline
              editable={!busy}
            />
            <Pressable onPress={send} disabled={busy} style={[styles.sendBtn, busy && styles.sendBtnOff]}>
              <Text style={styles.sendText}>{G.send}</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {duel.status !== 'arguing' ? (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <Text style={styles.overTitle}>{duel.status === 'won' ? G.won : G.lost}</Text>
            {duel.status === 'won' ? <Text style={styles.overScore}>{G.wonScore(duel.demand)}</Text> : null}
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
  content: { paddingTop: 14, paddingHorizontal: 16 },
  demand: { fontSize: 17, fontWeight: '800', color: INK },
  turns: { fontSize: 13, color: '#8A8377', marginTop: 4 },
  stubbornRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  stubbornLabel: { fontSize: 13, color: '#8A8377' },
  stubbornTrack: { flex: 1, height: 12, backgroundColor: '#E7E0D2', borderRadius: 6, overflow: 'hidden' },
  stubbornFill: { height: '100%', backgroundColor: '#B3402F' },
  dogWrap: { alignItems: 'center', marginTop: 16 },
  thinking: { textAlign: 'center', fontSize: 14, color: '#8A8377', marginTop: 8 },
  bubble: {
    marginTop: 10,
    alignSelf: 'center',
    maxWidth: '90%',
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleText: { fontSize: 16, color: INK },
  inputRow: { flexDirection: 'row', gap: 8, marginTop: 18, alignItems: 'flex-end' },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: '#FFFDF7',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: INK,
  },
  sendBtn: {
    paddingHorizontal: 18,
    height: 44,
    justifyContent: 'center',
    backgroundColor: INK,
    borderRadius: 6,
  },
  sendBtnOff: { opacity: 0.5 },
  sendText: { fontSize: 15, fontWeight: '700', color: '#F4EFE4' },
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
  overScore: { fontSize: 15, color: INK },
  restartBtn: { marginTop: 6, paddingHorizontal: 22, paddingVertical: 10, backgroundColor: INK, borderRadius: 4 },
  restartText: { fontSize: 15, fontWeight: '700', color: '#F4EFE4' },
});
