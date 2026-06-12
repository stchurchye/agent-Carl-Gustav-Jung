import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { presetDogForSeed } from '@xzz/shared';
import { PixelCharacter } from '../../components/pixel/PixelCharacter';
import { buildDogCharacter } from '../../pixel/buildDog';
import { PERSONALITY_MOTION } from '../../pixel/palette';
import { useAuth } from '../../components/AuthGate';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainSnapshot } from '../../brain/useBrainSnapshot';
import { navigateStudioTab } from '../../lib/navigateBrain';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';
import { brainTokens } from '../../theme/brainTokens';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainHub'>;

const SECTION_ROUTES = {
  persona: 'BrainPersonalityEdit',
  memoryHub: 'BrainMemoryHub',
  // 汪星联络方式 / 跑腿默认模型已收进「汪星通讯记录」二级页(见 BrainLlmLogsScreen)
  llmLogs: 'BrainLlmLogs',
} as const satisfies Record<string, keyof BrainStackParamList>;

type SectionKey = keyof typeof SECTION_ROUTES;

export function BrainHubScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const heroDog = user?.pixelAvatar?.dog ?? presetDogForSeed(user?.id ?? 'bowwow').dog;
  const { snapshot, loading, error, refresh } = useBrainSnapshot();

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.hero}>
        <View style={styles.heroRow}>
          <View style={styles.heroTextCol}>
            <Text style={styles.heroTitle}>{zh.brain.hubTitle}</Text>
            <Text style={styles.heroSub}>{zh.brain.hubSubtitle}</Text>
          </View>
          {/* hero = 你自己的狗(会呼吸眨眼);没领养则按 seed 兜底预设 */}
          <View accessibilityLabel={zh.brain.hubTitle}>
            <PixelCharacter
              character={buildDogCharacter(heroDog)}
              size={56}
              motion={PERSONALITY_MOTION[heroDog.personality]}
              animated
            />
          </View>
        </View>
        <View style={styles.statusRow}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>
            {loading ? zh.brain.statusSyncing : error ? zh.brain.statusOffline : zh.brain.statusOnline}
          </Text>
        </View>
      </View>

      <Text style={styles.intro}>{zh.brain.hubIntro}</Text>

      <ScrollView contentContainerStyle={styles.grid}>
        {(Object.keys(SECTION_ROUTES) as (keyof typeof SECTION_ROUTES)[]).map((key) => {
          const routeName = SECTION_ROUTES[key];
          let sub = '';
          if (snapshot) {
            if (key === 'persona') {
              sub = snapshot.personaCustomized ? zh.brain.customized : zh.brain.default;
            } else if (key === 'memoryHub') {
              sub = zh.brain.memoryHubSummary(
                snapshot.longMemoryCount,
                snapshot.shortMemoryCount,
                snapshot.reviewCount,
              );
            } else if (key === 'llmLogs') {
              sub = zh.brain.countCalls(snapshot.llmLogCount);
            }
          }
          return (
            <Pressable
              key={key}
              style={styles.cell}
              onPress={() => navigation.navigate(routeName)}
              accessibilityRole="button"
            >
              <View style={styles.cellInner}>
                <Text style={styles.cellTitle}>{zh.brain.sections[key]}</Text>
                {sub ? <Text style={styles.cellSub}>{sub}</Text> : null}
              </View>
            </Pressable>
          );
        })}
        <Pressable
          style={styles.cell}
          onPress={() => navigation.navigate('BrainAgentTasks')}
          accessibilityRole="button"
        >
          <View style={styles.cellInner}>
            <Text style={styles.cellTitle}>{zh.brain.sections.agentTasks}</Text>
            <Text style={styles.cellSub}>{zh.brain.agentTasksHint}</Text>
          </View>
        </Pressable>
        {/* 设置入口从主页左上角移来此处:跨到工作室栈打开 MeScreen(设置) */}
        <Pressable
          style={styles.cell}
          onPress={() => navigateStudioTab(navigation, 'Settings')}
          accessibilityRole="button"
        >
          <View style={styles.cellInner}>
            <Text style={styles.cellTitle}>{zh.brain.sections.manageBowWow}</Text>
            <Text style={styles.cellSub}>{zh.brain.manageBowWowHint}</Text>
          </View>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: brainTokens.bg },
  hero: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: brainTokens.borderSubtle,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  heroTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  heroTitle: {
    color: brainTokens.accentBright,
    fontSize: 22,
    fontWeight: '800',
  },
  heroSub: {
    color: brainTokens.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: brainTokens.accent,
    marginRight: 6,
  },
  statusText: { color: brainTokens.accent, fontSize: 12 },
  intro: {
    color: brainTokens.textMuted,
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    paddingBottom: 24,
  },
  cell: {
    width: '50%',
    padding: 8,
  },
  cellInner: {
    backgroundColor: brainTokens.bgCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.border,
    borderRadius: 4,
    padding: 14,
    minHeight: 72,
  },
  cellTitle: {
    color: brainTokens.text,
    fontSize: 15,
    fontWeight: '600',
  },
  cellSub: {
    color: brainTokens.accent,
    fontSize: 11,
    marginTop: 6,
  },
});