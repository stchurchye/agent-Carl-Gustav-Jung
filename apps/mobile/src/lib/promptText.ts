import { appPromptText } from './appPrompt';

/** 大号字体的文本输入弹窗（全平台统一，替代系统 Alert.prompt） */
export function promptText(
  title: string,
  message: string,
  defaultValue = '',
): Promise<string | null> {
  return appPromptText(title, message, defaultValue);
}
