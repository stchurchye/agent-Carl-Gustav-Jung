import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MemoryCategory, MemoryFragment } from '@xzz/shared';
import {
  MEMORY_PROJECT_NOTE_CHAR_LIMIT,
  MEMORY_USER_PROFILE_CHAR_LIMIT,
  MEMORY_USER_SCOPE_CHAR_BUDGET,
} from '@xzz/shared';
import { brainLogicHints } from '../../brain/logicHints';
import { BrainMemoryFragmentList } from '../../components/brain/BrainMemoryFragmentList';
import { BrainMetricBar } from '../../components/brain/BrainMetricBar';
import { BrainScreenShell } from '../../components/brain/BrainScreenShell';
import { api } from '../../lib/api';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';
import { brainTokens } from '../../theme/brainTokens';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainLongMemory'>;

type CategoryFilter = 'all' | MemoryCategory;

const FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: zh.brain.states.filterAll },
  { id: 'user_profile', label: zh.me.memoryCategoryProfile },
  { id: 'project_note', label: zh.me.memoryCategoryProject },
  { id: 'general', label: zh.me.memoryCategoryGeneral },
];

export function BrainLongMemoryScreen({ navigation }: Props) {
  const [items, setItems] = useState<MemoryFragment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listMemories({
        scope: 'user',
        includeSuppressed: true,
        category: categoryFilter === 'all' ? undefined : categoryFilter,
      });
      setItems(res.data.filter((f) => f.status !== 'deleted' && f.status !== 'pending'));
    } catch {
      setError(zh.brain.states.loadFailed);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const profileChars = items
    .filter((f) => f.category === 'user_profile')
    .reduce((n, f) => n + (f.content?.length ?? 0), 0);
  const projectChars = items
    .filter((f) => f.category !== 'user_profile')
    .reduce((n, f) => n + (f.content?.length ?? 0), 0);
  const totalChars = items.reduce((n, f) => n + (f.content?.length ?? 0), 0);

  return (
    <BrainScreenShell
      title={zh.brain.sections.memoryLong}
      hint={brainLogicHints.memoryLong}
      onBack={() => navigation.goBack()}
      loading={loading}
      error={error}
      onReload={() => void load()}
    >
      <BrainMetricBar
        label={zh.brain.hermes.profileLimit}
        used={profileChars}
        limit={MEMORY_USER_PROFILE_CHAR_LIMIT}
      />
      <BrainMetricBar
        label={zh.brain.hermes.projectLimit}
        used={projectChars}
        limit={MEMORY_PROJECT_NOTE_CHAR_LIMIT}
      />
      <BrainMetricBar
        label={zh.brain.hermes.totalBudget}
        used={totalChars}
        limit={MEMORY_USER_SCOPE_CHAR_BUDGET}
      />
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.id}
            style={[styles.chip, categoryFilter === f.id && styles.chipActive]}
            onPress={() => setCategoryFilter(f.id)}
          >
            <Text style={[styles.chipText, categoryFilter === f.id && styles.chipTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.section}>{zh.brain.actions.manageSection}</Text>
      <BrainMemoryFragmentList
        items={items}
        onChanged={load}
        onOpenDetail={(id) => navigation.navigate('BrainMemoryDetail', { fragmentId: id })}
      />
    </BrainScreenShell>
  );
}

const styles = StyleSheet.create({
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: brainTokens.borderSubtle,
  },
  chipActive: {
    borderColor: brainTokens.accent,
    backgroundColor: 'rgba(255, 140, 26, 0.15)',
  },
  chipText: { color: brainTokens.textMuted, fontSize: 12 },
  chipTextActive: { color: brainTokens.accent },
  section: {
    color: brainTokens.accent,
    fontSize: 13,
    fontWeight: '700',
    marginHorizontal: 16,
    marginBottom: 8,
  },
});
