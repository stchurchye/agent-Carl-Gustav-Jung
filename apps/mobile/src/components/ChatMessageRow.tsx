import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { LlmInvokeMeta, LlmReplyMeta } from '@xzz/shared';
import { chatIcons } from '../assets/chatIcons';
import { ChatAvatar } from './ChatAvatar';
import { ChatMessageMetaFootnote } from './ChatLlmInvokeFootnote';
import type { MessageBubbleAnchor } from './chat/MessageBubbleAnchor';
import { MessageBubblePressable } from './MessageBubblePressable';
import { colors } from '../theme/colors';
import { wechatChat, wechatChatStyles } from '../theme/wechatChat';

type Props = {
  isSelf: boolean;
  avatarName: string;
  avatarSeed: string;
  avatarImageUri?: string | null;
  showTimestamp?: boolean;
  timeLabel?: string;
  /** 群聊对方昵称，显示在气泡上方 */
  senderName?: string;
  layout?: 'bubble' | 'system';
  /** 不显示头像，全宽布局（写作小助手等） */
  hideAvatar?: boolean;
  /** 保留头像占位，气泡宽度与普通人消息一致（AI 回复） */
  avatarSpacer?: boolean;
  /** 用户问 AI 用量 */
  llmInvoke?: LlmInvokeMeta | null;
  /** AI 回复用量（展示在气泡下方小字） */
  llmReply?: LlmReplyMeta | null;
  /** 生成中等：仅模型名 */
  metaModelLabel?: string;
  /** 已标记不进 AI 上下文 */
  contextExcluded?: boolean;
  /** 长按整颗气泡（含内边距），弹出复制/标记菜单 */
  onBubbleLongPress?: (anchor: MessageBubbleAnchor) => void;
  /** 群聊问 AI：右上角 Ai 角标缩小一半 */
  compactAskAiBadge?: boolean;
  children: ReactNode;
};

export function ChatMessageRow({
  isSelf,
  avatarName,
  avatarSeed,
  avatarImageUri,
  showTimestamp,
  timeLabel,
  senderName,
  layout = 'bubble',
  hideAvatar,
  avatarSpacer,
  llmInvoke,
  llmReply,
  metaModelLabel,
  contextExcluded = false,
  onBubbleLongPress,
  compactAskAiBadge = false,
  children,
}: Props) {
  const showAskAi = Boolean(isSelf && llmInvoke);
  /** 用户自己发的消息不展示模型 / token 脚注；助手侧照常 */
  const showMetaFootnote = Boolean(
    contextExcluded || (!isSelf && (llmInvoke || llmReply || metaModelLabel)),
  );

  const bubbleWithBadge = (bubbleStyle: object[]) => {
    const mergedStyle = bubbleStyle;
    const bubble =
      onBubbleLongPress != null ? (
        <MessageBubblePressable
          style={mergedStyle}
          alignEnd={isSelf}
          onLongPress={onBubbleLongPress}
        >
          {children}
        </MessageBubblePressable>
      ) : (
        <View style={mergedStyle}>{children}</View>
      );

    return (
      <View style={styles.bubbleWrap}>
        {showAskAi ? (
          <View style={[styles.askAiCorner, compactAskAiBadge && styles.askAiCornerCompact]}>
            <Image
              source={chatIcons.askAiBadge}
              style={[styles.askAiCornerIcon, compactAskAiBadge && styles.askAiCornerIconCompact]}
              resizeMode="contain"
            />
          </View>
        ) : null}
        {bubble}
        {showMetaFootnote ? (
          <ChatMessageMetaFootnote
            align={isSelf ? 'right' : 'left'}
            contextExcluded={contextExcluded}
            invoke={!isSelf ? llmInvoke : null}
            reply={llmReply}
            modelLabel={metaModelLabel}
          />
        ) : null}
      </View>
    );
  };
  if (layout === 'system') {
    return (
      <View>
        {showTimestamp && timeLabel ? (
          <View style={wechatChatStyles.timestampWrap}>
            <Text style={wechatChatStyles.timestamp}>{timeLabel}</Text>
          </View>
        ) : null}
        <View style={wechatChatStyles.systemWrap}>
          <View style={wechatChatStyles.systemBubble}>{children}</View>
        </View>
      </View>
    );
  }

  if (avatarSpacer) {
    return (
      <View>
        {showTimestamp && timeLabel ? (
          <View style={wechatChatStyles.timestampWrap}>
            <Text style={wechatChatStyles.timestamp}>{timeLabel}</Text>
          </View>
        ) : null}
        <View style={[styles.aiRow, isSelf && styles.aiRowSelf]}>
          <View style={[styles.aiBody, isSelf ? styles.aiBodySelf : styles.aiBodyOther]}>
            {!isSelf && senderName ? (
              <Text style={styles.aiMetaLine} numberOfLines={2}>
                {senderName}
              </Text>
            ) : null}
            {bubbleWithBadge([
              wechatChatStyles.bubble,
              styles.aiBubble,
              isSelf ? wechatChatStyles.bubbleSelf : wechatChatStyles.bubbleOther,
            ])}
          </View>
        </View>
      </View>
    );
  }

  if (hideAvatar) {
    return (
      <View>
        {showTimestamp && timeLabel ? (
          <View style={wechatChatStyles.timestampWrap}>
            <Text style={wechatChatStyles.timestamp}>{timeLabel}</Text>
          </View>
        ) : null}
        <View style={[styles.fullRow, isSelf && styles.fullRowSelf]}>
          <View style={[styles.fullBody, isSelf ? styles.fullBodySelf : styles.fullBodyOther]}>
            {senderName ? (
              <Text style={styles.aiMetaLine} numberOfLines={2}>
                {senderName}
              </Text>
            ) : null}
            {bubbleWithBadge([
              styles.fullBubble,
              isSelf ? styles.fullBubbleSelf : styles.fullBubbleOther,
              isSelf ? wechatChatStyles.bubbleSelf : wechatChatStyles.bubbleOther,
            ])}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View>
      {showTimestamp && timeLabel ? (
        <View style={wechatChatStyles.timestampWrap}>
          <Text style={wechatChatStyles.timestamp}>{timeLabel}</Text>
        </View>
      ) : null}
      <View style={[wechatChatStyles.row, isSelf && wechatChatStyles.rowSelf]}>
        <View style={wechatChatStyles.avatarSlot}>
          <ChatAvatar
            name={avatarName}
            seed={avatarSeed}
            imageUri={avatarImageUri}
          />
        </View>
        <View style={[wechatChatStyles.body, isSelf ? wechatChatStyles.bodySelf : wechatChatStyles.bodyOther]}>
          {!isSelf && senderName ? (
            <Text style={wechatChatStyles.senderName} numberOfLines={1}>
              {senderName}
            </Text>
          ) : null}
          {bubbleWithBadge([
            wechatChatStyles.bubble,
            isSelf ? wechatChatStyles.bubbleSelf : wechatChatStyles.bubbleOther,
          ])}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubbleWrap: {
    position: 'relative',
    maxWidth: '100%',
    flexGrow: 0,
    flexShrink: 1,
  },
  askAiCorner: {
    position: 'absolute',
    top: -6,
    right: -4,
    zIndex: 2,
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  askAiCornerIcon: {
    width: 18,
    height: 18,
  },
  askAiCornerCompact: {
    top: -3,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: 1,
  },
  askAiCornerIconCompact: {
    width: 9,
    height: 9,
  },
  fullRow: {
    width: '100%',
    marginBottom: 10,
  },
  fullRowSelf: {
    alignItems: 'flex-end',
  },
  fullBody: {
    maxWidth: '100%',
  },
  fullBodySelf: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  fullBodyOther: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  aiMetaLine: {
    fontSize: 11,
    color: wechatChat.senderName,
    marginBottom: 4,
    marginLeft: 2,
    lineHeight: 15,
  },
  aiRow: {
    width: '100%',
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  aiRowSelf: {
    justifyContent: 'flex-end',
  },
  aiBody: {
    width: wechatChat.aiBubbleMaxWidth,
    maxWidth: wechatChat.aiBubbleMaxWidth,
    flexGrow: 0,
    flexShrink: 1,
  },
  aiBodyOther: {
    alignItems: 'flex-start',
  },
  aiBodySelf: {
    alignItems: 'flex-end',
  },
  aiBubble: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexGrow: 0,
    flexShrink: 1,
  },
  fullBubble: {
    borderRadius: wechatChat.bubbleRadius,
    paddingHorizontal: wechatChat.bubblePadH,
    paddingVertical: wechatChat.bubblePadV,
    maxWidth: '100%',
    flexGrow: 0,
    flexShrink: 1,
  },
  fullBubbleOther: {
    maxWidth: '100%',
    flexGrow: 0,
    flexShrink: 1,
  },
  fullBubbleSelf: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
  },
});

export const chatBubbleTextStyle = StyleSheet.create({
  text: wechatChatStyles.bubbleText,
});
