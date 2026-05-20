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
import type { GroupStackParamList } from '../navigation/types';
import { api } from '../lib/api';
import { apiErrorText } from '../lib/apiError';
import { appAlert } from '../lib/appAlert';
import { appPromptText } from '../lib/appPrompt';
import { loadGroupTopicPreviews, type TopicPreviewRow } from '../lib/studioTopicPreview';
import { StudioChatListRow } from '../components/StudioChatListRow';
import { WeChatChatHeader } from '../components/WeChatChatHeader';
import { colors, typography } from '../theme/colors';
import { wechat } from '../theme/wechat';
import { wechatChatStyles } from '../theme/wechatChat';
import { WeChatGroupedSection } from '../components/wechat/WeChatGroupedSection';
import { zh } from '../locales/zh-CN';

type Props = NativeStackScreenProps<GroupStackParamList, 'GroupTopics'>;

export function GroupTopicsScreen({ navigation, route }: Props) {
  const { groupId, groupName } = route.params;
  const [rows, setRows] = useState<TopicPreviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await loadGroupTopicPreviews(groupId));
    } catch (e) {
      appAlert(zh.studio.loadFailed, apiErrorText(e).message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const renameTopic = useCallback(
    async (row: TopicPreviewRow) => {
      const title = await appPromptText(zh.studio.renameTopicTitle, '', row.topicTitle);
      if (title === null) return;
      const name = title.trim();
      if (!name) {
        appAlert(zh.studio.renameTopicTitle, zh.studio.renameTopicEmpty);
        return;
      }
      try {
        await api.updateTopic(groupId, row.topicId, name);
        await refresh();
      } catch (e) {
        appAlert(zh.studio.renameTopicFailed, apiErrorText(e).message);
      }
    },
    [groupId, refresh],
  );

  const addTopic = useCallback(async () => {
    if (creating) return;
    const title = await appPromptText(
      zh.studio.newTopicTitle,
      zh.studio.newTopicPrompt,
      zh.studio.newTopicDefaultName,
    );
    if (title === null) return;
    const name = title.trim() || zh.studio.newTopicDefaultName;
    setCreating(true);
    try {
      const created = await api.createTopic(groupId, name);
      navigation.navigate('GroupChat', {
        groupId,
        groupName,
        topicId: created.data.id,
        topicName: created.data.title,
      });
    } catch (e) {
      appAlert(zh.studio.newTopicFailed, apiErrorText(e).message);
    } finally {
      setCreating(false);
    }
  }, [creating, groupId, groupName, navigation]);

  const headerRight = (
    <Pressable
      onPress={() => void addTopic()}
      hitSlop={12}
      style={styles.headerBtn}
      disabled={creating}
      accessibilityRole="button"
      accessibilityLabel={zh.studio.newTopicAction}
    >
      <Text style={[styles.headerPlus, creating && styles.headerPlusDisabled]}>+</Text>
    </Pressable>
  );

  return (
    <View style={wechatChatStyles.page}>
      <WeChatChatHeader title={groupName} showBack right={headerRight} />
      {loading ? (
        <ActivityIndicator style={styles.loader} color={colors.primary} />
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {rows.length > 0 ? (
            <WeChatGroupedSection title={zh.studio.topicsSection}>
            {rows.map((row) => (
              <StudioChatListRow
                key={row.topicId}
                title={row.topicTitle}
                preview={row.preview}
                time={row.time}
                avatarName={row.topicTitle}
                avatarSeed={row.topicId}
                onPress={() =>
                  navigation.navigate('GroupChat', {
                    groupId,
                    groupName,
                    topicId: row.topicId,
                    topicName: row.topicTitle,
                  })
                }
                onLongPress={() => void renameTopic(row)}
              />
            ))}
            </WeChatGroupedSection>
          ) : (
            <View style={styles.emptyWrap}>
              <Text style={styles.empty}>{zh.studio.topicsEmpty}</Text>
              <Pressable style={styles.emptyBtn} onPress={() => void addTopic()} disabled={creating}>
                <Text style={styles.emptyBtnText}>{zh.studio.newTopicAction}</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: 48 },
  scrollContent: { flexGrow: 1, paddingBottom: 8 },
  sectionLabelWrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  sectionLabel: {
    fontSize: typography.small,
    color: colors.textMuted,
    fontWeight: '600',
  },
  headerBtn: {
    paddingRight: 4,
    paddingLeft: 8,
    justifyContent: 'center',
  },
  headerPlus: {
    fontSize: 30,
    fontWeight: '300',
    color: wechat.textPrimary,
    lineHeight: 32,
  },
  headerPlusDisabled: {
    opacity: 0.4,
  },
  emptyWrap: {
    paddingHorizontal: 32,
    paddingVertical: 32,
    alignItems: 'center',
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: typography.body,
    marginBottom: 16,
  },
  emptyBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  emptyBtnText: {
    color: colors.onPrimary,
    fontWeight: '600',
    fontSize: typography.body,
  },
});
