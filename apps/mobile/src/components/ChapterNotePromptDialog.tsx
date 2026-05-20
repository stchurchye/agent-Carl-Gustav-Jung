import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppTextInput } from './AppTextInput';
import { zh } from '../locales/zh-CN';
import { colors } from '../theme/colors';
import { modalStyles } from '../theme/modalStyles';
import { radius, touch } from '../theme/tokens';
import { useTextStyles } from '../theme/useTextStyles';

type Props = {
  visible: boolean;
  typeLabel: string;
  indexLabel: string;
  initialNote?: string;
  onCancel: () => void;
  onConfirm: (note: string) => void;
};

/** 在已选定类型与序号时，仅填写主题（选填） */
export function ChapterNotePromptDialog({
  visible,
  typeLabel,
  indexLabel,
  initialNote = '',
  onCancel,
  onConfirm,
}: Props) {
  const text = useTextStyles();
  const [note, setNote] = useState(initialNote);

  useEffect(() => {
    if (visible) setNote(initialNote);
  }, [visible, initialNote]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      presentationStyle="overFullScreen"
    >
      <View style={modalStyles.alertBackdrop}>
        <View style={[modalStyles.card, modalStyles.alertCard, styles.card]}>
          <Text style={[text.title, styles.title]}>{zh.writing.newChapterTitle}</Text>
          <Text style={[text.body, styles.meta]}>
            {typeLabel} · {indexLabel}
          </Text>

          <Text style={styles.fieldLabel}>{zh.writing.chapterNoteLabel}</Text>
          <AppTextInput
            value={note}
            onChangeText={setNote}
            placeholder={zh.writing.chapterNotePlaceholder}
            placeholderTextColor={colors.textMuted}
            style={[text.body, styles.input]}
            accessibilityLabel={zh.writing.chapterNoteLabel}
          />

          <View style={[styles.btnRow, styles.btnRowHorizontal]}>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnFlex, pressed && styles.btnPressed]}
              onPress={onCancel}
              accessibilityRole="button"
            >
              <Text style={[text.button, styles.btnLabel]}>{zh.writing.cancel}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnFlex, pressed && styles.btnPressed]}
              onPress={() => onConfirm(note.trim())}
              accessibilityRole="button"
            >
              <Text style={[text.button, styles.btnLabel]}>{zh.common.confirm}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 22,
    borderRadius: radius.md,
  },
  title: {
    textAlign: 'center',
    marginBottom: 8,
  },
  meta: {
    textAlign: 'center',
    color: colors.textMuted,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 6,
  },
  input: {
    width: '100%',
    minHeight: touch.comfort,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
  },
  btnRow: { gap: 12 },
  btnRowHorizontal: { flexDirection: 'row' },
  btn: {
    minHeight: touch.comfort,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnFlex: { flex: 1 },
  btnPressed: { opacity: 0.85 },
  btnLabel: { textAlign: 'center' },
});
