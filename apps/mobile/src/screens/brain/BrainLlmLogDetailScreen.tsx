import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { LlmRequestLogDetail } from '@xzz/shared';
import { formatZhDateTime, labelLlmChannel } from '../../brain/brainLabels';
import { brainLogicHints } from '../../brain/logicHints';
import { BrainDataCard } from '../../components/brain/BrainDataCard';
import { BrainJsonBlock } from '../../components/brain/BrainJsonBlock';
import { BrainScreenShell } from '../../components/brain/BrainScreenShell';
import { api } from '../../lib/api';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';
import { evaBrain } from '../../theme/evaBrain';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainLlmLogDetail'>;

export function BrainLlmLogDetailScreen({ navigation, route }: Props) {
  const [data, setData] = useState<LlmRequestLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getLlmLog(route.params.id);
      setData(res.data);
    } catch {
      setError(zh.brain.states.loadFailed);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [route.params.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const F = zh.brain.fields;

  return (
    <BrainScreenShell
      title={zh.brain.sections.llmLogs}
      hint={brainLogicHints.llmLogs}
      onBack={() => navigation.goBack()}
      loading={loading}
      error={error}
      onReload={() => void load()}
    >
      {data ? (
        <>
          <BrainDataCard
            fields={[
              { label: F.id, value: data.id },
              { label: F.channel, value: labelLlmChannel(data.channel) },
              { label: F.model, value: data.model },
              { label: F.provider, value: data.provider },
              { label: F.status, value: data.status === 'ok' ? '成功' : '失败' },
              { label: F.createdAt, value: formatZhDateTime(data.createdAt) },
              { label: '上下文占比', value: data.contextRatio != null ? String(data.contextRatio) : '' },
            ]}
          />
          {data.responseText ? (
            <BrainDataCard title="模型回复" fields={[{ label: '内容', value: data.responseText }]} />
          ) : null}
          <BrainJsonBlock data={data.displayTurns} title="对话轮次" />
          <BrainJsonBlock data={data.messages} title="请求 messages" />
          <BrainJsonBlock data={data.rawJson} title="原始 rawJson" />
        </>
      ) : (
        <Text style={{ color: evaBrain.textMuted, textAlign: 'center', marginTop: 24 }}>
          {zh.brain.states.empty}
        </Text>
      )}
    </BrainScreenShell>
  );
}
