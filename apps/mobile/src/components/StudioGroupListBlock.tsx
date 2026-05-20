import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GroupListItem } from '@xzz/shared';
import type { TopicPreviewRow } from '../lib/studioTopicPreview';
import { formatChatListTime } from '../lib/formatChatListTime';
import { StudioAvatar } from './StudioAvatar';
import { StudioChatListRow } from './StudioChatListRow';
import { typography } from '../theme/colors';
import { wechat } from '../theme/wechat';
import { zh } from '../locales/zh-CN';

const MAX_TOPICS_SHOWN = 3;

type Props = {
  group: GroupListItem;
  topics: TopicPreviewRow[];
  isLast?: boolean;
  onOpenTopics: () => void;
  onOpenTopic: (topic: TopicPreviewRow) => void;
};

/** 工作室一级列表：单话题简行，多话题展示最近最多 3 条 */
export function StudioGroupListBlock({
  group,
  topics,
  isLast,
  onOpenTopics,
  onOpenTopic,
}: Props) {
  if (topics.length <= 1) {
    const only = topics[0];
    return (
      <StudioChatListRow
        title={group.name}
        preview={
          only?.preview ??
          group.lastMessage?.preview ??
          zh.studio.noMessagesYet
        }
        time={only?.time ?? group.lastMessage?.createdAt}
        avatarName={group.name}
        avatarSeed={group.id}
        onPress={() => {
          if (only) onOpenTopic(only);
          else onOpenTopics();
        }}
      />
    );
  }

  const shown = topics.slice(0, MAX_TOPICS_SHOWN);
  const moreCount = topics.length - shown.length;
  const latestTime = topics[0]?.time;

  return (
    <View style={[styles.block, isLast && styles.blockLast]}>
      <Pressable
        style={styles.header}
        onPress={onOpenTopics}
        accessibilityRole="button"
        accessibilityLabel={`${group.name}，${zh.studio.topicCount(topics.length)}`}
      >
        <StudioAvatar name={group.name} seed={group.id} size={52} />
        <View style={styles.headerBody}>
          <View style={styles.headerTop}>
            <Text style={styles.groupTitle} numberOfLines={1}>
              {group.name}
            </Text>
            {latestTime ? (
              <Text style={styles.time}>{formatChatListTime(latestTime)}</Text>
            ) : null}
          </View>
          <Text style={styles.topicCount} numberOfLines={1}>
            {zh.studio.topicCount(topics.length)}
          </Text>
        </View>
      </Pressable>

      {shown.map((topic) => (
        <Pressable
          key={topic.topicId}
          style={styles.topicRow}
          onPress={() => onOpenTopic(topic)}
          accessibilityRole="button"
          accessibilityLabel={topic.topicTitle}
        >
          <View style={styles.topicIndent} />
          <View style={styles.topicBody}>
            <View style={styles.topicTop}>
              <Text style={styles.topicTitle} numberOfLines={1}>
                {topic.topicTitle}
              </Text>
              {topic.time ? (
                <Text style={styles.topicTime}>{formatChatListTime(topic.time)}</Text>
              ) : null}
            </View>
            <Text style={styles.topicPreview} numberOfLines={1}>
              {topic.preview}
            </Text>
          </View>
        </Pressable>
      ))}

      {moreCount > 0 ? (
        <Pressable style={styles.moreRow} onPress={onOpenTopics} accessibilityRole="button">
          <View style={styles.topicIndent} />
          <Text style={styles.moreText}>{zh.studio.moreTopicsCount(moreCount)}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: wechat.cellBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: wechat.separator,
  },
  blockLast: {
    borderBottomWidth: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerBody: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  groupTitle: {
    flex: 1,
    fontSize: wechat.listTitleSize,
    fontWeight: '500',
    color: wechat.textPrimary,
    marginRight: 8,
  },
  time: {
    fontSize: wechat.listTimeSize,
    color: wechat.textTertiary,
    flexShrink: 0,
  },
  topicCount: {
    fontSize: wechat.listSubtitleSize,
    color: wechat.textSecondary,
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 16,
    paddingVertical: 9,
    backgroundColor: wechat.cellBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: wechat.separator,
  },
  topicIndent: {
    width: 16 + 52 + 12,
  },
  topicBody: {
    flex: 1,
    minWidth: 0,
    paddingRight: 4,
  },
  topicTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  topicTitle: {
    flex: 1,
    fontSize: typography.body,
    fontWeight: '500',
    color: wechat.textPrimary,
    marginRight: 8,
  },
  topicTime: {
    fontSize: wechat.listTimeSize,
    color: wechat.textTertiary,
    flexShrink: 0,
  },
  topicPreview: {
    fontSize: wechat.listSubtitleSize,
    color: wechat.textSecondary,
    lineHeight: typography.listSubtitleLineHeight,
  },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingRight: 16,
    backgroundColor: wechat.cellBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: wechat.separator,
  },
  moreText: {
    flex: 1,
    fontSize: typography.small,
    color: '#576B95',
  },
});
