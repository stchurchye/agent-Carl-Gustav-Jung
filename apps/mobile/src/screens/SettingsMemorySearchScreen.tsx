import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MemorySessionSearchHit } from '@xzz/shared';
import { AppTextInput } from '../components/AppTextInput';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/apiError';
import { appAlert } from '../lib/appAlert';
import type { GroupStackParamList } from '../navigation/types';
import { colors, typography } from '../theme/colors';
import { wechatChatStyles } from '../theme/wechatChat';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'SettingsMemorySearch'>;

export function SettingsMemorySearchScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const sessionId = route.params?.sessionId;
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<MemorySessionSearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const onSearch = () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    void api
      .searchSessionMessages({ q, sessionId })
      .then((res) => setHits(res.data))
      .catch((e) => appAlert('搜索失败', apiErrorText(e).message))
      .finally(() => setSearching(false));
  };

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.me.memorySearchTitle} showBack />
      <View style={styles.searchRow}>
        <AppTextInput
          style={styles.input}
          placeholder={zh.me.memorySearchPlaceholder}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={onSearch}
          returnKeyType="search"
        />
        <Pressable style={styles.searchBtn} onPress={onSearch} disabled={searching}>
          <Text style={styles.searchBtnText}>搜索</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom, 16) + 12 },
        ]}
      >
        {searching ? <ActivityIndicator color={colors.primary} /> : null}
        {hits.map((h) => (
          <View key={h.messageId} style={styles.hit}>
            <Text style={styles.hitMeta}>
              {h.channel === 'private' ? '工作台' : '群聊'} · {h.role}
            </Text>
            <Text style={styles.hitBody}>{h.contentPreview}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    backgroundColor: colors.surface,
  },
  input: { flex: 1 },
  searchBtn: {
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  searchBtnText: { color: colors.primary, fontWeight: '600' },
  scroll: { padding: 12, gap: 10 },
  hit: {
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 8,
  },
  hitMeta: { fontSize: typography.caption, color: colors.textMuted, marginBottom: 4 },
  hitBody: { fontSize: typography.body, color: colors.text },
});
