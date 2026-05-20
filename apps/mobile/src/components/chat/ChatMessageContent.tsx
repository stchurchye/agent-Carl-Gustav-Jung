import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { parseChatMessageContent, type ChatContentBlock } from '@xzz/shared';
import { chatBubbleTextStyle } from '../ChatMessageRow';
import { wechatChat } from '../../theme/wechatChat';
import { colors, typography } from '../../theme/colors';
import { MermaidBlock } from './MermaidBlock';
import { SelectableBubbleText } from './SelectableBubbleText';
import { stripInlineMarkdown } from './stripInlineMarkdown';

type Props = {
  content: string;
  /** 同一条消息共用，用于点击区域外时取消选中 */
  messageSelectionKey?: string;
  /** 由 MessageBubblePressable 注入：全选后弹出浮窗 */
  onLongPressMenu?: () => void;
};

function TextBlock({
  text,
  messageSelectionKey,
  onLongPressMenu,
}: {
  text: string;
  messageSelectionKey?: string;
  onLongPressMenu?: () => void;
}) {
  const displayText = stripInlineMarkdown(text);
  return (
    <SelectableBubbleText
      text={displayText}
      style={chatBubbleTextStyle.text}
      selectionKey={messageSelectionKey}
      onLongPressMenu={onLongPressMenu}
    />
  );
}

function CodeBlock({
  language,
  code,
  messageSelectionKey,
  onLongPressMenu,
}: {
  language: string;
  code: string;
  messageSelectionKey?: string;
  onLongPressMenu?: () => void;
}) {
  return (
    <View style={styles.codeWrap}>
      {language && language !== 'text' ? (
        <Text style={styles.codeLang}>{language}</Text>
      ) : null}
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        style={styles.codeScroll}
        contentContainerStyle={styles.codeScrollContent}
      >
        <SelectableBubbleText
          text={code}
          style={styles.codeText}
          selectionKey={messageSelectionKey}
          onLongPressMenu={onLongPressMenu}
        />
      </ScrollView>
    </View>
  );
}

function BlockView({
  block,
  index,
  messageSelectionKey,
  onLongPressMenu,
}: {
  block: ChatContentBlock;
  index: number;
  messageSelectionKey?: string;
  onLongPressMenu?: () => void;
}) {
  if (block.type === 'mermaid') {
    return <MermaidBlock key={`m-${index}`} code={block.code} onLongPressMenu={onLongPressMenu} />;
  }
  if (block.type === 'code') {
    return (
      <CodeBlock
        key={`c-${index}`}
        language={block.language}
        code={block.code}
        messageSelectionKey={messageSelectionKey}
        onLongPressMenu={onLongPressMenu}
      />
    );
  }
  return (
    <View key={`t-${index}`} style={index > 0 ? styles.blockGap : undefined}>
      <TextBlock
        text={block.text}
        messageSelectionKey={messageSelectionKey}
        onLongPressMenu={onLongPressMenu}
      />
    </View>
  );
}

export function ChatMessageContent({
  content,
  messageSelectionKey,
  onLongPressMenu,
}: Props) {
  const blocks = useMemo(() => parseChatMessageContent(content), [content]);
  const hasOnlyText = blocks.length === 1 && blocks[0]?.type === 'text';

  if (hasOnlyText && blocks[0]?.type === 'text') {
    return (
      <TextBlock
        text={blocks[0].text}
        messageSelectionKey={messageSelectionKey}
        onLongPressMenu={onLongPressMenu}
      />
    );
  }

  return (
    <View style={styles.stack}>
      {blocks.map((block, index) => (
        <BlockView
          key={index}
          block={block}
          index={index}
          messageSelectionKey={messageSelectionKey}
          onLongPressMenu={onLongPressMenu}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexGrow: 0,
    flexShrink: 1,
  },
  blockGap: {
    marginTop: 6,
  },
  codeWrap: {
    marginVertical: 4,
    borderRadius: 4,
    backgroundColor: '#F3F3F3',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E0E0E0',
    paddingHorizontal: 8,
    paddingVertical: 6,
    maxWidth: '100%',
    alignSelf: 'flex-start',
    flexGrow: 0,
    flexShrink: 1,
  },
  codeScroll: {
    flexGrow: 0,
    flexShrink: 1,
    maxWidth: '100%',
  },
  codeScrollContent: {
    flexGrow: 0,
  },
  codeLang: {
    fontSize: 10,
    color: wechatChat.senderName,
    marginBottom: 4,
    textTransform: 'lowercase',
  },
  codeText: {
    fontFamily: 'Menlo',
    fontSize: typography.caption,
    lineHeight: 18,
    color: wechatChat.bubbleText,
  },
});
