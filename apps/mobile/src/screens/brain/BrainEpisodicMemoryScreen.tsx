import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WeChatChatHeader } from '../../components/WeChatChatHeader';
import { api, type AgentMemoryItem } from '../../lib/api';
import { apiErrorText } from '../../lib/apiError';
import type { BrainStackParamList } from '../../navigation/types';
import { colors, typography } from '../../theme/colors';
import { wechatChatStyles } from '../../theme/wechatChat';

type Props = NativeStackScreenProps<BrainStackParamList, 'BrainEpisodicMemory'>;

type StatusFilter = 'pending' | 'approved';

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'pending', label: '待审' },
  { id: 'approved', label: '已批准' },
];

export function BrainEpisodicMemoryScreen(_props: Props) {
  const insets = useSafeAreaInsets();
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

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title="长期记忆审核" showBack />
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
            {filter === 'pending' ? '没有待审的记忆' : '还没有已批准的记忆'}
          </Text>
        ) : (
          items.map((it) => (
            <View key={it.id} style={styles.card}>
              <Text style={styles.text}>{it.text}</Text>
              <Text style={styles.meta}>
                {it.confidence != null ? `置信 ${it.confidence.toFixed(2)} · ` : ''}
                {it.createdAt ? it.createdAt.slice(0, 10) : ''}
              </Text>
              {filter === 'pending' ? (
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
              ) : null}
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
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  btn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 8 },
  approve: { backgroundColor: colors.primary },
  reject: { backgroundColor: '#d9534f' },
  btnText: { fontSize: typography.caption, color: '#fff' },
});
