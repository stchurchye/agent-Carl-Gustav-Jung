import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlatList } from 'react-native';

type Options = {
  /** 切换会话 / 话题时重置（避免沿用上一次滚动状态） */
  resetKey: string | undefined;
  messageCount: number;
};

/**
 * 聊天列表首屏：先无动画锚到底部，再显示列表，避免进入时「闪一下、往上滚」。
 */
export function useChatListViewport({ resetKey, messageCount }: Options) {
  const listRef = useRef<FlatList>(null);
  const [listVisible, setListVisible] = useState(false);
  const initialAnchorDoneRef = useRef(false);
  const pendingScrollToEndRef = useRef(false);

  useEffect(() => {
    initialAnchorDoneRef.current = false;
    pendingScrollToEndRef.current = false;
    setListVisible(false);
  }, [resetKey]);

  const anchorToBottom = useCallback((animated: boolean) => {
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const revealList = useCallback(() => {
    requestAnimationFrame(() => setListVisible(true));
  }, []);

  const onContentSizeChange = useCallback(() => {
    if (initialAnchorDoneRef.current) {
      if (pendingScrollToEndRef.current) {
        anchorToBottom(false);
        pendingScrollToEndRef.current = false;
      }
      return;
    }

    if (messageCount === 0) {
      initialAnchorDoneRef.current = true;
      revealList();
      return;
    }

    anchorToBottom(false);
    initialAnchorDoneRef.current = true;
    revealList();
  }, [anchorToBottom, messageCount, revealList]);

  const scrollToEnd = useCallback(
    (animated = true) => {
      if (!initialAnchorDoneRef.current) {
        pendingScrollToEndRef.current = true;
        return;
      }
      if (animated) {
        requestAnimationFrame(() => anchorToBottom(true));
      } else {
        anchorToBottom(false);
      }
    },
    [anchorToBottom],
  );

  return {
    listRef,
    listVisible,
    listOpacityStyle: { opacity: listVisible ? 1 : 0 },
    onContentSizeChange,
    scrollToEnd,
    revealList,
    anchorToBottom,
    isAnchored: () => initialAnchorDoneRef.current,
  };
}
