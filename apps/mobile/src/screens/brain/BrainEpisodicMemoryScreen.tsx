import { useCallback, useEffect, useRef, useState } from 'react';
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
import { api, type AgentMemoryItem, type MemoryScope } from '../../lib/api';
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
  // U5:群池评审入口 —— scope=me(个人池,默认)|group(群共享池,后端校验群成员)。
  const [scope, setScope] = useState<MemoryScope>({ scope: 'me' });
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  // W2 防闪:同一(filter,scope)的聚焦重拉静默刷新(不清列表不显 spinner);
  // 切筛选/切池才清旧数据 + spinner(不同数据集,旧内容不该残留)。
  const lastQueryKeyRef = useRef('');
  // review-w1 CONFIRMED:快速连点 me→群→me 时在途响应乱序返回会把别的池渲染进当前池
  // (且 decide 会把群池 id 发去个人端点)——以请求序号丢弃过期响应。
  const reqIdRef = useRef(0);

  useEffect(() => {
    void api
      .listGroups()
      .then((r) => setGroups(r.data.map((g) => ({ id: g.id, name: g.name }))))
      .catch(() => {});
  }, []);

  const scopeArg = scope.scope === 'group' ? scope : undefined;

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    const key = `${filter}:${scope.scope === 'group' ? scope.groupId : 'me'}`;
    if (lastQueryKeyRef.current !== key) {
      setItems([]);
      setLoading(true);
    }
    try {
      // scopeArg 直传:api 层把 undefined 与 {scope:'me'} 归一化为同一请求(scopeQuery/scopeBody)
      const res = await api.listAgentMemory(filter, scopeArg);
      if (reqId !== reqIdRef.current) return; // 过期响应:已切池/筛选,丢弃
      setItems(res.data.items);
      lastQueryKeyRef.current = key;
    } catch {
      if (reqId === reqIdRef.current) setItems([]);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [filter, scope, scopeArg]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // 终审 BUG①:动作 .then(reload) 捕获的是按下那次渲染的旧闭包(旧 filter/scope),
  // 在途时切池会以旧 scope 重拉并被当成"最新"接受 → 池/列表错位。恒经 ref 调最新 load。
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(() => loadRef.current(), []);

  const decide = (id: number, decision: 'approve' | 'reject') => {
    void api
      .decideAgentMemory(id, decision, scopeArg)
      .then(reload)
      .catch((e) => Alert.alert('失败', apiErrorText(e).message));
  };

  // F1:恢复要兼顾两条正交轴 —— 时效轴(valid_until)先 revalidate;若该条还在评审轴上
  // 是 rejected(revalidate 回传 status==='rejected'),再补 decide(approve)。仅评审轴失效
  // (validUntil=null)则只 decide。否则"恢复"会静默半失败(改了状态但记忆仍因失效不可召回)。
  const restore = (item: AgentMemoryItem) => {
    const decideApprove = () => api.decideAgentMemory(item.id, 'approve', scopeArg);
    const run = async () => {
      if (item.validUntil != null) {
        const res = await api.revalidateAgentMemory(item.id, scopeArg);
        if (res.data.status === 'rejected') await decideApprove();
      } else {
        await decideApprove();
      }
    };
    void run()
      .then(reload)
      .catch((e) => Alert.alert('失败', apiErrorText(e).message));
  };

  const promote = (id: number) => {
    void api
      .promoteAgentMemory(id)
      .then(reload)
      .catch((e) => Alert.alert('失败', apiErrorText(e).message));
  };

  // K8:标伪/标争议/撤销(可逆;伪 ≠ 删,仍可被 agent 检索但带警示)
  const markTruth = (id: number, truthStatus: 'unverified' | 'disputed' | 'refuted') => {
    void api
      .markTruthAgentMemory(id, truthStatus, { scope: scopeArg })
      .then(reload)
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
      {/* U5:个人池/群池切换(有群才显示;群池条目任何群成员可审,后端校验成员资格) */}
      {groups.length > 0 ? (
        <View style={styles.filters}>
          <Pressable
            style={[styles.chip, scope.scope === 'me' && styles.chipActive]}
            onPress={() => setScope({ scope: 'me' })}
          >
            <Text style={[styles.chipText, scope.scope === 'me' && styles.chipTextActive]}>
              我的
            </Text>
          </Pressable>
          {groups.map((g) => {
            const active = scope.scope === 'group' && scope.groupId === g.id;
            return (
              <Pressable
                key={g.id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setScope({ scope: 'group', groupId: g.id })}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                  {g.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
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
                {/* F1:时效轴失效标(与评审 status 正交;approved 也可能已失效) */}
                {it.validUntil != null ? (
                  <Text style={[styles.badge, styles.invalidBadge]}>已失效</Text>
                ) : null}
                {/* F5:只渲染已知真伪值(未知值当 unverified,不出空文字徽标) */}
                {TRUTH_LABEL[it.truthStatus] ? (
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
                    onPress={() => restore(it)}
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
                // F2:升格进核心后也要能纠错(否则错误结论永驻 always-on 注入)。
                // 「标记错误」reject 此条;核心层副本由 promote 的补偿链(unpromote)兜。
                <View style={styles.actions}>
                  <Text style={styles.promoted}>已升格到核心记忆</Text>
                  <Pressable
                    style={[styles.btn, styles.reject]}
                    onPress={() => decide(it.id, 'reject')}
                  >
                    <Text style={styles.btnText}>标记错误</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.actions}>
                  {/* finding 不升格(研究结论留情景层);可标真伪。
                      群池条目也不升格(原生核心是 per-user,升格仅个人池)。 */}
                  {it.kind === 'finding' ? (
                    <Pressable
                      style={[styles.btn, styles.truthBtn]}
                      onPress={() => askMarkTruth(it.id)}
                    >
                      <Text style={styles.btnText}>标记真伪</Text>
                    </Pressable>
                  ) : scope.scope === 'me' ? (
                    <Pressable
                      style={[styles.btn, styles.promoteBtn]}
                      onPress={() => promote(it.id)}
                    >
                      <Text style={styles.btnText}>升格到核心</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.groupNoPromoteHint}>群组记忆不升格(仅个人)</Text>
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
  findingBadge: { color: '#fff', backgroundColor: colors.info },
  disputedBadge: { color: '#fff', backgroundColor: colors.warning },
  refutedBadge: { color: '#fff', backgroundColor: colors.danger },
  invalidBadge: { color: '#fff', backgroundColor: colors.textMuted },
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
  groupNoPromoteHint: { fontSize: typography.small, color: colors.textTertiary, marginTop: 10 },
  btnText: { fontSize: typography.caption, color: '#fff' },
});
