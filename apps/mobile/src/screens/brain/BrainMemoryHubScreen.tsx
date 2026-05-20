import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useBrainSnapshot } from '../../brain/useBrainSnapshot';
import { brainLogicHints } from '../../brain/logicHints';
import { BrainMetricBar } from '../../components/brain/BrainMetricBar';
import { BrainScreenShell } from '../../components/brain/BrainScreenShell';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';
import { evaBrain } from '../../theme/evaBrain';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainMemoryHub'>;

const SECONDARY_ROUTES = {
  memoryLong: 'BrainLongMemory',
  memoryShort: 'BrainShortMemory',
  memorySearch: 'BrainSessionSearch',
  memoryReview: 'BrainMemoryReview',
  memoryPrefs: 'BrainMemoryPrefs',
  catHealth: 'BrainHermes',
} as const satisfies Record<string, keyof BrainStackParamList>;

type HubKey = keyof typeof SECONDARY_ROUTES;

export function BrainMemoryHubScreen({ navigation }: Props) {
  const { snapshot, loading, error, refresh, limits } = useBrainSnapshot();

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const subtitle = (key: HubKey): string => {
    if (!snapshot) return '';
    switch (key) {
      case 'memoryLong':
        return zh.brain.countItems(snapshot.longMemoryCount);
      case 'memoryShort':
        return zh.brain.countItems(snapshot.shortMemoryCount);
      case 'memorySearch':
        return zh.brain.memorySearchHint;
      case 'memoryReview':
        return zh.brain.countItems(snapshot.reviewCount);
      case 'memoryPrefs':
      case 'catHealth':
        return snapshot.autoExtractEnabled
          ? zh.brain.hermes.autoExtractOn
          : zh.brain.hermes.autoExtractOff;
      default:
        return '';
    }
  };

  return (
    <BrainScreenShell
      title={zh.brain.sections.memoryHub}
      hint={brainLogicHints.memoryHub}
      onBack={() => navigation.goBack()}
      loading={loading}
      error={error}
      onReload={() => void refresh()}
    >
      {snapshot ? (
        <View style={styles.metrics}>
          <BrainMetricBar
            label={zh.brain.hermes.profileLimit}
            used={snapshot.profileChars}
            limit={limits.profile}
          />
          <BrainMetricBar
            label={zh.brain.hermes.projectLimit}
            used={snapshot.projectChars}
            limit={limits.project}
          />
          <BrainMetricBar
            label={zh.brain.hermes.totalBudget}
            used={snapshot.totalUserChars}
            limit={limits.total}
          />
        </View>
      ) : null}

      <Text style={styles.intro}>{zh.brain.memoryHubIntro}</Text>

      <View style={styles.grid}>
        {(Object.keys(SECONDARY_ROUTES) as HubKey[]).map((key) => (
          <Pressable
            key={key}
            style={styles.cell}
            onPress={() => navigation.navigate(SECONDARY_ROUTES[key])}
            accessibilityRole="button"
          >
            <View style={styles.cellInner}>
              <Text style={styles.cellTitle}>{zh.brain.sections[key]}</Text>
              {subtitle(key) ? <Text style={styles.cellSub}>{subtitle(key)}</Text> : null}
            </View>
          </Pressable>
        ))}
      </View>
    </BrainScreenShell>
  );
}

const styles = StyleSheet.create({
  metrics: { marginBottom: 4 },
  intro: {
    color: evaBrain.textMuted,
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
    backgroundColor: evaBrain.bgCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: evaBrain.border,
    borderRadius: 4,
    padding: 14,
    minHeight: 72,
  },
  cellTitle: {
    color: evaBrain.text,
    fontSize: 15,
    fontWeight: '600',
  },
  cellSub: {
    color: evaBrain.accent,
    fontSize: 11,
    marginTop: 6,
  },
});
