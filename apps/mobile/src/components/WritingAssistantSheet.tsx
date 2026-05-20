import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chatIcons } from '../assets/chatIcons';
import { ChatUiIcon } from './ChatUiIcon';
import { colors, typography } from '../theme/colors';
import { modalStyles } from '../theme/modalStyles';
import { zh } from '../locales/zh-CN';

export type AssistantHeaderReadAloud = {
  speaking: boolean;
  canRead: boolean;
  onToggle: () => void;
};

type Props = {
  visible: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  headerReadAloud?: AssistantHeaderReadAloud | null;
};

/** 右侧浮层：Modal 承载，避免挡住主输入框键盘 */
export function WritingAssistantSheet({
  visible,
  title,
  closeLabel,
  onClose,
  children,
  headerReadAloud,
}: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const sheetWidth = Math.min(Math.round(width * 0.46 * 1.3 * 1.3), Math.round(width * 0.92));
  const sheetHeight = Math.round(height - insets.top - insets.bottom - 8);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.modalRoot}>
        <Pressable
          style={modalStyles.backdropFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[
            styles.sheetWrap,
            {
              width: sheetWidth,
              height: sheetHeight,
              top: insets.top + 4,
            },
          ]}
          pointerEvents="box-none"
        >
          <View style={[modalStyles.sheet, styles.sheetWarm]}>
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <View style={styles.headerActions}>
                {headerReadAloud ? (
                  <Pressable
                    style={styles.headerIconBtn}
                    onPress={headerReadAloud.onToggle}
                    disabled={!headerReadAloud.canRead && !headerReadAloud.speaking}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={
                      headerReadAloud.speaking ? zh.writing.stopReading : zh.writing.readMode
                    }
                  >
                    <ChatUiIcon
                      source={chatIcons.readAloud}
                      size={22}
                      active={headerReadAloud.speaking || headerReadAloud.canRead}
                    />
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={onClose}
                  hitSlop={12}
                  style={styles.headerIconBtn}
                  accessibilityRole="button"
                  accessibilityLabel={closeLabel}
                >
                  <Text style={styles.closeText}>✕</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.body}>{children}</View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const HEADER_HEIGHT = 40;

const styles = StyleSheet.create({
  sheetWarm: {
    backgroundColor: colors.assistantBg,
    borderColor: colors.border,
  },
  modalRoot: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    position: 'absolute',
    right: 0,
    zIndex: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 4,
    minHeight: HEADER_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.assistantBg,
  },
  title: {
    flex: 1,
    fontSize: typography.body,
    fontWeight: '600',
    color: colors.text,
    marginRight: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  closeText: {
    fontSize: typography.body,
    color: colors.textMuted,
    fontWeight: '600',
  },
  body: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: colors.assistantBg,
  },
});
