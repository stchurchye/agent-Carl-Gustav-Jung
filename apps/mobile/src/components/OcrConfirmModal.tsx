import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AppTextInput } from './AppTextInput';
import { AppModalShell } from './AppModalShell';
import { colors } from '../theme/colors';
import { radius, touch } from '../theme/tokens';
import { useTextStyles } from '../theme/useTextStyles';
import { zh } from '../locales/zh-CN';

const INPUT_MIN_HEIGHT_LARGE = 480;
const INPUT_MAX_HEIGHT_LARGE = 840;
const INPUT_MIN_HEIGHT_RATIO = 0.28;
const INPUT_MAX_HEIGHT_RATIO = 0.62;

type Props = {
  visible: boolean;
  draft: string;
  onChangeDraft: (text: string) => void;
  onClose: () => void;
  onNext: () => void;
};

export function OcrConfirmModal({
  visible,
  draft,
  onChangeDraft,
  onClose,
  onNext,
}: Props) {
  const { height: windowHeight } = useWindowDimensions();
  const text = useTextStyles();
  const inputMinHeight = Math.min(
    INPUT_MIN_HEIGHT_LARGE,
    Math.max(160, Math.round(windowHeight * INPUT_MIN_HEIGHT_RATIO)),
  );
  const inputMaxHeight = Math.min(
    INPUT_MAX_HEIGHT_LARGE,
    Math.max(inputMinHeight + 40, Math.round(windowHeight * INPUT_MAX_HEIGHT_RATIO)),
  );

  return (
    <AppModalShell visible={visible} title={zh.writing.ocrConfirmTitle} onClose={onClose}>
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <Text style={[styles.hint, text.hint]}>{zh.writing.ocrConfirmHint}</Text>
        <AppTextInput
          style={[
            styles.input,
            text.body,
            {
              minHeight: inputMinHeight,
              maxHeight: inputMaxHeight,
            },
          ]}
          value={draft}
          onChangeText={onChangeDraft}
          multiline
          textAlignVertical="top"
        />
        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={onClose}>
            <Text style={[styles.btnGhostText, text.button]}>{zh.common.back}</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onNext}>
            <Text style={[styles.btnPrimaryText, text.button]}>{zh.writing.ocrConfirmNext}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </AppModalShell>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  hint: { marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 16,
    backgroundColor: colors.background,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: {
    flex: 1,
    paddingVertical: 16,
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
