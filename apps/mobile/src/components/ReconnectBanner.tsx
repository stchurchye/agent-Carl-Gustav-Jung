import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../theme/colors';
import { zh } from '../locales/zh-CN';

interface Props {
  message: string;
  onRetry: () => void;
}

export function ReconnectBanner({ message, onRetry }: Props) {
  return (
    <View style={styles.root}>
      <Text style={styles.text} numberOfLines={2}>
        {message}
      </Text>
      <Pressable style={styles.btn} onPress={onRetry} hitSlop={8}>
        <Text style={styles.btnText}>{zh.common.retry}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: colors.waiting,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: { flex: 1, fontSize: typography.caption, color: colors.text, lineHeight: typography.bodyLineHeight },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  btnText: { color: colors.onPrimary, fontWeight: '600', fontSize: typography.caption },
});
