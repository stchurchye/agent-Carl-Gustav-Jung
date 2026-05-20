import type { LlmRequestLogContext, MemoryCategory, MemoryScope } from '@xzz/shared';
import { DEFAULT_TASK_PROFILES, parsePreCompactCandidates } from '@xzz/shared';
import { chatCompletionRaw, type ChatMessageInput } from './deepseek.js';
import * as intel from '../store/pg-intelligence.js';
import { consolidateUserMemoriesIfNeeded } from './memoryConsolidate.js';

export type PreCompactMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type PreCompactSalvageCandidate = {
  title: string;
  content: string;
  scope: MemoryScope;
  category: MemoryCategory;
};

/** 压缩前抢救：从即将被摘要丢弃的对话里提炼关键事实 */
export async function extractPreCompactMemories(
  apiKey: string,
  messages: PreCompactMessage[],
  log?: LlmRequestLogContext,
): Promise<PreCompactSalvageCandidate[]> {
  if (messages.length < 2) return [];

  const transcript = messages
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n');

  const profile = DEFAULT_TASK_PROFILES.memory_auto_extract;
  const system = `以下对话即将被压缩成摘要，请抢救 0～2 条若丢失会妨碍后续协作的关键事实。
输出单独一行 JSON：
{"candidates":[{"title":"短标题","content":"事实","category":"user_profile|project_note|general"}]}
规则：
- 只保留摘要里不易覆盖的：偏好、决定、约定、项目事实
- 跳过已在摘要中显然会保留的内容
- 无则 candidates: []`;

  const raw = await chatCompletionRaw(
    apiKey,
    [
      { role: 'system', content: system },
      { role: 'user', content: transcript },
    ] as ChatMessageInput[],
    {
      maxTokens: profile.maxTokens,
      temperature: 0,
      log,
    },
  );

  return parsePreCompactCandidates(raw).map((c) => ({
    ...c,
    scope: 'session' as const,
  }));
}

export async function salvageMemoriesBeforeCompact(params: {
  apiKey: string;
  userId: string;
  messages: PreCompactMessage[];
  scope: MemoryScope;
  sessionId?: string | null;
  groupId?: string | null;
  topicId?: string | null;
  log?: LlmRequestLogContext;
}): Promise<number> {
  const settings = await intel.getUserMemorySettings(params.userId);
  if (!settings.autoExtractEnabled) return 0;

  const candidates = await extractPreCompactMemories(
    params.apiKey,
    params.messages,
    params.log,
  );
  if (candidates.length === 0) return 0;

  let saved = 0;
  for (const c of candidates) {
    const scope = params.scope;
    const content = c.content;
    if (scope === 'user' && params.apiKey) {
      await consolidateUserMemoriesIfNeeded(
        params.apiKey,
        params.userId,
        content.length,
        params.log,
      );
    }
    await intel.createMemoryFragment({
      userId: params.userId,
      scope,
      sessionId: scope === 'session' ? params.sessionId ?? null : null,
      groupId: scope === 'topic' ? params.groupId ?? null : null,
      topicId: scope === 'topic' ? params.topicId ?? null : null,
      title: c.title,
      content,
      category: c.category,
      status: 'active',
      source: 'ai',
    });
    saved += 1;
  }
  return saved;
}
