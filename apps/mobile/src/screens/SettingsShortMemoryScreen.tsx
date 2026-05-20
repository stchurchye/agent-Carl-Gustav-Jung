import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MemoryFragment } from '@xzz/shared';
import { MemoryFragmentList } from '../components/MemoryFragmentList';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { api } from '../lib/api';
import type { GroupStackParamList } from '../navigation/types';
import { colors, typography } from '../theme/colors';
import { wechatChatStyles } from '../theme/wechatChat';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'SettingsShortMemory'>;

export function SettingsShortMemoryScreen(_props: Props) {
  const insets = useSafeAreaInsets();
  const [sessionItems, setSessionItems] = useState<MemoryFragment[]>([]);
  const [topicItems, setTopicItems] = useState<MemoryFragment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionRes, topicRes] = await Promise.all([
        api.listMemories({ scope: 'session' }),
        api.listMemories({ scope: 'topic' }),
      ]);
      setSessionItems(sessionRes.data);
      setTopicItems(topicRes.data);
    } catch {
      setSessionItems([]);
      setTopicItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const emptyAll = !loading && sessionItems.length === 0 && topicItems.length === 0;

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.me.shortMemoryTitle} showBack />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom, 16) + 12 },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : emptyAll ? (
          <Text style={styles.emptyAll}>{zh.me.memoryEmpty}</Text>
        ) : (
          <>
            <Text style={styles.sectionTitle}>{zh.me.shortMemorySessionSection}</Text>
            <MemoryFragmentList
              items={sessionItems}
              scopeBadge={() => zh.me.shortMemorySessionBadge}
              onChanged={load}
            />

            <Text style={[styles.sectionTitle, styles.sectionTitleGap]}>
              {zh.me.shortMemoryTopicSection}
            </Text>
            <MemoryFragmentList
              items={topicItems}
              scopeBadge={() => zh.me.shortMemoryTopicBadge}
              onChanged={load}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: 12, paddingHorizontal: 0 },
  loader: { marginVertical: 32 },
  emptyAll: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 40,
    fontSize: typography.body,
  },
  sectionTitle: {
    fontSize: typography.caption,
    color: colors.textMuted,
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 4,
  },
  sectionTitleGap: {
    marginTop: 20,
  },
});
