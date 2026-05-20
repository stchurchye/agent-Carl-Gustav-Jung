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
import type { LlmRequestLogListItem } from '@xzz/shared';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { api } from '../lib/api';
import { zenmuxChatModelLabel } from '../lib/chatLlmModel';
import type { GroupStackParamList } from '../navigation/types';
import { colors } from '../theme/colors';
import { wechat } from '../theme/wechat';
import { wechatChatStyles } from '../theme/wechatChat';
import { wechatListStyles } from '../theme/wechatList';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'SettingsLlmLogs'>;

function formatLogTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function LlmLogRow({
  item,
  showSeparator,
  onPress,
}: {
  item: LlmRequestLogListItem;
  showSeparator: boolean;
  onPress: () => void;
}) {
  const statusColor = item.status === 'error' ? '#FA5151' : wechat.textSecondary;
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <View style={styles.row}>
        <View style={styles.rowMain}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.channelLabel}
            </Text>
            <Text style={[styles.rowStatus, { color: statusColor }]}>
              {item.status === 'error' ? zh.me.llmLogFailed : zenmuxChatModelLabel(item.model)}
            </Text>
          </View>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {formatLogTime(item.createdAt)} · {item.metaLine}
          </Text>
          <Text style={styles.rowPreview} numberOfLines={2}>
            {item.listPreview}
          </Text>
        </View>
        <Text style={wechatListStyles.cellChevron}>›</Text>
      </View>
      {showSeparator ? <View style={wechatListStyles.separator} /> : null}
    </Pressable>
  );
}

export function SettingsLlmLogListScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<LlmRequestLogListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listLlmLogs(80);
      setItems(res.data);
    } catch {
      setItems([]);
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
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.me.llmLogTitle} showBack />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom, 16) + 12 },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : items.length === 0 ? (
          <Text style={styles.empty}>{zh.me.llmLogEmpty}</Text>
        ) : (
          <WeChatGroupedSection footer={zh.me.llmLogFooter}>
            {items.map((item, i) => (
              <LlmLogRow
                key={item.id}
                item={item}
                showSeparator={i < items.length - 1}
                onPress={() => navigation.navigate('SettingsLlmLogDetail', { id: item.id })}
              />
            ))}
          </WeChatGroupedSection>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: 12 },
  loader: { marginVertical: 32 },
  empty: {
    textAlign: 'center',
    color: wechat.textSecondary,
    fontSize: 14,
    marginTop: 48,
    paddingHorizontal: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: wechat.cellBg,
    minHeight: 72,
  },
  rowMain: { flex: 1, marginRight: 8 },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    fontSize: wechat.listTitleSize,
    color: wechat.textPrimary,
    fontWeight: '500',
  },
  rowStatus: {
    fontSize: 12,
    color: wechat.textSecondary,
    maxWidth: '42%',
  },
  rowMeta: {
    marginTop: 4,
    fontSize: 12,
    color: wechat.textSecondary,
  },
  rowPreview: {
    marginTop: 6,
    fontSize: 13,
    color: wechat.textSecondary,
    lineHeight: 18,
  },
});
