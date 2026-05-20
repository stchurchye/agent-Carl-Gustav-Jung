import { StyleSheet, Text, View } from 'react-native';
import {
  formatResponseTimeMs,
  formatTokenCount,
  type LlmInvokeMeta,
  type LlmReplyMeta,
} from '@xzz/shared';
import { zenmuxChatModelLabel } from '../lib/chatLlmModel';
import { zh } from '../locales/zh-CN';
import { colors } from '../theme/colors';

type Props = {
  align?: 'left' | 'right';
  /** 已标记不进 AI 上下文 */
  contextExcluded?: boolean;
  invoke?: LlmInvokeMeta | null;
  reply?: LlmReplyMeta | null;
  /** 无 invoke/reply 时仅展示模型名（如生成中） */
  modelLabel?: string;
};

function buildMetaLine({
  contextExcluded,
  invoke,
  reply,
  modelLabel,
}: Props): string | null {
  const parts: string[] = [];
  if (contextExcluded) parts.push(zh.chat.llmExcludeContextShort);
  if (invoke) {
    parts.push(zenmuxChatModelLabel(invoke.model));
    parts.push(`${formatTokenCount(invoke.totalTokens)} token`);
  } else if (reply) {
    parts.push(zenmuxChatModelLabel(reply.model));
    parts.push(`${formatTokenCount(reply.totalTokens)} token`);
    parts.push(formatResponseTimeMs(reply.responseTimeMs));
  } else if (modelLabel) {
    parts.push(modelLabel);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** 气泡下方：不入上下文（可选）+ 模型 · token · 耗时 */
export function ChatMessageMetaFootnote(props: Props) {
  const line = buildMetaLine(props);
  if (!line) return null;
  const align = props.align ?? 'right';
  return (
    <View style={[styles.wrap, align === 'right' ? styles.wrapRight : styles.wrapLeft]}>
      <Text
        style={[styles.text, align === 'right' ? styles.textRight : styles.textLeft]}
        numberOfLines={2}
      >
        {line}
      </Text>
    </View>
  );
}

/** @deprecated 使用 ChatMessageMetaFootnote */
export function ChatLlmInvokeFootnote({
  meta,
  align = 'right',
}: {
  meta: LlmInvokeMeta;
  align?: 'left' | 'right';
}) {
  return <ChatMessageMetaFootnote invoke={meta} align={align} />;
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 3,
    maxWidth: '88%',
  },
  wrapRight: {
    alignSelf: 'flex-end',
  },
  wrapLeft: {
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 9,
    color: colors.textMuted,
    lineHeight: 12,
  },
  textRight: {
    textAlign: 'right',
  },
  textLeft: {
    textAlign: 'left',
  },
});
