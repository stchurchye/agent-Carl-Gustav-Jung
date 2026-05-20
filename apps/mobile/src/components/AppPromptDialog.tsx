import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppTextInput } from './AppTextInput';
import { zh } from '../locales/zh-CN';
import { colors } from '../theme/colors';
import { modalStyles } from '../theme/modalStyles';
import { touch } from '../theme/tokens';
import { wechat } from '../theme/wechat';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  defaultValue: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
};

export function AppPromptDialog({
  visible,
  title,
  message,
  defaultValue,
  onCancel,
  onConfirm,
}: Props) {
  const [draft, setDraft] = useState(defaultValue);

  useEffect(() => {
    if (visible) setDraft(defaultValue);
  }, [visible, defaultValue]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      presentationStyle="overFullScreen"
    >
      <View style={modalStyles.alertBackdrop}>
        <View style={[modalStyles.card, styles.card]}>
          <Text style={styles.title}>{title}</Text>
          {message.trim() ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.inputWrap}>
            <AppTextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              selectTextOnFocus
              placeholderTextColor={wechat.textTertiary}
              style={styles.input}
              accessibilityLabel={title}
            />
          </View>
          <View style={styles.btnRow}>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnCancel, pressed && styles.btnPressed]}
              onPress={onCancel}
              accessibilityRole="button"
            >
              <Text style={styles.btnLabelCancel}>{zh.writing.cancel}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
              onPress={() => onConfirm(draft.trim())}
              accessibilityRole="button"
            >
              <Text style={styles.btnLabelConfirm}>{zh.common.confirm}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'center',
    width: '88%',
    maxWidth: 300,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: wechat.cellBg,
  },
  title: {
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    color: wechat.textPrimary,
    paddingTop: 20,
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  message: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    color: wechat.textSecondary,
    paddingHorizontal: 20,
    paddingBottom: 10,
    marginTop: -6,
  },
  inputWrap: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 6,
    backgroundColor: wechat.pageBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: wechat.separator,
  },
  input: {
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    lineHeight: 22,
    color: wechat.textPrimary,
    textAlign: 'center',
  },
  btnRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: wechat.separator,
  },
  btn: {
    flex: 1,
    minHeight: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: 'transparent',
  },
  btnCancel: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: wechat.separator,
  },
  btnPressed: {
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  btnLabelCancel: {
    fontSize: 17,
    fontWeight: '400',
    color: wechat.textPrimary,
  },
  btnLabelConfirm: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.primary,
  },
});
