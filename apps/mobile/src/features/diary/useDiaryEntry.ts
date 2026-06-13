import { useCallback, useEffect, useState } from 'react';
import type { DiaryEntry, DiaryScope } from '@xzz/shared';
import { api } from '../../lib/api';
import { localDayWindow } from '../../lib/diaryDay';

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface UseDiaryEntry {
  entry: DiaryEntry | null;
  loading: boolean;
  /** 生成/矫正/确认进行中 */
  busy: boolean;
  error: string | null;
  /** 生成(或重生成)当天日记 */
  generate: () => Promise<void>;
  /** 跟 bow wow 聊着改:按 instruction 重写;空则 no-op */
  refine: (instruction: string) => Promise<void>;
  /** 确认这篇(self 篇会蒸馏进记忆) */
  confirm: () => Promise<void>;
}

/**
 * 单日日记的状态机(供日记屏用):挂载时拉取该天篇(404=该天还没生成,entry 留 null);
 * generate 用本地时区窗口拉取当天对话生成;refine/confirm 走对应端点。各动作期间 busy。
 */
export function useDiaryEntry(scope: DiaryScope, scopeId: string, dayKey: string): UseDiaryEntry {
  const [entry, setEntry] = useState<DiaryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    api
      .getDiary(scope, scopeId, dayKey)
      .then((res) => {
        if (mounted) setEntry(res.data);
      })
      .catch((e: unknown) => {
        if (!mounted) return;
        // 404 = 该天还没有日记,正常状态(entry 留 null,UI 展示「生成今天的日记」)
        if ((e as { status?: number })?.status === 404) setEntry(null);
        else setError(errText(e));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [scope, scopeId, dayKey]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { dayStartIso, dayEndIso } = localDayWindow(dayKey);
      const res = await api.generateDiary(scope, scopeId, dayKey, dayStartIso, dayEndIso);
      setEntry(res.data);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }, [scope, scopeId, dayKey]);

  const refine = useCallback(
    async (instruction: string) => {
      if (!instruction.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const res = await api.refineDiary(scope, scopeId, dayKey, instruction.trim());
        setEntry(res.data);
      } catch (e) {
        setError(errText(e));
      } finally {
        setBusy(false);
      }
    },
    [scope, scopeId, dayKey],
  );

  const confirm = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.confirmDiary(scope, scopeId, dayKey);
      setEntry(res.data);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }, [scope, scopeId, dayKey]);

  return { entry, loading, busy, error, generate, refine, confirm };
}
