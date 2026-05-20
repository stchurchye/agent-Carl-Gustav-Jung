import { useEffect, useRef, useState } from 'react';
import {
  Image,
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { chatIcons } from '../assets/chatIcons';
import {
  DEFAULT_ASK_AI_FAB_POSITION,
  getAskAiFabPosition,
  setAskAiFabPosition,
  type AskAiFabPosition,
} from '../lib/chatAskAiFabPosition';

const FAB_SIZE = 56;
/** 按住约 280ms 后可拖动 */
const DRAG_ENABLE_MS = 280;
/** 按住 3s 打开 AI 设置 */
const SETTINGS_OPEN_MS = 3000;
const TAP_MOVE_THRESHOLD = 10;

type Props = {
  active: boolean;
  /** 轻触：进入 / 退出问 AI 模式 */
  onTap: () => void;
  /** 长按 3 秒：打开 AI 设置（不改变问 AI 开关） */
  onLongPress: () => void;
};

type PixelPos = { left: number; top: number };

function ratioToPixel(ratio: AskAiFabPosition, width: number, height: number): PixelPos {
  const maxX = Math.max(0, width - FAB_SIZE);
  const maxY = Math.max(0, height - FAB_SIZE);
  return {
    left: ratio.x * maxX,
    top: ratio.y * maxY,
  };
}

function pixelToRatio(pos: PixelPos, width: number, height: number): AskAiFabPosition {
  const maxX = Math.max(1, width - FAB_SIZE);
  const maxY = Math.max(1, height - FAB_SIZE);
  return {
    x: Math.min(1, Math.max(0, pos.left / maxX)),
    y: Math.min(1, Math.max(0, pos.top / maxY)),
  };
}

function clampPixel(pos: PixelPos, width: number, height: number): PixelPos {
  const maxX = Math.max(0, width - FAB_SIZE);
  const maxY = Math.max(0, height - FAB_SIZE);
  return {
    left: Math.min(maxX, Math.max(0, pos.left)),
    top: Math.min(maxY, Math.max(0, pos.top)),
  };
}

export function DraggableAskAiFab({ active, onTap, onLongPress }: Props) {
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const [pos, setPos] = useState<PixelPos | null>(null);
  const savedRatioRef = useRef<AskAiFabPosition>(DEFAULT_ASK_AI_FAB_POSITION);
  const posRef = useRef<PixelPos | null>(null);
  const dragStartRef = useRef<PixelPos | null>(null);
  const dragEnableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const settingsOpenedRef = useRef(false);
  const onTapRef = useRef(onTap);
  const onLongPressRef = useRef(onLongPress);
  const containerRef = useRef(container);

  useEffect(() => {
    onTapRef.current = onTap;
  }, [onTap]);

  useEffect(() => {
    onLongPressRef.current = onLongPress;
  }, [onLongPress]);

  useEffect(() => {
    containerRef.current = container;
  }, [container]);

  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  useEffect(() => {
    void getAskAiFabPosition().then((ratio) => {
      savedRatioRef.current = ratio;
      const { width, height } = containerRef.current;
      if (width >= FAB_SIZE && height >= FAB_SIZE) {
        setPos(ratioToPixel(ratio, width, height));
      }
    });
  }, []);

  useEffect(() => {
    if (container.width < FAB_SIZE || container.height < FAB_SIZE) return;
    setPos((current) => {
      if (current && draggingRef.current) return current;
      return ratioToPixel(savedRatioRef.current, container.width, container.height);
    });
  }, [container.width, container.height]);

  const clearGestureTimers = () => {
    if (dragEnableTimerRef.current) {
      clearTimeout(dragEnableTimerRef.current);
      dragEnableTimerRef.current = null;
    }
    if (settingsTimerRef.current) {
      clearTimeout(settingsTimerRef.current);
      settingsTimerRef.current = null;
    }
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainer({ width, height });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        movedRef.current = false;
        draggingRef.current = false;
        settingsOpenedRef.current = false;
        dragStartRef.current = posRef.current ? { ...posRef.current } : { left: 0, top: 0 };

        dragEnableTimerRef.current = setTimeout(() => {
          draggingRef.current = true;
        }, DRAG_ENABLE_MS);

        settingsTimerRef.current = setTimeout(() => {
          if (movedRef.current) return;
          settingsOpenedRef.current = true;
          clearGestureTimers();
          draggingRef.current = false;
          onLongPressRef.current();
        }, SETTINGS_OPEN_MS);
      },
      onPanResponderMove: (_, gesture) => {
        const { width, height } = containerRef.current;
        if (width < FAB_SIZE || height < FAB_SIZE || !dragStartRef.current) return;

        const moved =
          Math.abs(gesture.dx) > TAP_MOVE_THRESHOLD || Math.abs(gesture.dy) > TAP_MOVE_THRESHOLD;

        if (!draggingRef.current && moved) {
          clearGestureTimers();
          return;
        }

        if (!draggingRef.current) return;

        if (moved) {
          if (settingsTimerRef.current) {
            clearTimeout(settingsTimerRef.current);
            settingsTimerRef.current = null;
          }
          movedRef.current = true;
          const next = clampPixel(
            {
              left: dragStartRef.current.left + gesture.dx,
              top: dragStartRef.current.top + gesture.dy,
            },
            width,
            height,
          );
          posRef.current = next;
          setPos(next);
        }
      },
      onPanResponderRelease: () => {
        clearGestureTimers();
        const { width, height } = containerRef.current;
        if (movedRef.current && posRef.current && width >= FAB_SIZE) {
          const ratio = pixelToRatio(posRef.current, width, height);
          savedRatioRef.current = ratio;
          void setAskAiFabPosition(ratio);
        } else if (!settingsOpenedRef.current && !movedRef.current) {
          onTapRef.current();
        }
        draggingRef.current = false;
        dragStartRef.current = null;
      },
      onPanResponderTerminate: () => {
        clearGestureTimers();
        const { width, height } = containerRef.current;
        if (movedRef.current && posRef.current && width >= FAB_SIZE) {
          const ratio = pixelToRatio(posRef.current, width, height);
          savedRatioRef.current = ratio;
          void setAskAiFabPosition(ratio);
        }
        draggingRef.current = false;
        dragStartRef.current = null;
      },
    }),
  ).current;

  if (!pos || container.width < FAB_SIZE || container.height < FAB_SIZE) {
    return <View style={styles.host} onLayout={onLayout} pointerEvents="box-none" />;
  }

  return (
    <View style={styles.host} onLayout={onLayout} pointerEvents="box-none">
      <View style={[styles.fab, { left: pos.left, top: pos.top }]}
        {...panResponder.panHandlers}
        accessibilityRole="button"
        accessibilityLabel={active ? '退出问 AI 模式' : '进入问 AI 模式'}
        accessibilityHint="长按 3 秒打开 AI 设置"
      >
        <Image
          source={active ? chatIcons.askAiActive : chatIcons.askAiInactive}
          style={styles.icon}
          resizeMode="contain"
        />
      </View>
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
    width: FAB_SIZE,
    height: FAB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 6,
  },
  icon: {
    width: FAB_SIZE,
    height: FAB_SIZE,
  },
});
