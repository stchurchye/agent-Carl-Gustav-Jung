import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MemoryFragment } from '@xzz/shared';
import { brainLogicHints } from '../../brain/logicHints';
import { BrainMemoryFragmentList } from '../../components/brain/BrainMemoryFragmentList';
import { BrainScreenShell } from '../../components/brain/BrainScreenShell';
import { api } from '../../lib/api';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';
import { evaBrain } from '../../theme/evaBrain';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainMemoryReview'>;

export function BrainMemoryReviewScreen({ navigation }: Props) {
  const [items, setItems] = useState<MemoryFragment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listMemoryReview();
      setItems(res.data);
    } catch {
      setError(zh.brain.states.loadFailed);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <BrainScreenShell
      title={zh.brain.sections.memoryReview}
      hint={brainLogicHints.memoryReview}
      onBack={() => navigation.goBack()}
      loading={loading}
      error={error}
      onReload={() => void load()}
    >
      <Text style={styles.intro}>{zh.me.memoryReviewIntro}</Text>
      <BrainMemoryFragmentList
        items={items}
        reviewMode
        onChanged={load}
        onOpenDetail={(id) => navigation.navigate('BrainMemoryDetail', { fragmentId: id })}
      />
    </BrainScreenShell>
  );
}

const styles = StyleSheet.create({
  intro: {
    color: evaBrain.textMuted,
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
});
