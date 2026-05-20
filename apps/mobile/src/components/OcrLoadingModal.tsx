import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { modalStyles } from '../theme/modalStyles';
import { radius } from '../theme/tokens';
import { useTextStyles } from '../theme/useTextStyles';
import { zh } from '../locales/zh-CN';

type Props = {
  visible: boolean;
  message?: string;
};

export function OcrLoadingModal({ visible, message = zh.writing.ocrRecognizing }: Props) {
  const text = useTextStyles();

  return (
    <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.message, text.body]}>{message}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...modalStyles.backdrop,
    alignItems: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 28,
    minWidth: 240,
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  message: { textAlign: 'center' },
});
