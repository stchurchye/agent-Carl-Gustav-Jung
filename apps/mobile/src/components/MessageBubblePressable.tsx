import { cloneElement, isValidElement, useRef, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { MessageBubbleAnchor } from './chat/MessageBubbleAnchor';

type Props = {
  style?: StyleProp<ViewStyle>;
  /** 本人消息气泡靠右对齐 */
  alignEnd?: boolean;
  onLongPress: (anchor: MessageBubbleAnchor) => void;
  children: ReactNode;
};

/**
 * 气泡容器：不用 Pressable，避免挡住系统文本选择与拖动手柄。
 * 长按菜单由 SelectableBubbleText 全选后触发。
 */
export function MessageBubblePressable({
  style,
  alignEnd = false,
  onLongPress,
  children,
}: Props) {
  const ref = useRef<View>(null);

  const fireLongPress = () => {
    ref.current?.measureInWindow((x, y, width, height) => {
      onLongPress({ x, y, width, height });
    });
  };

  const child =
    isValidElement(children) && typeof children.type !== 'string'
      ? cloneElement(children as ReactElement<{ onLongPressMenu?: () => void }>, {
          onLongPressMenu: fireLongPress,
        })
      : children;

  return (
    <View
      ref={ref}
      collapsable={false}
      style={[styles.hitArea, alignEnd ? styles.hitAreaEnd : null]}
    >
      <View style={style}>{child}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  hitArea: {
    maxWidth: '100%',
    flexGrow: 0,
    flexShrink: 1,
    alignSelf: 'flex-start',
  },
  hitAreaEnd: {
    alignSelf: 'flex-end',
  },
});
