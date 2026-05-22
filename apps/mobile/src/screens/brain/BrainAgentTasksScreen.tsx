import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../lib/api';
import type { AgentRun, AgentRunStatus } from '../../features/agent/types';
import type { BrainStackParamList } from '../../navigation/types';
import { evaBrain } from '../../theme/evaBrain';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainAgentTasks'>;

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  draft: '准备中',
  planning: '规划中',
  running: '运行中',
  awaiting_approval: '等待授权',
  awaiting_user_input: '等待输入',
  replanning: '重新规划',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  budget_exhausted: '预算耗尽',
};

const TERMINAL: AgentRunStatus[] = ['completed', 'failed', 'cancelled', 'budget_exhausted'];

function statusColor(status: AgentRunStatus): string {
  if (status === 'completed') return '#0a8';
  if (status === 'failed' || status === 'budget_exhausted') return '#c33';
  if (status === 'cancelled') return '#888';
  if (status === 'awaiting_approval') return '#d80';
  return '#369';
}

export function BrainAgentTasksScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listAgentRuns();
      const data = res.data as { runs: AgentRun[] };
      setRuns(data.runs ?? []);
    } catch (e) {
      setError(String(e));
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
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Agent 任务</Text>
        <TouchableOpacity onPress={() => void load()}>
          <Text style={styles.refresh}>刷新</Text>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.errorRow}>{error}</Text> : null}

      <FlatList
        data={runs}
        keyExtractor={(r) => r.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => void load()} />
        }
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.emptyRow}>
              还没有 agent 任务。在聊天里输入 /agent 或带"研究 / 整理一份…"的消息触发。
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.cell}
            onPress={() => navigation.navigate('BrainAgentTaskDetail', { runId: item.id })}
          >
            <View style={styles.cellHeader}>
              <Text style={[styles.cellStatus, { color: statusColor(item.status) }]}>
                {STATUS_LABEL[item.status] ?? item.status}
              </Text>
              <Text style={styles.cellChannel}>
                {item.channel === 'group' ? '群聊' : '私聊'}
              </Text>
            </View>
            <Text style={styles.cellText} numberOfLines={2}>
              {item.inputText}
            </Text>
            <Text style={styles.cellMeta}>
              步骤 {item.usage?.steps ?? 0}/{item.budget?.maxSteps ?? '?'}
              {!TERMINAL.includes(item.status) && item.status !== 'awaiting_approval'
                ? ' · 进行中'
                : ''}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: evaBrain.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  back: { color: evaBrain.accent, fontSize: 14 },
  title: { color: evaBrain.text, fontSize: 18, fontWeight: '600' },
  refresh: { color: evaBrain.accent, fontSize: 14 },
  errorRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    color: '#c33',
  },
  emptyRow: {
    paddingHorizontal: 24,
    paddingVertical: 48,
    color: evaBrain.textDim,
    textAlign: 'center',
  },
  cell: {
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 12,
    backgroundColor: evaBrain.bgCard,
    borderRadius: 8,
  },
  cellHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cellStatus: { fontWeight: '600', fontSize: 13 },
  cellChannel: { color: evaBrain.textDim, fontSize: 12 },
  cellText: { color: evaBrain.text, fontSize: 14 },
  cellMeta: { color: evaBrain.textDim, fontSize: 12, marginTop: 4 },
});
