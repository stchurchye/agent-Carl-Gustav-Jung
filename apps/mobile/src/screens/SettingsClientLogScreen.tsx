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
import * as Clipboard from 'expo-clipboard';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import {
  clearClientLogs,
  ensureClientLogsLoaded,
  getClientLogEntries,
} from '../lib/clientLog';
import type { GroupStackParamList } from '../navigation/types';
import { colors } from '../theme/colors';
import { wechat } from '../theme/wechat';
import { wechatChatStyles } from '../theme/wechatChat';
import { wechatListStyles } from '../theme/wechatList';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'SettingsClientLogs'>;

function formatTime(iso: string): string {
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

export function SettingsClientLogScreen(_props: Props) {
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<ReturnType<typeof getClientLogEntries>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await ensureClientLogsLoaded();
      setEntries([...getClientLogEntries(500)].reverse());
    } finally {
      // 防 hydrate 抛错时永久卡 loading。
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const copyAll = async () => {
    await Clipboard.setStringAsync(JSON.stringify(entries, null, 2));
  };

  const handleClear = async () => {
    await clearClientLogs();
    await load();
  };

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.me.clientLogTitle} showBack />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom, 16) + 12 },
        ]}
      >
        <View style={styles.actions}>
          <Pressable onPress={() => void copyAll()} style={styles.actionBtn}>
            <Text style={styles.actionText}>{zh.me.clientLogCopyAll}</Text>
          </Pressable>
          <Pressable onPress={() => void handleClear()} style={styles.actionBtnMuted}>
            <Text style={styles.actionTextMuted}>{zh.me.clientLogClear}</Text>
          </Pressable>
        </View>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : entries.length === 0 ? (
          <Text style={styles.empty}>{zh.me.clientLogEmpty}</Text>
        ) : (
          <WeChatGroupedSection footer={zh.me.clientLogFooter}>
            {entries.map((item, i) => (
              <View key={`${item.ts}-${item.event}-${i}`}>
                <View style={styles.row}>
                  <Text style={styles.event}>{item.event}</Text>
                  <Text style={styles.time}>{formatTime(item.ts)}</Text>
                  {item.meta && Object.keys(item.meta).length > 0 ? (
                    <Text style={styles.meta} selectable>
                      {JSON.stringify(item.meta)}
                    </Text>
                  ) : null}
                </View>
                {i < entries.length - 1 ? <View style={wechatListStyles.separator} /> : null}
              </View>
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
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: colors.primarySoft,
  },
  actionText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  actionBtnMuted: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#eee',
  },
  actionTextMuted: {
    fontSize: 14,
    color: wechat.textSecondary,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: wechat.cellBg,
  },
  event: {
    fontSize: 15,
    color: wechat.textPrimary,
    fontWeight: '500',
  },
  time: {
    marginTop: 4,
    fontSize: 12,
    color: wechat.textSecondary,
  },
  meta: {
    marginTop: 6,
    fontSize: 12,
    color: wechat.textSecondary,
    fontFamily: 'Menlo',
    lineHeight: 16,
  },
});
