import type { LlmRequestLogContext, MemoryCategory } from '@xzz/shared';
import {
  DEFAULT_TASK_PROFILES,
  MEMORY_USER_SCOPE_CHAR_BUDGET,
} from '@xzz/shared';
import { chatCompletionRaw, type ChatMessageInput } from './deepseek.js';
import * as intel from '../store/pg-intelligence.js';

/** @deprecated 使用 MEMORY_USER_SCOPE_CHAR_BUDGET */
export const USER_SCOPE_CHAR_BUDGET = MEMORY_USER_SCOPE_CHAR_BUDGET;

export type ConsolidateAction =
  | { action: 'delete'; fragmentId: string }
  | {
      action: 'replace';
      fragmentId: string;
      title: string;
      content: string;
      category?: MemoryCategory;
    };

export async function consolidateUserMemoriesIfNeeded(
  apiKey: string,
  userId: string,
  incomingChars: number,
  log?: LlmRequestLogContext,
): Promise<void> {
  const current = await intel.sumUserScopeMemoryChars(userId);
  if (current + incomingChars <= MEMORY_USER_SCOPE_CHAR_BUDGET) return;

  const fragments = await intel.listMemoryFragments(userId, 'user', {
    withContent: true,
    limit: 40,
  });

  const catalog = fragments.map((f) => ({
    id: f.id,
    category: f.category,
    title: f.title,
    content: (f.content ?? '').slice(0, 200),
  }));

  const profile = DEFAULT_TASK_PROFILES.memory_consolidate;
  const system = `你是记忆整理助手。用户长期记忆超出容量，请合并重复、删除过时条目。
输出单独一行 JSON，不要代码块：
{"actions":[{"action":"delete","fragmentId":"..."},{"action":"replace","fragmentId":"...","title":"...","content":"...","category":"user_profile|project_note|general"}]}
规则：
- 合并多条相似内容为一条更短的 replace
- 删除明显过时或重复的 delete
- 保留最重要的事实
- 目标：整理后总字数比当前少至少 20%`;

  const raw = await chatCompletionRaw(
    apiKey,
    [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `当前条目（JSON）：${JSON.stringify(catalog)}\n需要腾出约 ${current + incomingChars - MEMORY_USER_SCOPE_CHAR_BUDGET} 字符。`,
      },
    ] as ChatMessageInput[],
    {
      maxTokens: profile.maxTokens,
      temperature: profile.temperature,
      log: log ? { ...log, channel: 'memory_extract' } : undefined,
    },
  );

  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();

  try {
    const parsed = JSON.parse(line ?? '{}') as {
      actions?: ConsolidateAction[];
    };
    for (const act of parsed.actions ?? []) {
      if (act.action === 'delete') {
        await intel.setMemoryFragmentStatus(userId, act.fragmentId, 'deleted');
      } else if (act.action === 'replace' && act.content?.trim()) {
        await intel.appendMemoryVersion({
          userId,
          fragmentId: act.fragmentId,
          content: act.content.trim(),
          source: 'ai',
        });
      }
    }
  } catch {
    /* 整理失败不阻断写入 */
  }
}
