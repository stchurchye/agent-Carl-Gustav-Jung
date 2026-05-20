import { ActivityIndicator } from 'react-native';
import { chatIcons } from '../assets/chatIcons';
import { AssistantToolIconButton } from './AssistantToolIconButton';
import { ChatUiIcon } from './ChatUiIcon';
import { colors } from '../theme/colors';
import { zh } from '../locales/zh-CN';

/** 识图结果插入方式（当前固定为章节末尾） */
export type OcrInsertMode = 'end';

type Props = {
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
  /** 与「按住说话」并排时的紧凑样式 */
  inline?: boolean;
};

/** 识图录入入口按钮（实际选图逻辑在写作页根级执行，避免嵌套 Modal） */
export function AssistantOcrFlow({ disabled, busy, onPress, inline }: Props) {
  return (
    <AssistantToolIconButton
      onPress={onPress}
      disabled={disabled || busy}
      variant="soft"
      accessibilityLabel={inline ? zh.writing.ocrPhotoShort : zh.writing.ocrPhoto}
    >
      {busy ? (
        <ActivityIndicator color={colors.primary} size="small" />
      ) : (
        <ChatUiIcon source={chatIcons.ocr} size={22} />
      )}
    </AssistantToolIconButton>
  );
}
