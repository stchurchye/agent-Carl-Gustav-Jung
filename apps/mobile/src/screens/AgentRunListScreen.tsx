import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { listAgentRuns } from '../features/agent/agentApi';
import type { AgentRun, AgentRunStatus } from '../features/agent/types';

type FilterKey = 'all' | 'inflight' | 'completed' | 'failed' | 'cancelled';

const FILTERS: { key: FilterKey; label: string; statuses: AgentRunStatus[] | null }[] = [
  { key: 'all',       label: '全部',   statuses: null },
  { key: 'inflight',  label: '进行中', statuses: ['draft', 'planning', 'running', 'replanning', 'awaiting_approval', 'awaiting_user_input'] },
  { key: 'completed', label: '已完成', statuses: ['completed'] },
  { key: 'failed',    label: '失败',   statuses: ['failed', 'budget_exhausted'] },
  { key: 'cancelled', label: '取消',   statuses: ['cancelled'] },
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
  return '#06b';
}

function formatCny(n?: number): string {
  if (!n || n <= 0) return '¥0.00';
  if (n < 0.01) return `¥${n.toFixed(4)}`;
  return `¥${n.toFixed(2)}`;
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function expiresCountdown(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return '已过期';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return `剩 ${h}h ${m}m`;
}

export function AgentRunListScreen() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const navigation = useNavigation<any>();
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
      console.warn('[AgentRunListScreen.load]', e);
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
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const month = new Date(today.getFullYear(), today.getMonth(), 1);
    let todayCost = 0;
    let monthCost = 0;
    let inflightCount = 0;
    for (const r of runs) {
      const cost = r.usage?.costCny ?? 0;
      const created = new Date(r.createdAt as string);
      if (created >= today) todayCost += cost;
      if (created >= month) monthCost += cost;
      if (['draft', 'planning', 'running', 'replanning', 'awaiting_approval', 'awaiting_user_input'].includes(r.status)) {
        inflightCount++;
      }
    }
    return { todayCost, monthCost, inflightCount };
  }, [runs]);

  return (
    <View style={styles.container}>
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
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
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
          loading ? (
            <View style={styles.empty}><ActivityIndicator /></View>
          ) : (
            <View style={styles.empty}><Text style={styles.emptyText}>暂无任务</Text></View>
          )
        }
        ListFooterComponent={hasMore ? <Text style={styles.footerHint}>仅显示最近 100 条</Text> : null}
        renderItem={({ item }) => {
          const cost = item.usage?.costCny ?? 0;
          const summary = item.summary;
          const expiresLabel = item.status === 'awaiting_user_input'
            ? expiresCountdown(item.pendingUserInputExpiresAt)
            : null;
          const created = item.createdAt as string;
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => navigation.navigate('AgentRunDetail', { runId: item.id })}
            >
              <View style={styles.rowTopLine}>
                <Text style={[styles.statusBadge, { color: statusColor(item.status) }]}>
                  ● {STATUS_LABEL[item.status] ?? item.status}
                </Text>
                <Text style={styles.relTime}>{relativeTime(created)}</Text>
                {expiresLabel ? (
                  <Text style={styles.expiresBadge}>⏱ {expiresLabel}</Text>
                ) : null}
              </View>
              <Text style={styles.inputText} numberOfLines={2}>
                {item.inputText}
              </Text>
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
  container: { flex: 1, backgroundColor: '#fff' },
  banner: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd',
    backgroundColor: '#fafafa',
  },
  bannerText: { fontSize: 13, fontWeight: '600', color: '#222' },
  bannerHint: { fontSize: 10, color: '#888', marginTop: 2 },
  filterRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
  },
  filterChip: {
    paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: '#eef', borderRadius: 12,
    marginRight: 6, marginBottom: 4,
  },
  filterChipActive: { backgroundColor: '#1976d2' },
  filterText: { fontSize: 12, color: '#1976d2' },
  filterTextActive: { color: '#fff', fontWeight: '600' },
  row: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f0f0f0',
  },
  rowTopLine: { flexDirection: 'row', alignItems: 'center' },
  statusBadge: { fontSize: 12, fontWeight: '600' },
  relTime: { fontSize: 10, color: '#999', marginLeft: 'auto' },
  expiresBadge: { fontSize: 10, color: '#a60', marginLeft: 6 },
  inputText: { fontSize: 13, color: '#222', marginTop: 4 },
  metaLine: { fontSize: 11, color: '#666', marginTop: 4 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#999' },
  footerHint: { textAlign: 'center', color: '#999', fontSize: 11, paddingVertical: 12 },
});
