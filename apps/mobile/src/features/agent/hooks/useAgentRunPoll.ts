import { useCallback, useSyncExternalStore } from 'react';
import {
  EMPTY_RUN_SNAPSHOT,
  getRunSnapshot,
  subscribeRun,
  type RunSnapshot,
} from '../runStore';

/**
 * M6 T1b 增量 long-poll;W1a 起轮询与状态由共享 runStore 承载:
 * 同 runId 多消费方(聊天卡/ask_user 卡/详情屏)共享一条 long-poll 与一份缓存,
 * 重挂载即时渲染缓存,跨屏状态一致;后台自动暂停。接口与旧版完全兼容。
 */
export function useAgentRunPoll(runId: string | null): RunSnapshot {
  const subscribe = useCallback(
    (onChange: () => void) => (runId ? subscribeRun(runId, onChange) : () => {}),
    [runId],
  );
  const getSnapshot = useCallback(
    () => (runId ? getRunSnapshot(runId) : EMPTY_RUN_SNAPSHOT),
    [runId],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
