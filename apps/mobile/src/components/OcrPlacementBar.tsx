import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { radius, touch } from '../theme/tokens';
import { useTextStyles } from '../theme/useTextStyles';
import { zh } from '../locales/zh-CN';

type Props = {
  hint: string;
  targetLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/** 识图插入：浏览正文、点选光标后确认 */
export function OcrPlacementBar({ hint, targetLabel, onCancel, onConfirm }: Props) {
  const text = useTextStyles();

  return (
    <View style={styles.bar}>
      <Text style={[styles.hint, text.button]}>{hint}</Text>
      {targetLabel ? <Text style={[styles.target, text.hint]}>{targetLabel}</Text> : null}
      <View style={styles.actions}>
        <Pressable style={[styles.btn, styles.btnGhost]} onPress={onCancel}>
          <Text style={[styles.btnGhostText, text.button]}>{zh.writing.cancel}</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onConfirm}>
          <Text style={[styles.btnPrimaryText, text.button]}>{zh.writing.ocrPlacementConfirm}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: 1,
    borderTopColor: colors.primary,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  hint: { color: colors.text, fontWeight: '600' },
  target: { color: colors.textMuted },
  actions: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.sm,
    alignItems: 'center',
    minHeight: touch.comfort,
    justifyContent: 'center',
  },
  btnGhost: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  btnGhostText: { fontWeight: '600' },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: colors.onPrimary, fontWeight: '700' },
});
