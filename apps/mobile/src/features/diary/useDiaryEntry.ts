import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiaryEntry, DiaryScope } from '@xzz/shared';
import { api } from '../../lib/api';
import { localDayWindow } from '../../lib/diaryDay';

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface UseDiaryEntry {
  entry: DiaryEntry | null;
  loading: boolean;
  /** 首拉失败(非 404):区别于「该天还没生成」,UI 展示错误+重试而非生成按钮 */
  loadError: boolean;
  /** 生成/矫正/确认进行中 */
  busy: boolean;
  /** 动作(生成/矫正/确认)错误;首拉错误见 loadError */
  error: string | null;
  /** 重新拉取当天篇(首拉失败后重试用) */
  reload: () => void;
  /** 清掉动作错误(如用户重新编辑矫正意见时) */
  clearError: () => void;
  /** 生成(或重生成)当天日记 */
  generate: () => Promise<void>;
  /** 跟 bow wow 聊着改:按 instruction 重写;空则 no-op。返回是否成功(供调用方决定是否清空输入) */
  refine: (instruction: string) => Promise<boolean>;
  /** 确认这篇(self 篇会蒸馏进记忆) */
  confirm: () => Promise<void>;
}

/**
 * 单日日记的状态机(供日记屏用):挂载时拉取该天篇(404=该天还没生成,entry 留 null;
 * 其它错误置 loadError,展示重试);generate 用本地时区窗口拉取当天对话生成;refine/confirm 走对应端点。
 * 各动作期间 busy(busyRef 同步防重入,disabled 之外再兜一层);卸载后不再 setState。
 */
export function useDiaryEntry(scope: DiaryScope, scopeId: string, dayKey: string): UseDiaryEntry {
  const [entry, setEntry] = useState<DiaryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  // 自增序号:只让「最新一次首拉」的结果落地,作废切天/卸载/重试时的在途请求
  const loadSeq = useRef(0);

  const load = useCallback(() => {
    const seq = (loadSeq.current += 1);
    setLoading(true);
    setLoadError(false);
    api
      .getDiary(scope, scopeId, dayKey)
      .then((res) => {
        if (seq === loadSeq.current) setEntry(res.data);
      })
      .catch((e: unknown) => {
        if (seq !== loadSeq.current) return;
        // 404 = 该天还没有日记,正常状态(entry 留 null,UI 展示「生成今天的日记」)
        if ((e as { status?: number })?.status === 404) setEntry(null);
        else setLoadError(true);
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoading(false);
      });
  }, [scope, scopeId, dayKey]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
      // 作废在途首拉,避免对已卸载/已切天的 hook setState
      loadSeq.current += 1;
    };
  }, [load]);

  const generate = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const { dayStartIso, dayEndIso } = localDayWindow(dayKey);
      const res = await api.generateDiary(scope, scopeId, dayKey, dayStartIso, dayEndIso);
      if (mountedRef.current) setEntry(res.data);
    } catch (e) {
      if (mountedRef.current) setError(errText(e));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [scope, scopeId, dayKey]);

  const refine = useCallback(
    async (instruction: string): Promise<boolean> => {
      if (!instruction.trim() || busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const res = await api.refineDiary(scope, scopeId, dayKey, instruction.trim());
        if (mountedRef.current) setEntry(res.data);
        return true;
      } catch (e) {
        if (mountedRef.current) setError(errText(e));
        return false;
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
    },
    [scope, scopeId, dayKey],
  );

  const confirm = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await api.confirmDiary(scope, scopeId, dayKey);
      if (mountedRef.current) setEntry(res.data);
    } catch (e) {
      if (mountedRef.current) setError(errText(e));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [scope, scopeId, dayKey]);

  const clearError = useCallback(() => setError(null), []);

  return {
    entry,
    loading,
    loadError,
    busy,
    error,
    reload: load,
    clearError,
    generate,
    refine,
    confirm,
  };
}
