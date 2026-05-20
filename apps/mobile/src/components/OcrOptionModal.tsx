import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { AppModalShell } from './AppModalShell';
import { colors } from '../theme/colors';
import { radius, touch } from '../theme/tokens';
import { useTextStyles } from '../theme/useTextStyles';

type Option = { key: string; label: string; primary?: boolean };

type Props = {
  visible: boolean;
  title: string;
  hint?: string;
  options: Option[];
  onSelect: (key: string) => void;
  onClose: () => void;
};

export function OcrOptionModal({ visible, title, hint, options, onSelect, onClose }: Props) {
  const text = useTextStyles();

  return (
    <AppModalShell visible={visible} title={title} onClose={onClose} cardStyle={styles.card}>
      {hint ? <Text style={[styles.hint, text.hint]}>{hint}</Text> : null}
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {options.map((opt) => (
          <Pressable
            key={opt.key}
            style={[styles.option, opt.primary && styles.optionPrimary]}
            onPress={() => onSelect(opt.key)}
          >
            <Text
              style={[styles.optionText, text.button, opt.primary && styles.optionTextPrimary]}
              numberOfLines={3}
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </AppModalShell>
  );
}

const styles = StyleSheet.create({
  card: { maxHeight: '85%' },
  hint: { marginBottom: 16 },
  list: { maxHeight: 420 },
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 10,
    backgroundColor: colors.background,
    minHeight: touch.comfort,
    justifyContent: 'center',
  },
  optionPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  optionText: { fontWeight: '600' },
  optionTextPrimary: { color: colors.onPrimary, fontWeight: '700' },
});
