import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { LlmRequestChannel, LlmRequestLogListItem } from '@xzz/shared';
import { formatZhDateTime, labelLlmChannel } from '../../brain/brainLabels';
import { brainLogicHints } from '../../brain/logicHints';
import { BrainDataCard } from '../../components/brain/BrainDataCard';
import { BrainScreenShell } from '../../components/brain/BrainScreenShell';
import { api } from '../../lib/api';
import { API_KEY_KINDS, loadApiKeyStatus } from '../../lib/apiKeyKind';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';
import { brainTokens } from '../../theme/brainTokens';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainLlmLogs'>;

export function BrainLlmLogsScreen({ navigation }: Props) {
  const [items, setItems] = useState<LlmRequestLogListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<LlmRequestChannel | 'all'>('all');
  const [keysConfiguredCount, setKeysConfiguredCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listLlmLogs(100);
      setItems(res.data);
    } catch {
      setError(zh.brain.states.loadFailed);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadKeySummary = useCallback(async () => {
    const results = await Promise.all(API_KEY_KINDS.map((kind) => loadApiKeyStatus(kind)));
    setKeysConfiguredCount(results.filter((r) => r.configured).length);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      void loadKeySummary();
    }, [load, loadKeySummary]),
  );

  const channels = Array.from(new Set(items.map((i) => i.channel)));
  const filtered =
    channelFilter === 'all' ? items : items.filter((i) => i.channel === channelFilter);

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
      {/* 二级入口:汪星联络方式(密钥)与跑腿默认模型收纳于此 */}
      <View style={styles.entries}>
        <EntryRow
          title={zh.brain.sections.homeKeys}
          sub={zh.brain.homeKeysSummary(keysConfiguredCount, API_KEY_KINDS.length)}
          onPress={() => navigation.navigate('BrainHomeKeys')}
        />
        <EntryRow
          title={zh.brain.sections.agentDefaultModel}
          sub={zh.brain.agentDefaultModelHint}
          onPress={() => navigation.navigate('BrainAgentDefaultModel')}
        />
      </View>

      <View style={styles.filters}>
        <FilterChip
          label={zh.brain.states.filterAll}
          active={channelFilter === 'all'}
          onPress={() => setChannelFilter('all')}
        />
        {channels.map((c) => (
          <FilterChip
            key={c}
            label={labelLlmChannel(c)}
            active={channelFilter === c}
            onPress={() => setChannelFilter(c)}
          />
        ))}
      </View>

      <Text style={styles.count}>{zh.brain.countItems(filtered.length)}</Text>

      {filtered.length === 0 ? (
        <Text style={styles.empty}>{zh.brain.states.empty}</Text>
      ) : (
        filtered.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => navigation.navigate('BrainLlmLogDetail', { id: item.id })}
          >
            <BrainDataCard
              title={item.channelLabel}
              fields={[
                { label: F.id, value: item.id },
                { label: F.channel, value: labelLlmChannel(item.channel) },
                { label: F.model, value: item.model },
                { label: F.provider, value: item.provider },
                { label: F.status, value: item.status === 'ok' ? '成功' : '失败' },
                { label: F.createdAt, value: formatZhDateTime(item.createdAt) },
                { label: '摘要', value: item.metaLine },
                { label: '预览', value: item.listPreview },
                { label: F.sessionId, value: item.sessionId ?? '' },
                { label: F.topicId, value: item.topicId ?? '' },
                { label: F.groupId, value: item.groupId ?? '' },
              ]}
              footer={item.errorMessage ?? undefined}
            />
          </Pressable>
        ))
      )}
    </BrainScreenShell>
  );
}

function EntryRow({
  title,
  sub,
  onPress,
}: {
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.entryRow} onPress={onPress} accessibilityRole="button">
      <View style={styles.entryTextCol}>
        <Text style={styles.entryTitle}>{title}</Text>
        {sub ? <Text style={styles.entrySub}>{sub}</Text> : null}
      </View>
      <Text style={styles.entryChevron}>›</Text>
    </Pressable>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  entries: {
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 8,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: brainTokens.bgCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: brainTokens.border,
    borderRadius: 4,
    padding: 14,
  },
  entryTextCol: { flex: 1 },
  entryTitle: {
    color: brainTokens.text,
    fontSize: 15,
    fontWeight: '600',
  },
  entrySub: {
    color: brainTokens.accent,
    fontSize: 11,
    marginTop: 6,
  },
  entryChevron: {
    color: brainTokens.textMuted,
    fontSize: 20,
    marginLeft: 8,
  },
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
    backgroundColor: brainTokens.accentDim,
  },
  chipText: { color: brainTokens.textMuted, fontSize: 12 },
  chipTextActive: { color: brainTokens.accent },
  count: {
    color: brainTokens.textMuted,
    fontSize: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  empty: {
    color: brainTokens.textMuted,
    textAlign: 'center',
    marginTop: 24,
  },
});
