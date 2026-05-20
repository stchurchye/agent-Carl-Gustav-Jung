import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { AppModalShell } from './AppModalShell';
import { colors } from '../theme/colors';
import { radius, touch } from '../theme/tokens';
import { useTextStyles } from '../theme/useTextStyles';
import { zh } from '../locales/zh-CN';

export type OcrChapterOption = { id: string; title: string };

type Props = {
  visible: boolean;
  chapters: OcrChapterOption[];
  activeChapterId: string | null;
  onClose: () => void;
  onSelect: (chapterId: string) => void;
};

export function OcrChapterPickerModal({
  visible,
  chapters,
  activeChapterId,
  onClose,
  onSelect,
}: Props) {
  const text = useTextStyles();
  const others = chapters.filter((ch) => ch.id !== activeChapterId);

  return (
    <AppModalShell
      visible={visible}
      title={zh.writing.ocrChapterPickerTitle}
      onClose={onClose}
      cardStyle={styles.card}
    >
      <Text style={[styles.hint, text.hint]}>{zh.writing.ocrChapterPickerHint}</Text>
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {others.length === 0 ? (
          <Text style={[styles.empty, text.body]}>{zh.writing.ocrChapterPickerEmpty}</Text>
        ) : (
          others.map((ch) => (
            <Pressable key={ch.id} style={styles.option} onPress={() => onSelect(ch.id)}>
              <Text style={[styles.optionText, text.button]} numberOfLines={2}>
                {ch.title}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
      <Pressable style={styles.backRow} onPress={onClose}>
        <Text style={[styles.backText, text.button]}>{zh.common.back}</Text>
      </Pressable>
    </AppModalShell>
  );
}

const styles = StyleSheet.create({
  card: { maxHeight: '85%' },
  hint: { marginBottom: 12 },
  list: { maxHeight: 400 },
  empty: { paddingVertical: 24, textAlign: 'center', color: colors.textMuted },
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
  optionText: { color: colors.text, fontWeight: '600' },
  backRow: { marginTop: 8, paddingVertical: 12, alignItems: 'center' },
  backText: { color: colors.textMuted, fontWeight: '600' },
});
