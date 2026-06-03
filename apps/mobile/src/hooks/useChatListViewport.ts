import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

type Options = {
  /** 切换会话 / 话题时重置（避免沿用上一次滚动状态） */
  resetKey: string | undefined;
  /** 当前消息列表（仅需 id），用于搜索定位时查找目标行下标。 */
  messages: ReadonlyArray<{ id: string }>;
  /** 进入时要定位高亮的消息 id（搜索跳转）。 */
  scrollToMessageId?: string;
  /** 拖动开始时的额外副作用（如清除气泡文本选择）。 */
  onScrollBeginDrag?: () => void;
};

/** 距列表底部小于此像素即视为「在底部」，继续粘底跟随。 */
const STICK_BOTTOM_THRESHOLD = 80;
/** scrollToIndex 前等一帧，让目标行先完成布局，避免定位失败。 */
const SCROLL_TO_TARGET_DEFER_MS = 16;
/** scrollToIndex 失败（目标行未测量）后重试的延迟。 */
const SCROLL_TO_INDEX_RETRY_MS = 100;
/** 搜索定位后高亮闪烁时长。 */
const HIGHLIGHT_FLASH_MS = 2500;

type ScrollToIndexFailInfo = {
  index: number;
  highestMeasuredFrameIndex: number;
  averageItemLength: number;
};

/**
 * 聊天列表视口：进入对话稳稳落到最底部（最新消息），用户停留底部时让新消息 /
 * 流式文本自动跟随、上滑翻历史则不打扰；并统一承载「搜索跳转定位 + 高亮」。
 *
 * 粘底状态只由**用户滚动**驱动：onScroll 贯穿拖动与惯性，在列表真正静止时按落点
 * 离底距离判断是否粘底。自己发起的程序化滚动（anchorToBottom）会先打 programmatic
 * 标记、其 onScroll 被跳过，不污染判断。新内容是否跟随由 onContentSizeChange /
 * followIfStuck 按当前粘底状态决定。
 *
 * 把搜索定位、reveal 门控、onScrollToIndexFailed、滚动 handler 接线全收进 hook，
 * 各聊天屏只需把 `viewportListProps` 铺到 FlatList、读 `highlightMessageId`。
 */
export function useChatListViewport({
  resetKey,
  messages,
  scrollToMessageId,
  onScrollBeginDrag,
}: Options) {
  const listRef = useRef<FlatList>(null);
  const [listVisible, setListVisible] = useState(false);
  // 高亮从 null 起；只由搜索定位 effect 在真正跳转时点亮，避免「跳转前就先高亮 / 卸载前提前清」。
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const initialRevealDoneRef = useRef(false);
  // 搜索定位的一次性延迟定时器；仅卸载时清，不随 messages 变化被清掉。
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 是否「粘」在底部：进入对话默认粘底；用户上滑离底→松开；发送/显式回到底→重新粘上。
  const stickToBottomRef = useRef(true);
  // 标记「下一个 onScroll 是我们自己发起的程序化滚动」，跳过它对粘底状态的更新。
  const programmaticScrollRef = useRef(false);
  // 待定的搜索定位目标；定位完成或放弃后清空。置位时 onContentSizeChange 不锚底。
  const pendingScrollMessageIdRef = useRef<string | undefined>(scrollToMessageId);

  useEffect(() => {
    initialRevealDoneRef.current = false;
    stickToBottomRef.current = true;
    programmaticScrollRef.current = false;
    setListVisible(false);
  }, [resetKey]);

  const anchorToBottom = useCallback((animated: boolean) => {
    programmaticScrollRef.current = true;
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const revealList = useCallback(() => {
    requestAnimationFrame(() => setListVisible(true));
  }, []);

  // 搜索定位：把目标消息滚到视图中部并高亮一下；目标不在已加载页则放弃并揭示列表
  //（否则 onContentSizeChange 被 pending 永久 gate 住、列表停在 opacity:0 整屏空白）。
  useEffect(() => {
    const targetId = pendingScrollMessageIdRef.current;
    // 消息未加载完先不消费 pending，等下一轮（messages 变化重跑）；目标消费后置空，重跑即早返回。
    if (!targetId || messages.length === 0) return;
    const idx = messages.findIndex((m) => m.id === targetId);
    pendingScrollMessageIdRef.current = undefined;
    if (idx < 0) {
      // 目标不在已加载页：放弃定位，仍揭示列表（否则 onContentSizeChange 被 pending gate 住、整屏空白）。
      revealList();
      return;
    }
    stickToBottomRef.current = false; // 别被后续内容布局重锚拽回底部
    setHighlightMessageId(targetId);
    // 一次性延迟定位：存进 ref、不在此 effect 的 cleanup 里清 —— 否则 16ms 内来一条消息
    // （轮询/流式）就会把跳转取消掉。仅卸载时清（见下）。
    jumpTimerRef.current = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.45 });
      revealList();
    }, SCROLL_TO_TARGET_DEFER_MS);
  }, [messages, revealList]);

  // 高亮闪一下后清除：键控在 highlightMessageId 上，**不随 messages 变化重跑** ——
  // 否则轮询/流式一来就把清除定时器清掉、重排不上，高亮会永久卡住。
  useEffect(() => {
    if (!highlightMessageId) return;
    const clear = setTimeout(() => setHighlightMessageId(null), HIGHLIGHT_FLASH_MS);
    return () => clearTimeout(clear);
  }, [highlightMessageId]);

  // 卸载时清理一次性定位定时器。
  useEffect(
    () => () => {
      if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current);
    },
    [],
  );

  const onContentSizeChange = useCallback(() => {
    // 有待定的搜索跳转 → 先别锚底/揭示，交给定位 effect 处理。
    if (pendingScrollMessageIdRef.current) return;
    // 内容撑高（首屏分批布局、新消息、流式增长）时：仅当用户仍粘底才跟随到底。
    if (stickToBottomRef.current) {
      anchorToBottom(false);
    }
    if (!initialRevealDoneRef.current) {
      initialRevealDoneRef.current = true;
      revealList();
    }
  }, [anchorToBottom, revealList]);

  const scrollToEnd = useCallback(() => {
    // 显式回到底（自己发消息、AI 占位等用户主动动作）：重新粘底，并滚下去。
    stickToBottomRef.current = true;
    if (!initialRevealDoneRef.current) {
      return; // 首屏尚未揭示：交给 onContentSizeChange 落底即可。
    }
    requestAnimationFrame(() => anchorToBottom(false));
  }, [anchorToBottom]);

  /** 自动跟随（流式打字机 tick、轮询新消息）：仅当仍粘底才跟到底，不强制粘底。 */
  const followIfStuck = useCallback(() => {
    if (stickToBottomRef.current) {
      anchorToBottom(false);
    }
  }, [anchorToBottom]);

  /** 用户开始拖动：用户接管 —— 清程序化标记、先松开粘底（onScroll 会按落点重算）。 */
  const handleScrollBeginDrag = useCallback(() => {
    programmaticScrollRef.current = false;
    stickToBottomRef.current = false;
    onScrollBeginDrag?.();
  }, [onScrollBeginDrag]);

  /** FlatList onScroll：跳过自己发起的程序化滚动，其余按离底距离更新粘底状态。 */
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
      return;
    }
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    stickToBottomRef.current = distanceFromBottom < STICK_BOTTOM_THRESHOLD;
  }, []);

  const handleScrollToIndexFailed = useCallback((info: ScrollToIndexFailInfo) => {
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0.45 });
    }, SCROLL_TO_INDEX_RETRY_MS);
  }, []);

  return {
    listRef,
    listOpacityStyle: { opacity: listVisible ? 1 : 0 },
    highlightMessageId,
    scrollToEnd,
    followIfStuck,
    /** 直接铺到 FlatList 上的视口相关 props（滚动跟随 + 搜索定位）。 */
    viewportListProps: {
      onContentSizeChange,
      onScrollBeginDrag: handleScrollBeginDrag,
      onScroll: handleScroll,
      scrollEventThrottle: 32,
      onScrollToIndexFailed: handleScrollToIndexFailed,
    },
  };
}
