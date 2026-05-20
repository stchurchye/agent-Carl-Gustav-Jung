import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  buildChapterTitle,
  displayChapterTitle,
  type ChapterTitleParts,
} from '@xzz/shared';
import { AppTextInput } from './AppTextInput';
import { appAlert } from '../lib/appAlert';
import { zh } from '../locales/zh-CN';
import { colors } from '../theme/colors';
import { modalStyles } from '../theme/modalStyles';
import { radius, touch } from '../theme/tokens';
import { useTextStyles } from '../theme/useTextStyles';

type Props = {
  visible: boolean;
  title: string;
  hint?: string;
  initial: ChapterTitleParts;
  indexEditable?: boolean;
  onCancel: () => void;
  onConfirm: (parts: ChapterTitleParts) => void;
};

export function ChapterTitlePromptDialog({
  visible,
  title,
  hint,
  initial,
  indexEditable = true,
  onCancel,
  onConfirm,
}: Props) {
  const text = useTextStyles();
  const [type, setType] = useState(initial.type);
  const [index, setIndex] = useState(initial.index);
  const [note, setNote] = useState(initial.note);

  useEffect(() => {
    if (visible) {
      setType(initial.type);
      setIndex(initial.index);
      setNote(initial.note);
    }
  }, [visible, initial.type, initial.index, initial.note]);

  const preview = useMemo(
    () =>
      displayChapterTitle(
        buildChapterTitle({
          type,
          index,
          note,
        }),
      ),
    [type, index, note],
  );

  const handleConfirm = () => {
    const parts: ChapterTitleParts = {
      type: type.trim(),
      index: index.trim(),
      note: note.trim(),
    };
    if (!parts.type) {
      appAlert('提示', zh.writing.chapterTypeEmpty);
      return;
    }
    if (!/^\d+$/.test(parts.index)) {
      appAlert('提示', zh.writing.chapterIndexInvalid);
      return;
    }
    onConfirm(parts);
  };

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
          <Text style={[text.title, styles.title]}>{title}</Text>
          {hint ? <Text style={[text.body, styles.message]}>{hint}</Text> : null}

          <Text style={styles.fieldLabel}>{zh.writing.chapterTypeLabel}</Text>
          <AppTextInput
            value={type}
            onChangeText={setType}
            placeholder={zh.writing.chapterTypePlaceholder}
            placeholderTextColor={colors.textMuted}
            style={[text.body, styles.input]}
            accessibilityLabel={zh.writing.chapterTypeLabel}
          />

          <Text style={styles.fieldLabel}>{zh.writing.chapterIndexLabel}</Text>
          <AppTextInput
            value={index}
            onChangeText={setIndex}
            editable={indexEditable}
            keyboardType="number-pad"
            placeholder={zh.writing.chapterIndexPlaceholder}
            placeholderTextColor={colors.textMuted}
            style={[text.body, styles.input, !indexEditable && styles.inputReadonly]}
            accessibilityLabel={zh.writing.chapterIndexLabel}
          />

          <Text style={styles.fieldLabel}>{zh.writing.chapterNoteLabel}</Text>
          <AppTextInput
            value={note}
            onChangeText={setNote}
            placeholder={zh.writing.chapterNotePlaceholder}
            placeholderTextColor={colors.textMuted}
            style={[text.body, styles.input]}
            accessibilityLabel={zh.writing.chapterNoteLabel}
          />

          <Text style={styles.preview}>
            {zh.writing.chapterPreviewLabel}
            {preview}
          </Text>

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
              onPress={handleConfirm}
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
  message: {
    textAlign: 'center',
    color: colors.textMuted,
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    width: '100%',
    minHeight: touch.comfort,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
  },
  inputReadonly: {
    opacity: 0.65,
    backgroundColor: colors.surface,
  },
  preview: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  btnRow: {
    gap: 12,
  },
  btnRowHorizontal: {
    flexDirection: 'row',
  },
  btn: {
    minHeight: touch.comfort,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnFlex: {
    flex: 1,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnLabel: {
    textAlign: 'center',
  },
});
