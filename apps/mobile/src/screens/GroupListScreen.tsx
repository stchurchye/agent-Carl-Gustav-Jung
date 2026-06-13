import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { personaAssistantDisplayName, type GroupListItem, type GroupMember } from '@xzz/shared';
import type { GroupStackParamList } from '../navigation/types';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/apiError';
import { loadWorkbenchSessionRows, type WorkbenchSessionRow } from '../lib/privateChatPreview';
import { loadGroupTopicPreviews, type TopicPreviewRow } from '../lib/studioTopicPreview';
import { getCachedTabs } from '../lib/writingCache';
import { WRITING_ENABLED } from '../lib/featureFlags';
import { openWriting } from '../lib/openWriting';
import { BowWowWorkbenchCard } from '../components/BowWowWorkbenchCard';
import { AskAiModelPickerSheet } from '../components/AskAiModelPickerSheet';
import { StudioChatListRow } from '../components/StudioChatListRow';
import { StudioGroupListBlock } from '../components/StudioGroupListBlock';
import { StudioSearchBar } from '../components/StudioSearchBar';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { colors, typography } from '../theme/colors';
import { wechat } from '../theme/wechat';
import { wechatChatStyles } from '../theme/wechatChat';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { useAuth } from '../components/AuthGate';
import { usePersona } from '../hooks/usePersona';
import { ASSISTANT_FALLBACK_NAME } from '../lib/brand';
import { getChatLlmModel, setChatLlmModel } from '../lib/chatLlmModel';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'GroupList'>;

type GroupListUi = {
  group: GroupListItem;
  topics: TopicPreviewRow[];
  /** 组员(含各自的狗),入口展示「狗狗电话连线」用;拉取失败为空则退回字母头像 */
  members: GroupMember[];
};

export function GroupListScreen({ navigation }: Props) {
  const { user } = useAuth();
  const tabBarHeight = useBottomTabBarHeight();
  const adoptPromptedRef = useRef(false);
  const [groupRows, setGroupRows] = useState<GroupListUi[]>([]);

  // 首启领养:还没挑过狗就带去挑一只(服务端字段判断;每次冷启动最多引导一次,可跳过返回)
  useFocusEffect(
    useCallback(() => {
      if (!user || user.pixelAvatar || adoptPromptedRef.current) return;
      adoptPromptedRef.current = true;
      navigation.navigate('SettingsMyDog');
    }, [user, navigation]),
  );
  const [workbenchSessions, setWorkbenchSessions] = useState<WorkbenchSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const myAvatar = user?.pixelAvatar ?? null;
  // 工作台头部需要狗名(persona)+ 当前私聊模型;persona 走共享缓存 hook,模型 mount 时读一次
  const { persona, avatar: personaAvatar } = usePersona();
  const assistantName = personaAssistantDisplayName(persona ?? undefined, ASSISTANT_FALLBACK_NAME);
  const [chatModel, setChatModel] = useState<string>('moonshotai/kimi-k2.6');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  useEffect(() => {
    void getChatLlmModel().then(setChatModel);
  }, []);
  // 成员只用于入口的「狗狗电话连线」(纯装饰),每组每个屏生命周期内最多拉一次,
  // 避免每次聚焦都对所有组发 listGroupMembers(话题预览本来就会按组重拉,不再叠加 N 个请求)。
  const membersByGroupRef = useRef<Map<string, GroupMember[]>>(new Map());

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [groupsRes, sessions] = await Promise.all([
        api.listGroups(),
        loadWorkbenchSessionRows(zh.studio.workbenchPreviewEmpty).catch(() => []),
      ]);
      const topicsByGroup = await Promise.all(
        groupsRes.data.map(async (group) => {
          const topics = await loadGroupTopicPreviews(group.id).catch(
            () => [] as TopicPreviewRow[],
          );
          let members = membersByGroupRef.current.get(group.id);
          if (!members) {
            members = await api
              .listGroupMembers(group.id)
              .then((r) => r.data)
              .catch(() => [] as GroupMember[]);
            // 只缓存非空结果,失败(空)留待下次聚焦重试
            if (members.length) membersByGroupRef.current.set(group.id, members);
          }
          return { group, topics, members };
        }),
      );
      setGroupRows(topicsByGroup);
      setWorkbenchSessions(sessions);
    } catch (e) {
      setLoadError(apiErrorText(e).message);
      setGroupRows([]);
      setWorkbenchSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const openPrivateChat = useCallback(
    (sessionId?: string) => {
      navigation.navigate('PrivateChat', sessionId ? { sessionId } : undefined);
    },
    [navigation],
  );

  const openGroupTopics = useCallback(
    (groupId: string, groupName: string) => {
      navigation.navigate('GroupTopics', { groupId, groupName });
    },
    [navigation],
  );

  const openGroupChat = useCallback(
    (groupId: string, groupName: string, topic: TopicPreviewRow) => {
      navigation.navigate('GroupChat', {
        groupId,
        groupName,
        topicId: topic.topicId,
        topicName: topic.topicTitle,
      });
    },
    [navigation],
  );

  // 设置入口已移到 my bow wow 的「管理 Bow Wow」,主页左上角不再放设置图标
  const headerRight = (
    <Pressable
      onPress={() => navigation.navigate('StudioManage')}
      hitSlop={12}
      style={styles.headerBtn}
      accessibilityRole="button"
      accessibilityLabel={zh.studio.createTitle}
    >
      <Text style={styles.headerPlus}>+</Text>
    </Pressable>
  );

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={zh.tabs.groups} right={headerRight} />
      <StudioSearchBar onPress={() => navigation.navigate('StudioSearch')} />
      {/* W2 防闪:已有内容时聚焦重拉静默刷新,只有首载(无数据)才占屏 spinner */}
      {loading && groupRows.length === 0 && workbenchSessions.length === 0 ? (
        <ActivityIndicator style={styles.loader} color={colors.primary} />
      ) : !loading && loadError ? (
        <View style={styles.errorState}>
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable onPress={() => void refresh()} style={styles.retryBtn}>
            <Text style={styles.retryText}>{zh.studio.retryConnect}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + 8 }]}>
          {groupRows.length > 0 ? (
            <WeChatGroupedSection title={zh.studio.groupsSection}>
              {groupRows.map(({ group, topics, members }, idx) => (
                <StudioGroupListBlock
                  key={group.id}
                  group={group}
                  topics={topics}
                  members={members.map((m) =>
                    m.userId === user?.id
                      ? { ...m, pixelAvatar: user?.pixelAvatar ?? m.pixelAvatar }
                      : m,
                  )}
                  isLast={idx === groupRows.length - 1}
                  onOpenTopics={() => openGroupTopics(group.id, group.name)}
                  onOpenTopic={(topic) => openGroupChat(group.id, group.name, topic)}
                />
              ))}
            </WeChatGroupedSection>
          ) : (
            <Text style={styles.empty}>{zh.studio.emptyList}</Text>
          )}

          {WRITING_ENABLED ? (
            <WeChatGroupedSection title={zh.studio.workbenchSection}>
              <StudioChatListRow
                title={zh.studio.writeText}
                preview={
                  getCachedTabs()[0]?.title
                    ? zh.studio.continueDocument(getCachedTabs()[0].title)
                    : zh.studio.writeTextPreview
                }
                avatarName={zh.studio.writeText}
                avatarSeed="writing"
                onPress={() => {
                  const recentId = getCachedTabs()[0]?.id;
                  void openWriting(navigation, recentId ? { documentId: recentId } : undefined);
                }}
              />
            </WeChatGroupedSection>
          ) : null}

          {/* 「我的 Bow Wow」分支式卡片:单头部(狗+名字+模型+对话数+新建)+ 紧凑话题分支 */}
          <BowWowWorkbenchCard
            assistantName={assistantName}
            avatar={personaAvatar ?? myAvatar}
            seed={user?.id}
            modelId={chatModel}
            topics={workbenchSessions}
            onPressTopic={openPrivateChat}
            onNewChat={() => openPrivateChat()}
            onPressModel={() => setModelPickerOpen(true)}
          />

          {/* 今日日记入口:进个人日记屏(Bow Wow 总结今天 → 聊着矫正 → 收进记忆) */}
          <Pressable
            testID="home-diary-card"
            onPress={() => navigation.navigate('Diary', { scope: 'self', scopeId: '' })}
            style={({ pressed }) => [styles.diaryCard, pressed && styles.diaryCardPressed]}
            accessibilityRole="button"
          >
            <View style={styles.diaryCardBody}>
              <Text style={styles.diaryCardTitle}>{zh.diary.cardTitle}</Text>
              <Text style={styles.diaryCardHint}>{zh.diary.cardEmptyHint}</Text>
            </View>
            <Text style={styles.diaryCardChevron}>›</Text>
          </Pressable>
        </ScrollView>
      )}
      <AskAiModelPickerSheet
        visible={modelPickerOpen}
        modelId={chatModel}
        onClose={() => setModelPickerOpen(false)}
        onSelectModel={(id) => {
          setChatModel(id);
          void setChatLlmModel(id);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: 48 },
  errorState: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 20,
    paddingHorizontal: 32,
  },
  errorText: {
    fontSize: typography.body,
    color: colors.textMuted,
    textAlign: 'center' as const,
    lineHeight: Math.round(typography.body * 1.5),
  },
  retryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 28,
    backgroundColor: colors.primary,
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontSize: typography.body,
    fontWeight: '600' as const,
  },
  scrollContent: { flexGrow: 1, paddingBottom: 8 },
  headerBtn: {
    paddingRight: 4,
    paddingLeft: 8,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  headerPlus: {
    fontSize: 30,
    fontWeight: '300',
    color: wechat.textPrimary,
    lineHeight: 32,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: typography.body,
    paddingHorizontal: 32,
    paddingVertical: 24,
  },
  diaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: wechat.cellBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: wechat.separator,
    borderRadius: 12,
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  diaryCardPressed: { opacity: 0.6 },
  diaryCardBody: { flex: 1 },
  diaryCardTitle: { fontSize: 16, fontWeight: '500', color: wechat.textPrimary },
  diaryCardHint: { fontSize: 12, color: wechat.textTertiary, marginTop: 2 },
  diaryCardChevron: { fontSize: 22, color: wechat.textTertiary, marginLeft: 8 },
});
