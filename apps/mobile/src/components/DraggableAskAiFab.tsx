import { Image, Pressable, StyleSheet, View } from 'react-native';
import { chatIcons } from '../assets/chatIcons';

const FAB_SIZE = 56;
/** 长按 3s 打开 AI 设置(轻触只切换问 AI 模式) */
const SETTINGS_OPEN_MS = 3000;

type Props = {
  active: boolean;
  /** 轻触:进入 / 退出问 AI 模式 */
  onTap: () => void;
  /** 长按 3 秒:打开 AI 设置(不改变问 AI 开关) */
  onLongPress: () => void;
  /** 固定落点:对话页右上角(默认),写作助手沿用旧的中右偏下避免压住正文 */
  placement?: 'top-right' | 'lower-right';
};

/**
 * 问 AI 入口:固定落点(原可拖拽悬浮球已收敛为固定位,免遮挡气泡/误拖)。
 * host 铺满父容器但 box-none 放行点击,仅按钮本身响应。
 */
export function DraggableAskAiFab({ active, onTap, onLongPress, placement = 'top-right' }: Props) {
  return (
    <View style={styles.host} pointerEvents="box-none">
      <Pressable
        style={[styles.fab, placement === 'lower-right' ? styles.fabLowerRight : styles.fabTopRight]}
        onPress={onTap}
        onLongPress={onLongPress}
        delayLongPress={SETTINGS_OPEN_MS}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={active ? '退出问 AI 模式' : '进入问 AI 模式'}
        accessibilityHint="长按 3 秒打开 AI 设置"
      >
        <Image
          source={active ? chatIcons.askAiActive : chatIcons.askAiInactive}
          style={styles.icon}
          resizeMode="contain"
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  fab: {
    position: 'absolute',
    right: 12,
    width: FAB_SIZE,
    height: FAB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabTopRight: { top: 8 },
  fabLowerRight: { bottom: 16 },
  icon: {
    width: FAB_SIZE,
    height: FAB_SIZE,
  },
});
