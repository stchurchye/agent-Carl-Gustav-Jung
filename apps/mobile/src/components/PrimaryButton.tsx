import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors, typography } from '../theme/colors';
import { touch } from '../theme/tokens';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  style?: ViewStyle;
  disabled?: boolean;
}

export function PrimaryButton({
  title,
  onPress,
  variant = 'primary',
  style,
  disabled,
}: Props) {
  return (
    <Pressable
      style={[
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text
        style={[
          styles.text,
          variant === 'primary' && styles.textPrimary,
          variant === 'secondary' && styles.textSecondary,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    minHeight: touch.comfort,
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.primary },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.5 },
  text: { fontSize: typography.button, fontWeight: '600' },
  textPrimary: { color: colors.onPrimary },
  textSecondary: { color: colors.text },
});
