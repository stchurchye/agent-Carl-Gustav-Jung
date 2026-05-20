import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { modalStyles } from '../theme/modalStyles';
import { useTextStyles } from '../theme/useTextStyles';

type Props = {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
  /** 默认居中卡片；sheet 仅提供标题栏样式，布局由调用方处理 */
  variant?: 'center' | 'headerOnly';
  cardStyle?: StyleProp<ViewStyle>;
  closeAccessibilityLabel?: string;
};

/** 统一弹窗：遮罩、标题、关闭按钮 */
export function AppModalShell({
  visible,
  title,
  onClose,
  children,
  variant = 'center',
  cardStyle,
  closeAccessibilityLabel = '关闭',
}: Props) {
  const text = useTextStyles();

  if (variant === 'headerOnly') {
    return (
      <>
        {title ? (
          <View style={modalStyles.headerBordered}>
            <Text style={[modalStyles.title, text.button]}>{title}</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={modalStyles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel={closeAccessibilityLabel}
            >
              <Text style={[modalStyles.closeText, text.caption]}>✕</Text>
            </Pressable>
          </View>
        ) : null}
        {children}
      </>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <Pressable
        style={modalStyles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeAccessibilityLabel}
      >
        <Pressable
          style={[modalStyles.card, modalStyles.cardCentered, cardStyle]}
          onPress={(e) => e.stopPropagation()}
        >
          {title ? (
            <View style={[styles.cardInner, styles.cardInnerWithTitle]}>
              <View style={modalStyles.header}>
                <Text style={[modalStyles.title, text.title]}>{title}</Text>
                <Pressable
                  onPress={onClose}
                  hitSlop={12}
                  style={modalStyles.closeBtn}
                  accessibilityRole="button"
                  accessibilityLabel={closeAccessibilityLabel}
                >
                  <Text style={[modalStyles.closeText, text.caption]}>✕</Text>
                </Pressable>
              </View>
              {children}
            </View>
          ) : (
            <View style={styles.cardInner}>{children}</View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  cardInner: { padding: 20 },
  cardInnerWithTitle: { paddingTop: 20 },
});
