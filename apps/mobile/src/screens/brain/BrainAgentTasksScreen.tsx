import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listAgentRuns } from '../../features/agent/agentApi';
import type { AgentRun, AgentRunStatus } from '../../features/agent/types';
import type { BrainStackParamList } from '../../navigation/types';
import { evaBrain } from '../../theme/evaBrain';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainAgentTasks'>;

type FilterKey = 'all' | 'inflight' | 'completed' | 'failed' | 'cancelled';

const FILTERS: { key: FilterKey; label: string; statuses: AgentRunStatus[] | null }[] = [
  { key: 'all', label: '全部', statuses: null },
  {
    key: 'inflight',
    label: '进行中',
    statuses: ['draft', 'planning', 'running', 'replanning', 'awaiting_approval', 'awaiting_user_input'],
  },
  { key: 'completed', label: '已完成', statuses: ['completed'] },
  { key: 'failed', label: '失败', statuses: ['failed', 'budget_exhausted'] },
  { key: 'cancelled', label: '取消', statuses: ['cancelled'] },
];

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

function statusColor(s: AgentRunStatus): string {
  if (s === 'completed') return '#0a6';
  if (s === 'failed' || s === 'budget_exhausted') return '#c33';
  if (s === 'cancelled') return '#999';
  return evaBrain.accent;
}

function formatCny(n?: number): string {
  if (!n || n <= 0) return '¥0.00';
  if (n < 0.01) return `¥${n.toFixed(4)}`;
  return `¥${n.toFixed(2)}`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function expiresCountdown(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return '已过期';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `剩 ${h}h ${m}m`;
}

const INFLIGHT_STATUSES: AgentRunStatus[] = [
  'draft', 'planning', 'running', 'replanning', 'awaiting_approval', 'awaiting_user_input',
];

export function BrainAgentTasksScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const filterDef = FILTERS.find((f) => f.key === filter)!;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { runs: fetched, hasMore: hm } = await listAgentRuns({ limit: 100 });
      setRuns(fetched);
      setHasMore(hm);
    } catch (e) {
      console.warn('[BrainAgentTasksScreen.load]', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const filteredRuns = useMemo(() => {
    if (!filterDef.statuses) return runs;
    return runs.filter((r) => filterDef.statuses!.includes(r.status));
  }, [runs, filterDef]);

  const aggregate = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const month = new Date(today.getFullYear(), today.getMonth(), 1);
    let todayCost = 0;
    let monthCost = 0;
    let inflightCount = 0;
    for (const r of runs) {
      const cost = r.usage?.costCny ?? 0;
      const created = new Date(r.createdAt);
      if (created >= today) todayCost += cost;
      if (created >= month) monthCost += cost;
      if (INFLIGHT_STATUSES.includes(r.status)) inflightCount++;
    }
    return { todayCost, monthCost, inflightCount };
  }, [runs]);

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Agent 任务</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          今日 {formatCny(aggregate.todayCost)} · 本月 {formatCny(aggregate.monthCost)} · {aggregate.inflightCount} 个进行中
        </Text>
        <Text style={styles.bannerHint}>费用为估算值（按 cache-miss 上限算）</Text>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.chip, filter === f.key && styles.chipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filteredRuns}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={
          loading
            ? <View style={styles.empty}><ActivityIndicator color={evaBrain.accent} /></View>
            : <Text style={styles.emptyText}>暂无任务</Text>
        }
        ListFooterComponent={hasMore ? <Text style={styles.footerHint}>仅显示最近 100 条</Text> : null}
        renderItem={({ item }) => {
          const cost = item.usage?.costCny ?? 0;
          const { summary } = item;
          const expiresLabel = item.status === 'awaiting_user_input'
            ? expiresCountdown(item.pendingUserInputExpiresAt)
            : null;
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => navigation.navigate('BrainAgentTaskDetail', { runId: item.id })}
            >
              <View style={styles.rowTop}>
                <Text style={[styles.statusBadge, { color: statusColor(item.status) }]}>
                  ● {STATUS_LABEL[item.status] ?? item.status}
                </Text>
                <Text style={styles.relTime}>{relativeTime(item.createdAt)}</Text>
                {expiresLabel ? <Text style={styles.expiresBadge}>⏱ {expiresLabel}</Text> : null}
              </View>
              <Text style={styles.inputText} numberOfLines={2}>{item.inputText}</Text>
              <Text style={styles.metaLine}>
                {summary
                  ? `${summary.stepCount} 步 · ${summary.toolCount} 工具${summary.refCount > 0 ? ` · ${summary.refCount} 引用` : ''} · `
                  : ''}
                {formatCny(cost)} 估算
              </Text>
            </TouchableOpacity>
          );
        }}
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
  banner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: evaBrain.bgCard,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: evaBrain.borderSubtle,
  },
  bannerText: { fontSize: 13, fontWeight: '600', color: evaBrain.text },
  bannerHint: { fontSize: 10, color: evaBrain.textDim, marginTop: 2 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingVertical: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 6,
    backgroundColor: evaBrain.bgCard,
    borderRadius: 12,
  },
  chipActive: { backgroundColor: evaBrain.accent },
  chipText: { fontSize: 12, color: evaBrain.accent },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  row: {
    marginHorizontal: 12,
    marginVertical: 4,
    padding: 12,
    backgroundColor: evaBrain.bgCard,
    borderRadius: 8,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  statusBadge: { fontSize: 12, fontWeight: '600' },
  relTime: { fontSize: 10, color: evaBrain.textDim, marginLeft: 'auto' },
  expiresBadge: { fontSize: 10, color: '#a60' },
  inputText: { fontSize: 13, color: evaBrain.text, marginTop: 4 },
  metaLine: { fontSize: 11, color: evaBrain.textDim, marginTop: 4 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: evaBrain.textDim, textAlign: 'center', padding: 40 },
  footerHint: { textAlign: 'center', color: evaBrain.textDim, fontSize: 11, paddingVertical: 12 },
});
