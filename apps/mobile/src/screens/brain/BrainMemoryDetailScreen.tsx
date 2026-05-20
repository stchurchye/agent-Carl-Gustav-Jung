import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MemoryFragment, MemoryFragmentVersion } from '@xzz/shared';
import { formatZhDateTime } from '../../brain/brainLabels';
import { brainLogicHints } from '../../brain/logicHints';
import { memoryFragmentToFields } from '../../brain/memoryFragmentFields';
import { BrainDataCard } from '../../components/brain/BrainDataCard';
import { BrainJsonBlock } from '../../components/brain/BrainJsonBlock';
import { BrainScreenShell } from '../../components/brain/BrainScreenShell';
import { api } from '../../lib/api';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainMemoryDetail'>;

export function BrainMemoryDetailScreen({ navigation, route }: Props) {
  const [fragment, setFragment] = useState<MemoryFragment | null>(null);
  const [versions, setVersions] = useState<MemoryFragmentVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const id = route.params.fragmentId;
    try {
      const [userRes, sessionRes, topicRes, verRes] = await Promise.all([
        api.listMemories({ scope: 'user', includeSuppressed: true }),
        api.listMemories({ scope: 'session', includeSuppressed: true }),
        api.listMemories({ scope: 'topic', includeSuppressed: true }),
        api.listMemoryVersions(id).catch(() => ({ data: [] as MemoryFragmentVersion[] })),
      ]);
      const all = [...userRes.data, ...sessionRes.data, ...topicRes.data];
      setFragment(all.find((f) => f.id === id) ?? null);
      setVersions(verRes.data);
    } catch {
      setError(zh.brain.states.loadFailed);
      setFragment(null);
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [route.params.fragmentId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <BrainScreenShell
      title={zh.brain.sections.memoryDetail}
      hint={brainLogicHints.memoryDetail}
      onBack={() => navigation.goBack()}
      loading={loading}
      error={error}
      onReload={() => void load()}
    >
      {fragment ? (
        <>
          <BrainDataCard title={fragment.title} fields={memoryFragmentToFields(fragment)} />
          <BrainJsonBlock data={fragment} />
          <Text
            style={{
              color: '#ff8c1a',
              fontSize: 13,
              fontWeight: '700',
              marginHorizontal: 16,
              marginTop: 8,
              marginBottom: 8,
            }}
          >
            {zh.brain.versionHistory}
          </Text>
          {versions.length === 0 ? (
            <Text style={{ color: '#8a8278', textAlign: 'center' }}>{zh.brain.versionsEmpty}</Text>
          ) : (
            versions.map((v) => (
              <BrainDataCard
                key={v.id}
                title={`版本 ${v.version}`}
                fields={[
                  { label: zh.brain.fields.id, value: v.id },
                  { label: '来源', value: v.source === 'ai' ? 'AI' : v.source === 'user' ? '用户' : '导入' },
                  { label: zh.brain.fields.content, value: v.content },
                  { label: zh.brain.fields.createdAt, value: formatZhDateTime(v.createdAt) },
                ]}
              />
            ))
          )}
        </>
      ) : (
        <Text style={{ color: '#8a8278', textAlign: 'center', marginTop: 24 }}>
          {zh.brain.states.empty}
        </Text>
      )}
    </BrainScreenShell>
  );
}
