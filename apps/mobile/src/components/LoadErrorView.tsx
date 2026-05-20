import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../theme/colors';
import { zh } from '../locales/zh-CN';

interface Props {
  message: string;
  onRetry: () => void;
}

export function LoadErrorView({ message, onRetry }: Props) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{zh.common.loadFailed}</Text>
      <Text style={styles.message}>{message}</Text>
      <Text style={styles.hint}>{zh.writing.newDocApiHint}</Text>
      <Pressable style={styles.btn} onPress={onRetry}>
        <Text style={styles.btnText}>{zh.common.retry}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  title: { fontSize: typography.title, fontWeight: '700', color: colors.text },
  message: { fontSize: typography.caption, color: colors.textMuted, textAlign: 'center' },
  hint: {
    fontSize: typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: typography.bodyLineHeight,
  },
  btn: {
    marginTop: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  btnText: { color: colors.onPrimary, fontWeight: '600', fontSize: typography.button },
});
