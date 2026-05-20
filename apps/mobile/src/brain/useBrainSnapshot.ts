import { useCallback, useState } from 'react';
import {
  MEMORY_PROJECT_NOTE_CHAR_LIMIT,
  MEMORY_SHORT_TERM_CHAR_LIMIT,
  MEMORY_USER_PROFILE_CHAR_LIMIT,
  MEMORY_USER_SCOPE_CHAR_BUDGET,
  isPersonaCustomized,
} from '@xzz/shared';
import type { MemoryCategory, MemoryFragment } from '@xzz/shared';
import { api } from '../lib/api';

export type BrainSnapshot = {
  personaCustomized: boolean;
  longMemoryCount: number;
  shortMemoryCount: number;
  reviewCount: number;
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
      const [personaRes, longRes, sessionRes, topicRes, reviewRes, logsRes, settingsRes] =
        await Promise.all([
          api.getPersona().catch(() => null),
          api.listMemories({ scope: 'user', includeSuppressed: true }).catch(() => ({ data: [] })),
          api.listMemories({ scope: 'session', includeSuppressed: true }).catch(() => ({ data: [] })),
          api.listMemories({ scope: 'topic', includeSuppressed: true }).catch(() => ({ data: [] })),
          api.listMemoryReview(50).catch(() => ({ data: [] })),
          api.listLlmLogs(30).catch(() => ({ data: [] })),
          api.getMemorySettings().catch(() => ({ data: { autoExtractEnabled: false } })),
        ]);

      const long = longRes.data;
      const short = [...sessionRes.data, ...topicRes.data];

      setSnapshot({
        personaCustomized: personaRes ? isPersonaCustomized(personaRes.data) : false,
        longMemoryCount: long.length,
        shortMemoryCount: short.length,
        reviewCount: reviewRes.data.length,
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
