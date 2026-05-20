import { forwardRef } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type TextInput as TextInputType,
} from 'react-native';
import { colors, typography } from '../theme/colors';
import { radius } from '../theme/tokens';

export type AppTextInputVariant = 'default' | 'compose';

type Props = TextInputProps & {
  /** compose：底部聊天栏，矮输入框、可增高；default：写作小助手等 */
  variant?: AppTextInputVariant;
};

/**
 * 统一 TextInput：flex:1 放在外层 View，避免 iOS 无法聚焦（尤其新架构）。
 */
export const AppTextInput = forwardRef<TextInputType, Props>(function AppTextInput(
  { style, multiline, variant = 'default', ...rest },
  ref,
) {
  const isCompose = variant === 'compose';
  const wrapStyle = multiline
    ? isCompose
      ? styles.composeMultilineWrap
      : styles.multilineWrap
    : styles.singleWrap;
  const inputStyle = multiline
    ? isCompose
      ? styles.composeMultilineInput
      : styles.multilineInput
    : styles.singleInput;

  return (
    <View collapsable={false} style={wrapStyle}>
      <TextInput
        ref={ref}
        multiline={multiline}
        showSoftInputOnFocus={Platform.OS === 'ios' ? true : undefined}
        style={[inputStyle, style]}
        {...rest}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  singleWrap: {
    width: '100%',
  },
  singleInput: {
    minHeight: 48,
    width: '100%',
    fontSize: typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
  },
  multilineWrap: {
    width: '100%',
    minHeight: 52,
  },
  multilineInput: {
    width: '100%',
    minHeight: 52,
    maxHeight: 120,
  },
  composeMultilineWrap: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    justifyContent: 'center',
  },
  composeMultilineInput: {
    width: '100%',
    minHeight: 36,
    maxHeight: 108,
    paddingVertical: Platform.OS === 'ios' ? 9 : 7,
    textAlignVertical: 'top',
  },
});
