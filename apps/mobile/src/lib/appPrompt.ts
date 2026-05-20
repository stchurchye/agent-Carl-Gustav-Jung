import { Alert, Platform } from 'react-native';

export type AppPromptRequest = {
  title: string;
  message: string;
  defaultValue: string;
  resolve: (value: string | null) => void;
};

type ShowPromptFn = (request: AppPromptRequest) => void;

let showPromptImpl: ShowPromptFn | null = null;

export function registerAppPrompt(fn: ShowPromptFn | null) {
  showPromptImpl = fn;
}

/** 大号字体的应用内输入提示框（替代系统 Alert.prompt） */
export function appPromptText(
  title: string,
  message: string,
  defaultValue = '',
): Promise<string | null> {
  if (showPromptImpl) {
    return new Promise((resolve) => {
      showPromptImpl!({
        title,
        message,
        defaultValue,
        resolve,
      });
    });
  }
  if (Platform.OS === 'ios') {
    return new Promise((resolve) => {
      Alert.prompt(
        title,
        message,
        [
          { text: '取消', style: 'cancel', onPress: () => resolve(null) },
          { text: '确定', onPress: (text?: string) => resolve(text?.trim() ?? '') },
        ],
        'plain-text',
        defaultValue,
      );
    });
  }
  return Promise.resolve(defaultValue);
}
