import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Document } from '@xzz/shared';
import { formatRevisionTime } from '@xzz/shared';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { WeChatListCell } from '../components/wechat/WeChatListCell';
import { appAlert } from '../lib/appAlert';
import {
  filterVisibleDocuments,
  isDocumentHidden,
} from '../lib/documentVisibility';
import { getCachedTabs, rememberTabs } from '../lib/writingCache';
import { openWriting } from '../lib/openWriting';
import { api } from '../lib/api';
import { colors } from '../theme/colors';
import { wechatChatStyles } from '../theme/wechatChat';
import { wechatListStyles } from '../theme/wechatList';
import { zh } from '../locales/zh-CN';

type SettingsDocumentsParams = { scope: 'visible' | 'hidden'; highlightId?: string };

type Props = {
  navigation: NavigationProp<ParamListBase>;
  route: { params: SettingsDocumentsParams };
};

export function SettingsDocumentsScreen({ navigation, route }: Props) {
  const { scope, highlightId } = route.params;
  const insets = useSafeAreaInsets();
  const isHidden = scope === 'hidden';
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlightActive, setHighlightActive] = useState<string | null>(highlightId ?? null);

  useEffect(() => {
    if (!highlightId) return;
    setHighlightActive(highlightId);
    const t = setTimeout(() => setHighlightActive(null), 1500);
    return () => clearTimeout(t);
  }, [highlightId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listDocuments();
      const list = isHidden
        ? res.data.filter((d) => isDocumentHidden(d))
        : filterVisibleDocuments(res.data);
      setDocs(list);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [isHidden]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const restoreDocument = async (id: string, title: string) => {
    try {
      await api.updateDocument(id, { hiddenAt: null });
      const tabs = getCachedTabs();
      if (!tabs.some((t) => t.id === id)) {
        rememberTabs([...tabs, { id, title }].slice(0, 6));
      }
      await load();
      appAlert('好了', zh.me.restoreDocDone);
    } catch (e) {
      appAlert(zh.me.restoreDocFailed, String(e));
    }
  };

  const title = isHidden ? zh.me.hiddenDocsTitle : zh.me.allDocs;

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={title} showBack />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom, 16) + 12 },
        ]}
      >
        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.primary} />
        ) : docs.length === 0 ? (
          <View style={wechatListStyles.footer}>
            <Text style={wechatListStyles.footerText}>
              {isHidden ? '暂无已隐藏的文章' : '暂无文稿'}
            </Text>
          </View>
        ) : (
          <WeChatGroupedSection footer={isHidden ? zh.me.hiddenDocsHint : undefined}>
            {docs.map((d, idx) => {
              const time = formatRevisionTime(d.updatedAt);
              const value = isHidden
                ? time.full
                : `${time.full} · ${d.revisionCount} 个版本`;
              return (
                <View
                  key={d.id}
                  style={{
                    backgroundColor: highlightActive === d.id ? '#fff5b3' : 'transparent',
                    borderRadius: 8,
                  }}
                >
                  <WeChatListCell
                    label={d.title}
                    value={value}
                    showSeparator={idx < docs.length - 1}
                    onPress={() => {
                      if (isHidden) {
                        void restoreDocument(d.id, d.title);
                      } else {
                        void openWriting(navigation, { documentId: d.id });
                      }
                    }}
                  />
                </View>
              );
            })}
          </WeChatGroupedSection>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: 12 },
  loader: { marginTop: 48 },
});
