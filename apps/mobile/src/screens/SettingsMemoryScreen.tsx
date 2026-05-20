import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MemoryCategory, MemoryFragment, MemoryScope } from '@xzz/shared';
import { MemoryFragmentList } from '../components/MemoryFragmentList';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { api } from '../lib/api';
import type { GroupStackParamList } from '../navigation/types';
import { colors, typography } from '../theme/colors';
import { wechatChatStyles } from '../theme/wechatChat';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'SettingsMemory'>;

type CategoryFilter = 'all' | MemoryCategory;

const USER_FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'user_profile', label: zh.me.memoryCategoryProfile },
  { id: 'project_note', label: zh.me.memoryCategoryProject },
  { id: 'general', label: zh.me.memoryCategoryGeneral },
];

export function SettingsMemoryScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const scope = (route.params?.scope ?? 'user') as MemoryScope;
  const groupId = route.params?.groupId;
  const topicId = route.params?.topicId;
  const sessionId = route.params?.sessionId;
  const title =
    scope === 'user'
      ? zh.me.longMemoryTitle
      : scope === 'topic'
        ? zh.me.topicMemoryTitle
        : zh.me.sessionMemoryTitle;

  const [items, setItems] = useState<MemoryFragment[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listMemories({
        scope: scope as 'user' | 'topic' | 'session',
        groupId,
        topicId,
        sessionId,
        category: categoryFilter === 'all' ? undefined : categoryFilter,
      });
      setItems(res.data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [scope, groupId, topicId, sessionId, categoryFilter]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={title} showBack />
      {scope === 'user' ? (
        <View style={styles.filters}>
          {USER_FILTERS.map((f) => (
            <Pressable
              key={f.id}
              style={[styles.chip, categoryFilter === f.id && styles.chipActive]}
              onPress={() => setCategoryFilter(f.id)}
            >
              <Text
                style={[
                  styles.chipText,
                  categoryFilter === f.id && styles.chipTextActive,
                ]}
              >
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {scope === 'user' || sessionId ? (
        <Pressable
          style={styles.linkRow}
          onPress={() =>
            navigation.navigate('SettingsMemorySearch', {
              sessionId: sessionId ?? undefined,
            })
          }
        >
          <Text style={styles.linkText}>{zh.me.memorySearchPlaceholder}</Text>
        </Pressable>
      ) : null}
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom, 16) + 12 },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : (
          <MemoryFragmentList items={items} onChanged={load} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: 8 },
  loader: { marginVertical: 32 },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  chipText: { fontSize: typography.caption, color: colors.textMuted },
  chipTextActive: { color: colors.primary, fontWeight: '600' },
  linkRow: { paddingHorizontal: 16, paddingVertical: 8 },
  linkText: { fontSize: typography.caption, color: colors.primary },
});
