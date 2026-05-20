import type { ReactNode, RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import type { TextInput } from 'react-native';
import type { ContextUsage } from '@xzz/shared';
import { ChatComposeBar } from './ChatComposeBar';
import { zh } from '../locales/zh-CN';

type Props = {
  input: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  /** 按住说话松开后直接发送 */
  onVoiceText: (text: string) => void;
  /** 右侧 + 选图（写作页识图录入） */
  onPickImage?: () => void;
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
  inputRef?: RefObject<TextInput | null>;
  topAccessory?: ReactNode;
  contextUsage?: ContextUsage | null;
  contextUsageLoading?: boolean;
  onContextDetailOpen?: (usage: ContextUsage) => void;
  onContextRingLongPress?: () => void;
};

/** 写作小助手底部输入：与聊天页同一套 ChatComposeBar（语音切换 / 听写 / + 识图 / 发送） */
export function AssistantComposeDock({
  input,
  onChangeText,
  onSend,
  onVoiceText,
  onPickImage,
  placeholder = zh.writing.assistantPlaceholder,
  disabled,
  busy,
  inputRef,
  topAccessory,
  contextUsage,
  contextUsageLoading,
  onContextDetailOpen,
  onContextRingLongPress,
}: Props) {
  const showContextSlot =
    contextUsage !== undefined || contextUsageLoading;

  return (
    <View style={styles.footer}>
      {topAccessory}
      <ChatComposeBar
        value={input}
        onChangeText={onChangeText}
        onSend={onSend}
        onSendVoiceText={onVoiceText}
        onPickImage={onPickImage}
        placeholder={placeholder}
        busy={busy}
        disabled={disabled}
        inputRef={inputRef}
        contextUsage={contextUsage}
        contextUsageLoading={contextUsageLoading}
        bottomInset={0}
        reserveContextSlot={showContextSlot}
        onContextDetailOpen={onContextDetailOpen}
        onContextRingLongPress={onContextRingLongPress}
        contextAfterTrailing
      />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexShrink: 0,
    marginTop: 4,
  },
});
