import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { presetDogForSeed, type GroupListItem, type GroupMember } from '@xzz/shared';
import type { GroupStackParamList } from '../navigation/types';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/apiError';
import { appAlert } from '../lib/appAlert';
import { loadWorkbenchSessionRows, type WorkbenchSessionRow } from '../lib/privateChatPreview';
import { loadGroupTopicPreviews, type TopicPreviewRow } from '../lib/studioTopicPreview';
import { getCachedTabs } from '../lib/writingCache';
import { WRITING_ENABLED } from '../lib/featureFlags';
import { openWriting } from '../lib/openWriting';
import { BowWowSessionRow } from '../components/BowWowSessionRow';
import { StudioChatListRow } from '../components/StudioChatListRow';
import { StudioGroupListBlock } from '../components/StudioGroupListBlock';
import { StudioSearchBar } from '../components/StudioSearchBar';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { colors, typography } from '../theme/colors';
import { wechat } from '../theme/wechat';
import { wechatChatStyles } from '../theme/wechatChat';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { useAuth } from '../components/AuthGate';
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
  // 「我的 Bow Wow」分区永远是我和我的狗:行头像直接用自己的像素狗(没领养按 seed 兜底)
  const myDog = user?.pixelAvatar?.dog ?? presetDogForSeed(user?.id ?? 'bowwow').dog;
  // 成员只用于入口的「狗狗电话连线」(纯装饰),每组每个屏生命周期内最多拉一次,
  // 避免每次聚焦都对所有组发 listGroupMembers(话题预览本来就会按组重拉,不再叠加 N 个请求)。
  const membersByGroupRef = useRef<Map<string, GroupMember[]>>(new Map());

  const refresh = useCallback(async () => {
    setLoading(true);
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
      appAlert(zh.studio.loadFailed, apiErrorText(e).message);
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
      accessibilityLabel={zh.studio.manageTitle}
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
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {groupRows.length > 0 ? (
            <WeChatGroupedSection title={zh.studio.groupsSection}>
              {groupRows.map(({ group, topics, members }, idx) => (
                <StudioGroupListBlock
                  key={group.id}
                  group={group}
                  topics={topics}
                  members={members}
                  isLast={idx === groupRows.length - 1}
                  onOpenTopics={() => openGroupTopics(group.id, group.name)}
                  onOpenTopic={(topic) => openGroupChat(group.id, group.name, topic)}
                />
              ))}
            </WeChatGroupedSection>
          ) : (
            <Text style={styles.empty}>{zh.studio.emptyList}</Text>
          )}

          <WeChatGroupedSection title={zh.studio.workbenchSection}>
          {WRITING_ENABLED ? (
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
          ) : null}
          {workbenchSessions.map((session) => (
            <BowWowSessionRow
              key={session.id}
              title={session.title}
              preview={session.preview}
              time={session.time}
              dog={myDog}
              onPress={() => openPrivateChat(session.id)}
            />
          ))}
          {workbenchSessions.length === 0 ? (
            <BowWowSessionRow
              title={zh.chat.newSession}
              preview={zh.studio.workbenchPreviewEmpty}
              dog={myDog}
              isNew
              onPress={() => openPrivateChat()}
            />
          ) : null}
          </WeChatGroupedSection>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: 48 },
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
});
