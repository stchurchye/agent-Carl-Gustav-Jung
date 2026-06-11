import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { brainIcons } from '../../assets/brainIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainSnapshot } from '../../brain/useBrainSnapshot';
import { API_KEY_KINDS, loadApiKeyStatus } from '../../lib/apiKeyKind';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';
import { brainTokens } from '../../theme/brainTokens';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainHub'>;

const SECTION_ROUTES = {
  persona: 'BrainPersonalityEdit',
  memoryHub: 'BrainMemoryHub',
  llmLogs: 'BrainLlmLogs',
  homeKeys: 'BrainHomeKeys',
} as const satisfies Record<string, keyof BrainStackParamList>;

type SectionKey = keyof typeof SECTION_ROUTES;

export function BrainHubScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { snapshot, loading, error, refresh } = useBrainSnapshot();
  const [keysConfiguredCount, setKeysConfiguredCount] = useState(0);

  const loadKeySummary = useCallback(async () => {
    const results = await Promise.all(API_KEY_KINDS.map((kind) => loadApiKeyStatus(kind)));
    setKeysConfiguredCount(results.filter((r) => r.configured).length);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void loadKeySummary();
    }, [refresh, loadKeySummary]),
  );

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.hero}>
        <View style={styles.heroRow}>
          <View style={styles.heroTextCol}>
            <Text style={styles.heroTitle}>{zh.brain.hubTitle}</Text>
            <Text style={styles.heroSub}>{zh.brain.hubSubtitle}</Text>
          </View>
          <Image
            source={brainIcons.catBrain}
            style={styles.heroIcon}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
            accessibilityLabel={zh.brain.hubTitle}
          />
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
          if (key === 'homeKeys') {
            sub = zh.brain.homeKeysSummary(keysConfiguredCount, API_KEY_KINDS.length);
          } else if (snapshot) {
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
        <Pressable
          style={styles.cell}
          onPress={() => navigation.navigate('BrainAgentDefaultModel')}
          accessibilityRole="button"
        >
          <View style={styles.cellInner}>
            <Text style={styles.cellTitle}>{zh.brain.sections.agentDefaultModel}</Text>
            <Text style={styles.cellSub}>{zh.brain.agentDefaultModelHint}</Text>
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
  heroIcon: {
    width: 44,
    height: 44,
    marginTop: 2,
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