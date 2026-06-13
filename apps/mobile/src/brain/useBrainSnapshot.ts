import { useCallback, useEffect, useState } from 'react';
import {
  MEMORY_PROJECT_NOTE_CHAR_LIMIT,
  MEMORY_SHORT_TERM_CHAR_LIMIT,
  MEMORY_USER_PROFILE_CHAR_LIMIT,
  MEMORY_USER_SCOPE_CHAR_BUDGET,
  isPersonaCustomized,
} from '@xzz/shared';
import type { MemoryCategory, MemoryFragment } from '@xzz/shared';
import { api, type TopicSkill, type AgentMemoryItem } from '../lib/api';
import { loadPersona } from '../lib/personaStore';

export type BrainSnapshot = {
  personaCustomized: boolean;
  longMemoryCount: number;
  shortMemoryCount: number;
  reviewCount: number;
  pendingSkillCount: number;
  pendingEpisodicCount: number;
  llmLogCount: number;
  autoExtractEnabled: boolean;
  profileChars: number;
  projectChars: number;
  shortChars: number;
  totalUserChars: number;
};

function sumChars(items: MemoryFragment[]): number {
  return items.reduce((n, f) => n + (f.content?.length ?? 0), 0);
}

function sumByCategory(items: MemoryFragment[], cat: MemoryCategory): number {
  return sumChars(items.filter((f) => f.category === cat));
}

// 模块级缓存:在 BrainHub 的多次进出之间保持上次结果,消除进入时的白屏闪烁。
let _cache: BrainSnapshot | null = null;
// 在途请求去重:避免 prefetch 和 useFocusEffect refresh 并发发两次请求。
let _inFlight: Promise<BrainSnapshot | null> | null = null;
// 代数:invalidate(登出/换用户)时自增。写回 _cache 前校验代数,
// 既防换用户后看到上个用户的记忆计数(跨用户泄露),也防旧用户的在途请求迟到后覆盖新用户缓存。
// 与 personaStore 的 epoch 同一套路。
let _epoch = 0;

async function doFetch(): Promise<BrainSnapshot | null> {
  // 每路独立降级(单个端点抖动不该让整页空白),同时计失败数:
  // 全部失败 → 返回 null 让上层显示「加载失败」,而不是一份全 0 的假快照。
  let failures = 0;
  const fail = <T>(fallback: T) => (): T => {
    failures += 1;
    return fallback;
  };

  const [personaRes, longRes, sessionRes, topicRes, reviewRes, logsRes, settingsRes, skillsRes, episodicPendingRes] =
    await Promise.all([
      loadPersona().catch(fail<Awaited<ReturnType<typeof loadPersona>> | null>(null)),
      api.listMemories({ scope: 'user', includeSuppressed: true }).catch(fail({ data: [] as MemoryFragment[] })),
      api.listMemories({ scope: 'session', includeSuppressed: true }).catch(fail({ data: [] as MemoryFragment[] })),
      api.listMemories({ scope: 'topic', includeSuppressed: true }).catch(fail({ data: [] as MemoryFragment[] })),
      api.listMemoryReview(50).catch(fail({ data: [] })),
      api.listLlmLogs(30).catch(fail({ data: [] })),
      api.getMemorySettings().catch(fail({ data: { autoExtractEnabled: false } })),
      api.listSkills().catch(fail({ data: { skills: [] as TopicSkill[] } })),
      api.listAgentMemory('pending').catch(fail({ data: { items: [] as AgentMemoryItem[] } })),
    ]);

  if (failures === 9) return null;

  const long = longRes.data;
  const short = [...sessionRes.data, ...topicRes.data];

  return {
    personaCustomized: personaRes ? isPersonaCustomized(personaRes) : false,
    longMemoryCount: long.length,
    shortMemoryCount: short.length,
    reviewCount: reviewRes.data.length,
    pendingSkillCount: skillsRes.data.skills.filter((s) => !s.enabled).length,
    pendingEpisodicCount: episodicPendingRes.data.items.length,
    llmLogCount: logsRes.data.length,
    autoExtractEnabled: settingsRes.data.autoExtractEnabled,
    profileChars: sumByCategory(long, 'user_profile'),
    projectChars: sumByCategory(long, 'project_note') + sumByCategory(long, 'general'),
    shortChars: sumChars(short),
    totalUserChars: sumChars(long),
  };
}

/** 首页 mount 时调用;已有缓存或在途请求则静默跳过。 */
export function prefetchBrainSnapshot(): void {
  if (_cache !== null || _inFlight !== null) return;
  const startedEpoch = _epoch;
  _inFlight = doFetch()
    .then((s) => {
      // 期间发生过 invalidate(登出/换用户)→ 丢弃,不把旧用户数据写回缓存
      if (_epoch === startedEpoch && s !== null) _cache = s;
      _inFlight = null;
      return _epoch === startedEpoch ? s : null;
    })
    .catch(() => { _inFlight = null; return null; });
}

/**
 * 失效缓存(登出 / 换用户时调用):清空缓存并自增代数,
 * 让在途的旧用户请求结果作废,避免下个用户看到上个用户的记忆/技能/日志计数。
 */
export function invalidateBrainSnapshot(): void {
  _epoch += 1;
  _inFlight = null;
  _cache = null;
}

export function useBrainSnapshot() {
  // 有缓存时立刻用缓存渲染,无需等待 → 消除进入时闪烁。
  const [snapshot, setSnapshot] = useState<BrainSnapshot | null>(() => _cache);
  const [loading, setLoading] = useState(() => _cache === null);
  const [error, setError] = useState<string | null>(null);

  // 若 prefetch 正在途中,订阅其结果;避免组件挂载前完成的 prefetch 被漏掉。
  useEffect(() => {
    if (_inFlight !== null && _cache === null) {
      void _inFlight.then((s) => {
        if (s !== null) { setSnapshot(s); setLoading(false); }
      });
    }
  }, []);

  const refresh = useCallback(async () => {
    // 有缓存时后台静默刷新,不闪 loading;无缓存时才显示加载态。
    if (_cache === null) setLoading(true);
    setError(null);
    const startedEpoch = _epoch;
    try {
      // 复用在途请求(prefetch 还没结束时无需另发)
      const result = await (_inFlight ?? doFetch());
      // 期间换了用户(invalidate)→ 这次结果作废,交给新用户的刷新
      if (_epoch !== startedEpoch) return;
      if (result !== null) {
        _cache = result;
        setSnapshot(result);
      } else {
        // 全部请求失败:无缓存时显示加载失败,有缓存时保留旧值不打断
        setError('加载失败');
        if (_cache === null) setSnapshot(null);
      }
    } catch {
      if (_epoch !== startedEpoch) return;
      setError('加载失败');
      if (_cache === null) setSnapshot(null);
    } finally {
      if (_epoch === startedEpoch) setLoading(false);
    }
  }, []);

  return {
    snapshot,
    loading,
    error,
    refresh,
    limits: {
      profile: MEMORY_USER_PROFILE_CHAR_LIMIT,
      project: MEMORY_PROJECT_NOTE_CHAR_LIMIT,
      short: MEMORY_SHORT_TERM_CHAR_LIMIT,
      total: MEMORY_USER_SCOPE_CHAR_BUDGET,
    },
  };
}
