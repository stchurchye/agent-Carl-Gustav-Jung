import { useEffect, useMemo, useRef, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEFAULT_DOG, type DogPersonality } from '@xzz/shared';
import { WeChatChatHeader } from '../../../components/WeChatChatHeader';
import { useAuth } from '../../../components/AuthGate';
import { PixelCharacter } from '../../../components/pixel/PixelCharacter';
import { buildDogCharacter } from '../../../pixel/buildDog';
import { PERSONALITY_MOTION } from '../../../pixel/palette';
import { api } from '../../../lib/api';
import { playReplyBark } from '../../../lib/soundCues';
import { wechatChatStyles } from '../../../theme/wechatChat';
import { zh } from '../../../locales/zh-CN';
import type { GroupStackParamList } from '../../../navigation/types';
import { randomSeed } from '../shared/rng';
import {
  applyTurn,
  DUEL_START_STUBBORNNESS,
  reactionFor,
  startDuel,
  TACTIC_LABEL,
  type DuelMood,
  type DuelState,
  type Reaction,
} from './duel';

const G = zh.games.persuade;

/** 心情 → 狗的性格表情(驱动 PixelCharacter 的脸与动画) */
const MOOD_PERSONALITY: Record<DuelMood, DogPersonality> = {
  stubborn: 'sassy',
  annoyed: 'sassy',
  wavering: 'calm',
  won_over: 'sweet',
};

const REACTION_COLOR: Record<Reaction['kind'], string> = {
  hit: '#3F7A4E',
  soften: '#B8860B',
  none: '#8A8377',
  annoy: '#B3402F',
  backfire: '#8B2E22',
};

type Props = NativeStackScreenProps<GroupStackParamList, 'GamePersuade'>;

export function GamePersuadeScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  // 对手就是你领养的狗(无则兜底默认狗);它的性格喂给提示词、决定长相
  const dogConfig = user?.pixelAvatar?.dog ?? DEFAULT_DOG;
  const personaLabel = zh.pixelAvatar.personalityNames[dogConfig.personality];

  const [duel, setDuel] = useState<DuelState>(() =>
    startDuel(route.params?.seed ?? randomSeed(), personaLabel),
  );
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [reaction, setReaction] = useState<Reaction | null>(null);
  /** 本局连续说服成功的件数 = 战绩 */
  const [streak, setStreak] = useState(0);

  const character = useMemo(
    () => buildDogCharacter({ ...dogConfig, personality: MOOD_PERSONALITY[duel.mood] }),
    [dogConfig, duel.mood],
  );

  const seedFor = (offset: number) =>
    route.params?.seed != null ? route.params.seed + offset : randomSeed();
  const motion = PERSONALITY_MOTION[MOOD_PERSONALITY[duel.mood]];
  const stubbornPct = Math.max(0, Math.min(1, duel.stubbornness / DUEL_START_STUBBORNNESS));

  // 固执条:平滑动画到当前比例(卸载/变更时停掉,避免动画帧在组件消失后还更新)
  const barAnim = useRef(new Animated.Value(stubbornPct)).current;
  useEffect(() => {
    const anim = Animated.timing(barAnim, { toValue: stubbornPct, duration: 380, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [stubbornPct, barAnim]);

  const send = async () => {
    const line = input.trim();
    if (!line || busy || duel.status !== 'arguing') return;
    setBusy(true);
    setReaction(null);
    try {
      const res = await api.persuade({
        demand: duel.demand,
        personality: duel.personality,
        stubbornness: duel.stubbornness,
        softSpot: TACTIC_LABEL[duel.disposition.softSpot],
        landmine: TACTIC_LABEL[duel.disposition.landmine],
        history: duel.history,
        playerLine: line,
      });
      const verdict = res.data;
      const next = applyTurn(duel, line, verdict);
      setDuel(next);
      setReaction(reactionFor(verdict.scoreDelta));
      playReplyBark(duel.personality);
      if (next.status === 'won') setStreak((s) => s + 1);
      setInput('');
    } catch {
      // 网络/密钥失败:留住输入,玩家可重试
    } finally {
      setBusy(false);
    }
  };

  // 说服成功 → 同一只狗的下一件事(新要求 + 新性情),战绩已 +1
  const nextRound = () => {
    setReaction(null);
    setInput('');
    setDuel(startDuel(seedFor(streak + 1), personaLabel));
  };

  const restart = () => {
    setStreak(0);
    setReaction(null);
    setInput('');
    setBusy(false);
    setDuel(startDuel(seedFor(0), personaLabel));
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
            <Animated.View
              style={[
                styles.stubbornFill,
                { width: barAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
              ]}
            />
          </View>
        </View>

        <View style={styles.dogWrap}>
          <PixelCharacter character={character} size={120} motion={motion} animated speaking={busy} />
        </View>

        {busy ? (
          <Text style={styles.thinking}>{G.thinking}</Text>
        ) : reaction ? (
          <Text style={[styles.reaction, { color: REACTION_COLOR[reaction.kind] }]}>{reaction.label}</Text>
        ) : null}

        {/* 对话流:你来我往的气泡 */}
        <View style={styles.thread}>
          {duel.history.map((turn, i) => (
            <View
              key={i}
              style={[styles.bubble, turn.role === 'player' ? styles.bubblePlayer : styles.bubbleDog]}
            >
              <Text style={styles.bubbleText}>{turn.text}</Text>
            </View>
          ))}
        </View>

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
            {duel.status === 'won' ? (
              <>
                <Text style={styles.overTitle}>{G.won}</Text>
                <Text style={styles.overScore}>{G.wonScore(duel.demand)}</Text>
                <Text style={styles.overStreak}>{G.streak(streak)}</Text>
                <Pressable onPress={nextRound} style={styles.restartBtn}>
                  <Text style={styles.restartText}>{G.nextRound}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.overTitle}>{G.lost}</Text>
                <Text style={styles.overScore}>{G.streakScore(streak)}</Text>
                <Pressable onPress={restart} style={styles.restartBtn}>
                  <Text style={styles.restartText}>{G.restart}</Text>
                </Pressable>
              </>
            )}
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
  reaction: { textAlign: 'center', fontSize: 15, fontWeight: '700', marginTop: 8 },
  thread: { marginTop: 14, gap: 8 },
  bubble: { maxWidth: '82%', borderWidth: 2, borderColor: INK, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleDog: { alignSelf: 'flex-start', backgroundColor: '#FFFDF7' },
  bubblePlayer: { alignSelf: 'flex-end', backgroundColor: '#DCE7D8' },
  bubbleText: { fontSize: 15, color: INK },
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
  sendBtn: { paddingHorizontal: 18, height: 44, justifyContent: 'center', backgroundColor: INK, borderRadius: 6 },
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
  overStreak: { fontSize: 16, fontWeight: '800', color: '#B3402F' },
  restartBtn: { marginTop: 6, paddingHorizontal: 22, paddingVertical: 10, backgroundColor: INK, borderRadius: 4 },
  restartText: { fontSize: 15, fontWeight: '700', color: '#F4EFE4' },
});
