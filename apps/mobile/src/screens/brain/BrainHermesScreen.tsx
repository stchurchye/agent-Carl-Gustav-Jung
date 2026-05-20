import { useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  MEMORY_CANDIDATE_POOL_LIMIT,
  MEMORY_PROJECT_NOTE_CHAR_LIMIT,
  MEMORY_SHORT_TERM_CHAR_LIMIT,
  MEMORY_USER_PROFILE_CHAR_LIMIT,
  MEMORY_USER_SCOPE_CHAR_BUDGET,
} from '@xzz/shared';
import { brainLogicHints } from '../../brain/logicHints';
import { useBrainSnapshot } from '../../brain/useBrainSnapshot';
import { BrainDataCard } from '../../components/brain/BrainDataCard';
import { BrainMetricBar } from '../../components/brain/BrainMetricBar';
import { BrainScreenShell } from '../../components/brain/BrainScreenShell';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';
import { evaBrain } from '../../theme/evaBrain';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainHermes'>;

export function BrainHermesScreen({ navigation }: Props) {
  const { snapshot, loading, error, refresh, limits } = useBrainSnapshot();

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return (
    <BrainScreenShell
      title={zh.brain.sections.catHealth}
      hint={brainLogicHints.catHealth}
      onBack={() => navigation.goBack()}
      loading={loading}
      error={error}
      onReload={() => void refresh()}
    >
      {snapshot ? (
        <>
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
            label={zh.brain.hermes.shortLimit}
            used={snapshot.shortChars}
            limit={limits.short}
          />
          <BrainMetricBar
            label={zh.brain.hermes.totalBudget}
            used={snapshot.totalUserChars}
            limit={limits.total}
          />
        </>
      ) : null}

      <BrainDataCard
        title={zh.brain.hermes.autoExtract}
        fields={[
          {
            label: zh.brain.fields.status,
            value: snapshot?.autoExtractEnabled
              ? zh.brain.hermes.autoExtractOn
              : zh.brain.hermes.autoExtractOff,
          },
        ]}
      />

      <BrainDataCard
        title={zh.brain.hermes.constantsTitle}
        fields={[
          { label: zh.brain.hermes.profileLimit, value: String(MEMORY_USER_PROFILE_CHAR_LIMIT) },
          { label: zh.brain.hermes.projectLimit, value: String(MEMORY_PROJECT_NOTE_CHAR_LIMIT) },
          { label: zh.brain.hermes.shortLimit, value: String(MEMORY_SHORT_TERM_CHAR_LIMIT) },
          { label: zh.brain.hermes.totalBudget, value: String(MEMORY_USER_SCOPE_CHAR_BUDGET) },
          { label: '检索候选池上限', value: String(MEMORY_CANDIDATE_POOL_LIMIT) },
        ]}
      />

      <Text style={styles.pipelineTitle}>{zh.brain.hermes.pipelineTitle}</Text>
      <Text style={styles.pipeline}>{zh.brain.hermes.pipelineSteps}</Text>
    </BrainScreenShell>
  );
}

const styles = StyleSheet.create({
  prefsLink: {
    marginHorizontal: 16,
    marginBottom: 10,
  },
  prefsLinkText: {
    color: evaBrain.info,
    fontSize: 14,
  },
  pipelineTitle: {
    color: evaBrain.accent,
    fontSize: 13,
    fontWeight: '700',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 6,
  },
  pipeline: {
    color: evaBrain.textMuted,
    fontSize: 12,
    lineHeight: 20,
    marginHorizontal: 16,
    fontFamily: evaBrain.mono,
  },
});
