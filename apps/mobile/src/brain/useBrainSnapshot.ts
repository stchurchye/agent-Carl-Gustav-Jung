import { useCallback, useState } from 'react';
import {
  MEMORY_PROJECT_NOTE_CHAR_LIMIT,
  MEMORY_SHORT_TERM_CHAR_LIMIT,
  MEMORY_USER_PROFILE_CHAR_LIMIT,
  MEMORY_USER_SCOPE_CHAR_BUDGET,
  isPersonaCustomized,
} from '@xzz/shared';
import type { MemoryCategory, MemoryFragment } from '@xzz/shared';
import { api, type TopicSkill, type AgentMemoryItem } from '../lib/api';

export type BrainSnapshot = {
  personaCustomized: boolean;
  longMemoryCount: number;
  shortMemoryCount: number;
  reviewCount: number;
  /** M5 polish：待评审的自蒸馏建议技能数(enabled=false)——hub 卡片 badge,驱动评审闭环。 */
  pendingSkillCount: number;
  /** M5 polish：待审情景记忆数(status=pending)——hub 卡片 badge。 */
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

export function useBrainSnapshot() {
  const [snapshot, setSnapshot] = useState<BrainSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [personaRes, longRes, sessionRes, topicRes, reviewRes, logsRes, settingsRes, skillsRes, episodicPendingRes] =
        await Promise.all([
          api.getPersona().catch(() => null),
          api.listMemories({ scope: 'user', includeSuppressed: true }).catch(() => ({ data: [] })),
          api.listMemories({ scope: 'session', includeSuppressed: true }).catch(() => ({ data: [] })),
          api.listMemories({ scope: 'topic', includeSuppressed: true }).catch(() => ({ data: [] })),
          api.listMemoryReview(50).catch(() => ({ data: [] })),
          api.listLlmLogs(30).catch(() => ({ data: [] })),
          api.getMemorySettings().catch(() => ({ data: { autoExtractEnabled: false } })),
          // M5 polish：待审技能 / 待审情景记忆计数(各自 fail-open,不拖累整张快照)。
          api.listSkills().catch(() => ({ data: { skills: [] as TopicSkill[] } })),
          api.listAgentMemory('pending').catch(() => ({ data: { items: [] as AgentMemoryItem[] } })),
        ]);

      const long = longRes.data;
      const short = [...sessionRes.data, ...topicRes.data];

      setSnapshot({
        personaCustomized: personaRes ? isPersonaCustomized(personaRes.data) : false,
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
      });
    } catch {
      setError('加载失败');
      setSnapshot(null);
    } finally {
      setLoading(false);
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
