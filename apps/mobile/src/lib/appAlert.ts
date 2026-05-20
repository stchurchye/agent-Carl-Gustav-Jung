import { Alert } from 'react-native';

export type AppAlertButtonStyle = 'default' | 'cancel' | 'destructive';

export type AppAlertButton = {
  text: string;
  style?: AppAlertButtonStyle;
  onPress?: () => void;
};

export type AppAlertOptions = {
  title: string;
  message?: string;
  buttons?: AppAlertButton[];
};

type ShowFn = (options: AppAlertOptions) => void;

let showImpl: ShowFn | null = null;

export function registerAppAlert(fn: ShowFn | null) {
  showImpl = fn;
}

/** 大号字体的应用内提示框（替代系统 Alert） */
export function appAlert(
  title: string,
  message?: string,
  buttons?: AppAlertButton[],
) {
  if (showImpl) {
    showImpl({ title, message, buttons });
    return;
  }
  Alert.alert(title, message, buttons);
}
