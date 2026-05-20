import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useLayout } from '../theme/layout';

interface Props {
  children: ReactNode;
  /** content = 窄栏；chat = 问答居中宽栏；page = 写作；full = 占满屏宽；settings = 我的页等设置类全宽 */
  variant?: 'content' | 'page' | 'chat' | 'full' | 'settings';
  style?: ViewStyle;
  /** 放在 ScrollView 内时设为 true，避免 flex:1 把内容压在一屏里无法滚动 */
  scrollChild?: boolean;
}

/** iPad 上居中限宽，手机全宽 */
export function TabletFrame({
  children,
  variant = 'content',
  style,
  scrollChild,
}: Props) {
  const { isTablet, contentMaxWidth, pageMaxWidth, chatMaxWidth, horizontalPadding } =
    useLayout();
  const isFullWidth = variant === 'full' || variant === 'settings';
  const maxWidth = isFullWidth
    ? undefined
    : variant === 'page'
      ? pageMaxWidth
      : variant === 'chat'
        ? chatMaxWidth
        : contentMaxWidth;

  const padX =
    variant === 'settings' ? 0 : isFullWidth && isTablet ? 12 : horizontalPadding;

  return (
    <View
      style={[
        scrollChild ? styles.outerScroll : styles.outer,
        isTablet && !isFullWidth && styles.outerTablet,
        style,
      ]}
    >
      <View
        style={[
          scrollChild ? styles.innerScroll : styles.inner,
          isTablet && styles.innerTablet,
          {
            maxWidth: isTablet && !isFullWidth ? maxWidth : undefined,
            paddingHorizontal: padX,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, width: '100%' },
  outerScroll: { width: '100%' },
  outerTablet: { alignItems: 'center' },
  inner: { flex: 1, width: '100%' },
  innerScroll: { width: '100%' },
  innerTablet: { alignSelf: 'stretch' },
});
