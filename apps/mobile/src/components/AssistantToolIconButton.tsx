import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../theme/colors';
import { radius } from '../theme/tokens';

export const ASSIST_TOOL_ICON_SIZE = 22;

type Props = {
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: 'plain' | 'soft' | 'primary' | 'active';
};

export function AssistantToolIconButton({
  onPress,
  disabled,
  accessibilityLabel,
  children,
  style,
  variant = 'plain',
}: Props) {
  return (
    <Pressable
      style={[
        styles.btn,
        variant === 'soft' && styles.btnSoft,
        variant === 'primary' && styles.btnPrimary,
        variant === 'active' && styles.btnActive,
        disabled && styles.btnDisabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  btnSoft: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  btnActive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  btnPrimary: {
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  btnDisabled: { opacity: 0.4 },
});
