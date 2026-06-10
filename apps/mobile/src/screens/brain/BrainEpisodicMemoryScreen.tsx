import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WeChatChatHeader } from '../../components/WeChatChatHeader';
import { api, type AgentMemoryItem } from '../../lib/api';
import { apiErrorText } from '../../lib/apiError';
import { zh } from '../../locales/zh-CN';
import type { BrainStackParamList } from '../../navigation/types';
import { colors, typography } from '../../theme/colors';
import { wechatChatStyles } from '../../theme/wechatChat';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainEpisodicMemory'>;

type StatusFilter = 'pending' | 'approved' | 'rejected';

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'pending', label: '待审' },
  { id: 'approved', label: '已批准' },
  { id: 'rejected', label: '已标错' },
];

const SENTIMENT_LABEL: Record<string, string> = {
  positive: '积极',
  negative: '消极',
  neutral: '中性',
  mixed: '复杂',
};

const TRUTH_LABEL: Record<string, string> = {
  disputed: '有争议',
  refuted: '已证伪',
};

export function BrainEpisodicMemoryScreen(_props: Props) {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<BrainStackParamList>>();
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [items, setItems] = useState<AgentMemoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listAgentMemory(filter);
      setItems(res.data.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const decide = (id: number, decision: 'approve' | 'reject') => {
    void api
      .decideAgentMemory(id, decision)
      .then(load)
      .catch((e) => Alert.alert('失败', apiErrorText(e).message));
  };

  const promote = (id: number) => {
    void api
      .promoteAgentMemory(id)
      .then(load)
      .catch((e) => Alert.alert('失败', apiErrorText(e).message));
  };

  // K8:标伪/标争议/撤销(可逆;伪 ≠ 删,仍可被 agent 检索但带警示)
  const markTruth = (id: number, truthStatus: 'unverified' | 'disputed' | 'refuted') => {
    void api
      .markTruthAgentMemory(id, truthStatus)
      .then(load)
      .catch((e) => Alert.alert('失败', apiErrorText(e).message));
  };

  const askMarkTruth = (id: number) => {
    Alert.alert('标记真伪', '把这条研究结论标记为?', [
      { text: '有争议', onPress: () => markTruth(id, 'disputed') },
      { text: '已证伪', style: 'destructive', onPress: () => markTruth(id, 'refuted') },
      { text: '撤销标记', onPress: () => markTruth(id, 'unverified') },
      { text: '取消', style: 'cancel' },
    ]);
  };

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.brain.sections.memoryEpisodic} showBack />
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.id}
            style={[styles.chip, filter === f.id && styles.chipActive]}
            onPress={() => setFilter(f.id)}
          >
            <Text style={[styles.chipText, filter === f.id && styles.chipTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom, 16) + 12 },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : items.length === 0 ? (
          <Text style={styles.empty}>
            {filter === 'pending'
              ? '没有待审核的记忆'
              : filter === 'rejected'
                ? '没有标错的记忆'
                : '还没有已批准的记忆'}
          </Text>
        ) : (
          items.map((it) => (
            <View key={it.id} style={styles.card}>
              <View style={styles.badges}>
                {it.kind === 'finding' ? (
                  <Text style={[styles.badge, styles.findingBadge]}>研究结论</Text>
                ) : it.kind === 'insight' ? (
                  <Text style={[styles.badge, styles.insightBadge]}>洞见</Text>
                ) : null}
                {it.truthStatus !== 'unverified' ? (
                  <Text
                    style={[
                      styles.badge,
                      it.truthStatus === 'refuted' ? styles.refutedBadge : styles.disputedBadge,
                    ]}
                  >
                    {TRUTH_LABEL[it.truthStatus]}
                  </Text>
                ) : null}
                {it.sentiment ? (
                  <Text style={styles.badge}>
                    {SENTIMENT_LABEL[it.sentiment] ?? it.sentiment}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.text}>{it.text}</Text>
              {it.truthNote ? <Text style={styles.truthNote}>说明:{it.truthNote}</Text> : null}
              {/* K8:来源(可点开原文)—— 回溯原点第①层 */}
              {it.sources?.map((s, i) => (
                <Pressable key={`${it.id}-src-${i}`} onPress={() => void Linking.openURL(s.url)}>
                  <Text style={styles.sourceLink} numberOfLines={1}>
                    🔗 {s.title ?? s.url}
                    {s.year ? ` (${s.year})` : ''}
                  </Text>
                </Pressable>
              ))}
              {it.counterSources?.map((s, i) => (
                <Pressable key={`${it.id}-cs-${i}`} onPress={() => void Linking.openURL(s.url)}>
                  <Text style={[styles.sourceLink, styles.counterLink]} numberOfLines={1}>
                    ⚠ 反证: {s.title ?? s.url}
                  </Text>
                </Pressable>
              ))}
              <Text style={styles.meta}>
                {it.confidence != null ? `置信 ${it.confidence.toFixed(2)} · ` : ''}
                {it.createdAt ? it.createdAt.slice(0, 10) : ''}
                {it.kind === 'insight' && it.sourceFragmentIds?.length
                  ? ` · 由 ${it.sourceFragmentIds.length} 条合成`
                  : ''}
                {it.supersededById ? ` · 已被新版取代(#${it.supersededById})` : ''}
              </Text>
              {/* K8:来源任务深链 —— 回溯原点第②层(跳到产生此记忆的 run 详情) */}
              {it.sourceRunId ? (
                <Pressable
                  onPress={() =>
                    navigation.navigate('BrainAgentTaskDetail', { runId: it.sourceRunId! })
                  }
                >
                  <Text style={styles.taskLink}>查看来源任务 →</Text>
                </Pressable>
              ) : null}
              {filter === 'rejected' ? (
                // 删错可追回:rejected → approve 恢复(行从不物理删除)
                <View style={styles.actions}>
                  <Pressable
                    style={[styles.btn, styles.approve]}
                    onPress={() => decide(it.id, 'approve')}
                  >
                    <Text style={styles.btnText}>恢复</Text>
                  </Pressable>
                </View>
              ) : filter === 'pending' ? (
                <View style={styles.actions}>
                  <Pressable
                    style={[styles.btn, styles.approve]}
                    onPress={() => decide(it.id, 'approve')}
                  >
                    <Text style={styles.btnText}>批准</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.btn, styles.reject]}
                    onPress={() => decide(it.id, 'reject')}
                  >
                    <Text style={styles.btnText}>拒绝</Text>
                  </Pressable>
                </View>
              ) : it.promotedAt ? (
                <Text style={styles.promoted}>已升格到核心记忆</Text>
              ) : (
                <View style={styles.actions}>
                  {/* finding 不升格(研究结论留情景层);可标真伪 */}
                  {it.kind === 'finding' ? (
                    <Pressable
                      style={[styles.btn, styles.truthBtn]}
                      onPress={() => askMarkTruth(it.id)}
                    >
                      <Text style={styles.btnText}>标记真伪</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={[styles.btn, styles.promoteBtn]}
                      onPress={() => promote(it.id)}
                    >
                      <Text style={styles.btnText}>升格到核心</Text>
                    </Pressable>
                  )}
                  {/* 标记错误(approved → rejected;行不删,可在「拒绝」筛选里恢复) */}
                  <Pressable
                    style={[styles.btn, styles.reject]}
                    onPress={() => decide(it.id, 'reject')}
                  >
                    <Text style={styles.btnText}>标记错误</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: 8, paddingHorizontal: 12 },
  loader: { marginVertical: 32 },
  empty: {
    fontSize: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 40,
  },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: typography.caption, color: colors.textMuted },
  chipTextActive: { color: '#fff' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  text: { fontSize: typography.body, color: colors.text },
  meta: { fontSize: typography.caption, color: colors.textMuted, marginTop: 6 },
  badges: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  badge: {
    fontSize: typography.caption,
    color: colors.textMuted,
    backgroundColor: colors.background,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  insightBadge: { color: '#fff', backgroundColor: colors.primary },
  findingBadge: { color: '#fff', backgroundColor: '#3a7ca5' },
  disputedBadge: { color: '#fff', backgroundColor: '#e0a800' },
  refutedBadge: { color: '#fff', backgroundColor: '#d9534f' },
  truthNote: { fontSize: typography.caption, color: '#b9770e', marginTop: 4 },
  sourceLink: { fontSize: typography.caption, color: colors.primary, marginTop: 4 },
  counterLink: { color: '#d9534f' },
  taskLink: { fontSize: typography.caption, color: colors.primary, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  btn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 8 },
  approve: { backgroundColor: colors.primary },
  reject: { backgroundColor: '#d9534f' },
  promoteBtn: { backgroundColor: colors.primary },
  truthBtn: { backgroundColor: '#e0a800' },
  promoted: { fontSize: typography.caption, color: colors.textMuted, marginTop: 10 },
  btnText: { fontSize: typography.caption, color: '#fff' },
});
