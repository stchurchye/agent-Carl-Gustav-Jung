import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import type { ChatSession, GroupListItem, Topic } from '@xzz/shared';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { WeChatListCell } from '../components/wechat/WeChatListCell';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/apiError';
import { appAlert } from '../lib/appAlert';
import { wechatChatStyles } from '../theme/wechatChat';
import { colors, typography } from '../theme/colors';
import { zh } from '../locales/zh-CN';

type ExportSource = 'workbench' | 'studio';

export function SettingsTopicExportScreen() {
  const insets = useSafeAreaInsets();
  const [source, setSource] = useState<ExportSource>('workbench');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [exporting, setExporting] = useState(false);

  const selectedSession = sessions.find((s) => s.id === sessionId);
  const selectedGroup = groups.find((g) => g.id === groupId);
  const selectedTopic = topics.find((t) => t.id === topicId);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await api.listChatSessions();
      setSessions(res.data);
      setSessionId((prev) => {
        if (prev && res.data.some((s) => s.id === prev)) return prev;
        return res.data[0]?.id ?? null;
      });
    } catch (e) {
      appAlert(zh.me.exportSessionsLoadFailed, apiErrorText(e).message);
      setSessions([]);
      setSessionId(null);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    setLoadingGroups(true);
    try {
      const res = await api.listGroups();
      setGroups(res.data);
      setGroupId((prev) => {
        if (prev && res.data.some((g) => g.id === prev)) return prev;
        return res.data[0]?.id ?? null;
      });
    } catch (e) {
      appAlert(zh.me.exportGroupsLoadFailed, apiErrorText(e).message);
      setGroups([]);
      setGroupId(null);
    } finally {
      setLoadingGroups(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadSessions();
      void loadGroups();
    }, [loadSessions, loadGroups]),
  );

  useEffect(() => {
    if (!groupId) {
      setTopics([]);
      setTopicId(null);
      return;
    }
    let cancelled = false;
    setLoadingTopics(true);
    void api
      .listTopics(groupId)
      .then((res) => {
        if (cancelled) return;
        const list = res.data;
        setTopics(list);
        setTopicId((prev) => {
          if (prev && list.some((t) => t.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      })
      .catch((e) => {
        if (cancelled) return;
        appAlert(zh.me.exportTopicsFailed, apiErrorText(e).message);
        setTopics([]);
        setTopicId(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingTopics(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const canExport =
    source === 'workbench'
      ? Boolean(sessionId)
      : Boolean(groupId && topicId && !loadingTopics);

  const summaryText =
    source === 'workbench'
      ? (selectedSession?.title ?? '—')
      : `${selectedGroup?.name ?? '—'} · ${selectedTopic?.title ?? '—'}`;

  async function handleExport() {
    if (!canExport || exporting) return;
    setExporting(true);
    try {
      const res =
        source === 'workbench'
          ? await api.exportChatSession(sessionId!)
          : await api.exportTopic(groupId!, topicId!);
      await Clipboard.setStringAsync(res.data.markdown);
      appAlert(zh.me.exportDoneTitle, zh.me.exportDoneBody(res.data.messageCount));
    } catch (e) {
      appAlert(zh.me.exportFailed, apiErrorText(e).message);
    } finally {
      setExporting(false);
    }
  }

  const loading = loadingSessions && loadingGroups;

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.me.exportTitle} showBack />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Math.max(insets.bottom, 16) + 12 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.primary} />
        ) : (
          <>
            <WeChatGroupedSection title={zh.me.exportWorkbench} footer={zh.me.exportHint}>
              {loadingSessions ? (
                <ActivityIndicator style={styles.sectionLoader} color={colors.primary} />
              ) : sessions.length === 0 ? (
                <View style={styles.inlineEmpty}>
                  <Text style={styles.empty}>{zh.me.exportNoSessions}</Text>
                </View>
              ) : (
                sessions.map((s, idx) => (
                  <WeChatListCell
                    key={s.id}
                    label={s.title}
                    value={
                      source === 'workbench' && sessionId === s.id
                        ? zh.me.selected
                        : undefined
                    }
                    onPress={() => {
                      setSource('workbench');
                      setSessionId(s.id);
                    }}
                    showSeparator={idx < sessions.length - 1}
                    showChevron={false}
                  />
                ))
              )}
            </WeChatGroupedSection>

            {loadingGroups ? (
              <ActivityIndicator style={styles.loader} color={colors.primary} />
            ) : groups.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.empty}>{zh.me.exportNoGroups}</Text>
              </View>
            ) : (
              <>
                <WeChatGroupedSection title={zh.me.exportPickGroup}>
                  {groups.map((g, idx) => (
                    <WeChatListCell
                      key={g.id}
                      label={g.name}
                      value={
                        source === 'studio' && groupId === g.id ? zh.me.selected : undefined
                      }
                      onPress={() => {
                        setSource('studio');
                        setGroupId(g.id);
                      }}
                      showSeparator={idx < groups.length - 1}
                      showChevron={false}
                    />
                  ))}
                </WeChatGroupedSection>

                {loadingTopics ? (
                  <ActivityIndicator style={styles.loader} color={colors.primary} />
                ) : topics.length === 0 ? (
                  <View style={styles.emptyWrap}>
                    <Text style={styles.empty}>{zh.me.exportNoTopics}</Text>
                  </View>
                ) : (
                  <WeChatGroupedSection title={zh.me.exportPickTopic}>
                    {topics.map((t, idx) => (
                      <WeChatListCell
                        key={t.id}
                        label={t.title}
                        value={
                          source === 'studio' && topicId === t.id ? zh.me.selected : undefined
                        }
                        onPress={() => {
                          setSource('studio');
                          setTopicId(t.id);
                        }}
                        showSeparator={idx < topics.length - 1}
                        showChevron={false}
                      />
                    ))}
                  </WeChatGroupedSection>
                )}
              </>
            )}

            <View style={styles.summary}>
              <Text style={styles.summaryText}>{summaryText}</Text>
            </View>

            <Pressable
              style={[styles.exportBtn, (!canExport || exporting) && styles.exportBtnDisabled]}
              onPress={() => void handleExport()}
              disabled={!canExport || exporting}
            >
              {exporting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.exportBtnText}>{zh.me.exportAction}</Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: 12 },
  loader: { marginVertical: 24 },
  sectionLoader: { marginVertical: 16 },
  emptyWrap: { paddingHorizontal: 16, paddingVertical: 24 },
  inlineEmpty: { paddingHorizontal: 16, paddingVertical: 20 },
  empty: {
    fontSize: typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  summary: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  summaryText: {
    fontSize: typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  exportBtn: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  exportBtnDisabled: { opacity: 0.5 },
  exportBtnText: {
    color: colors.onPrimary,
    fontWeight: '600',
    fontSize: typography.button,
  },
});
