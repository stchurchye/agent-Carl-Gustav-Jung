import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GroupListItem, GroupMember } from '@xzz/shared';
import type { TopicPreviewRow } from '../lib/studioTopicPreview';
import { formatChatListTime } from '../lib/formatChatListTime';
import { GroupDogsWire } from './GroupDogsWire';
import { StudioAvatar } from './StudioAvatar';
import { typography } from '../theme/colors';
import { wechat } from '../theme/wechat';
import { zh } from '../locales/zh-CN';

const MAX_TOPICS_SHOWN = 3;

type Props = {
  group: GroupListItem;
  topics: TopicPreviewRow[];
  /** 组员(含 pixelAvatar):有则入口顶部展示「狗狗电话连线」;还没加载到则退回字母头像 */
  members?: GroupMember[];
  isLast?: boolean;
  onOpenTopics: () => void;
  onOpenTopic: (topic: TopicPreviewRow) => void;
};

/** 入口头部:组里的狗排排站 + 像素电话线;下面群名+时间+副行 */
function GroupHeader({
  group,
  members,
  time,
  subLine,
  onPress,
  accessibilityLabel,
}: {
  group: GroupListItem;
  members?: GroupMember[];
  time?: string;
  subLine: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      style={styles.header}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {members && members.length > 0 ? (
        <GroupDogsWire members={members} />
      ) : (
        <StudioAvatar name={group.name} seed={group.id} size={40} />
      )}
      <View style={styles.headerTop}>
        <Text style={styles.groupTitle} numberOfLines={1}>
          {group.name}
        </Text>
        {time ? <Text style={styles.time}>{formatChatListTime(time)}</Text> : null}
      </View>
      <Text style={styles.subLine} numberOfLines={1}>
        {subLine}
      </Text>
    </Pressable>
  );
}

/** Bow Wow Group 一级列表:单话题直接进话题,多话题展示最近最多 3 条 */
export function StudioGroupListBlock({
  group,
  topics,
  members,
  isLast,
  onOpenTopics,
  onOpenTopic,
}: Props) {
  if (topics.length <= 1) {
    const only = topics[0];
    return (
      <View style={[styles.block, isLast && styles.blockLast]}>
        <GroupHeader
          group={group}
          members={members}
          time={only?.time ?? group.lastMessage?.createdAt}
          subLine={only?.preview ?? group.lastMessage?.preview ?? zh.studio.noMessagesYet}
          onPress={() => {
            if (only) onOpenTopic(only);
            else onOpenTopics();
          }}
          accessibilityLabel={group.name}
        />
      </View>
    );
  }

  const shown = topics.slice(0, MAX_TOPICS_SHOWN);
  const moreCount = topics.length - shown.length;
  const latestTime = topics[0]?.time;

  return (
    <View style={[styles.block, isLast && styles.blockLast]}>
      <GroupHeader
        group={group}
        members={members}
        time={latestTime}
        subLine={zh.studio.topicCount(topics.length)}
        onPress={onOpenTopics}
        accessibilityLabel={`${group.name}，${zh.studio.topicCount(topics.length)}`}
      />

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
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 6,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
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
  subLine: {
    fontSize: wechat.listSubtitleSize,
    color: wechat.textSecondary,
    lineHeight: typography.listSubtitleLineHeight,
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
    width: 28,
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
