import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MemoryFragment } from '@xzz/shared';
import { MEMORY_SHORT_TERM_CHAR_LIMIT } from '@xzz/shared';
import { brainLogicHints } from '../../brain/logicHints';
import { BrainMemoryFragmentList } from '../../components/brain/BrainMemoryFragmentList';
import { BrainMetricBar } from '../../components/brain/BrainMetricBar';
import { BrainScreenShell } from '../../components/brain/BrainScreenShell';
import { api } from '../../lib/api';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';
import { brainTokens } from '../../theme/brainTokens';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainShortMemory'>;

export function BrainShortMemoryScreen({ navigation }: Props) {
  const [sessionItems, setSessionItems] = useState<MemoryFragment[]>([]);
  const [topicItems, setTopicItems] = useState<MemoryFragment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sessionRes, topicRes] = await Promise.all([
        api.listMemories({ scope: 'session', includeSuppressed: true }),
        api.listMemories({ scope: 'topic', includeSuppressed: true }),
      ]);
      const keep = (f: MemoryFragment) => f.status !== 'deleted' && f.status !== 'pending';
      setSessionItems(sessionRes.data.filter(keep));
      setTopicItems(topicRes.data.filter(keep));
    } catch {
      setError(zh.brain.states.loadFailed);
      setSessionItems([]);
      setTopicItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const allItems = [...sessionItems, ...topicItems];
  const totalChars = allItems.reduce((n, f) => n + (f.content?.length ?? 0), 0);

  return (
    <BrainScreenShell
      title={zh.brain.sections.memoryShort}
      hint={brainLogicHints.memoryShort}
      onBack={() => navigation.goBack()}
      loading={loading}
      error={error}
      onReload={() => void load()}
    >
      <BrainMetricBar
        label={zh.brain.hermes.shortLimit}
        used={totalChars}
        limit={MEMORY_SHORT_TERM_CHAR_LIMIT}
      />
      <Text style={styles.section}>{zh.me.shortMemorySessionSection}</Text>
      <BrainMemoryFragmentList
        items={sessionItems}
        scopeBadge={() => zh.me.shortMemorySessionBadge}
        onChanged={load}
        onOpenDetail={(id) => navigation.navigate('BrainMemoryDetail', { fragmentId: id })}
      />
      <Text style={[styles.section, styles.sectionGap]}>{zh.me.shortMemoryTopicSection}</Text>
      <BrainMemoryFragmentList
        items={topicItems}
        scopeBadge={() => zh.me.shortMemoryTopicBadge}
        onChanged={load}
        onOpenDetail={(id) => navigation.navigate('BrainMemoryDetail', { fragmentId: id })}
      />
    </BrainScreenShell>
  );
}

const styles = StyleSheet.create({
  section: {
    color: brainTokens.textMuted,
    fontSize: 12,
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  sectionGap: { marginTop: 16 },
});
