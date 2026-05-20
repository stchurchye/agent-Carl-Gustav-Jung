import type { LlmRequestLogContext, MemoryCategory, MemoryScope } from '@xzz/shared';
import {
  DEFAULT_TASK_PROFILES,
  messagesFingerprint,
  parseAutoExtractCandidates,
} from '@xzz/shared';
import { chatCompletionRaw, type ChatMessageInput } from './deepseek.js';
import * as intel from '../store/pg-intelligence.js';
import * as pg from '../store/pg.js';
import * as social from '../store/pg-social.js';
import { consolidateUserMemoriesIfNeeded } from './memoryConsolidate.js';

export { messagesFingerprint };

export type AutoExtractCandidate = {
  title: string;
  content: string;
  scope: MemoryScope;
  category: MemoryCategory;
  confidence: number;
};

export async function extractSessionMemoryCandidates(
  apiKey: string,
  userId: string,
  sessionId: string,
  log?: LlmRequestLogContext,
): Promise<AutoExtractCandidate[]> {
  const messages = await pg.getChatMessages(userId, sessionId);
  const recent = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-20);

  if (recent.length < 4) return [];

  const transcript = recent
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n');

  const profile = DEFAULT_TASK_PROFILES.memory_auto_extract;
  const system = `从对话中提炼 0～3 条值得长期记住的事实（偏好、项目背景、习惯）。
输出单独一行 JSON，不要代码块：
{"candidates":[{"title":"短标题","content":"事实","scope":"user|session","category":"user_profile|project_note|general","confidence":0.0-1.0}]}
规则：
- 跳过琐碎、一次性调试、易搜索的常识
- user_profile：称呼、语气偏好、个人习惯
- project_note：项目结构、技术栈、工作流约定
- 明确「记住」「以后都」→ confidence≥0.85
- 无值得记住的 → candidates: []`;

  const raw = await chatCompletionRaw(
    apiKey,
    [
      { role: 'system', content: system },
      { role: 'user', content: transcript },
    ] as ChatMessageInput[],
    {
      maxTokens: profile.maxTokens,
      temperature: profile.temperature,
      log,
    },
  );

  return parseAutoExtractCandidates(raw, { defaultScope: 'session' });
}

async function persistAutoExtractCandidates(
  params: {
    apiKey: string;
    userId: string;
    sessionId?: string;
    groupId?: string;
    topicId?: string;
    log?: LlmRequestLogContext;
  },
  candidates: AutoExtractCandidate[],
): Promise<number> {
  let created = 0;
  for (const c of candidates) {
    if (c.scope === 'user') {
      await consolidateUserMemoriesIfNeeded(
        params.apiKey,
        params.userId,
        c.content.length,
        params.log,
      );
    }
    await intel.createMemoryFragment({
      userId: params.userId,
      scope: c.scope,
      sessionId: c.scope === 'session' ? (params.sessionId ?? null) : null,
      groupId: c.scope === 'topic' ? (params.groupId ?? null) : null,
      topicId: c.scope === 'topic' ? (params.topicId ?? null) : null,
      title: c.title,
      content: c.content,
      category: c.category,
      status: 'active',
      source: 'ai',
    });
    created += 1;
  }
  return created;
}

export async function runSessionAutoExtract(params: {
  apiKey: string;
  userId: string;
  sessionId: string;
  log?: LlmRequestLogContext;
}): Promise<{ created: number }> {
  const settings = await intel.getUserMemorySettings(params.userId);
  if (!settings.autoExtractEnabled) {
    return { created: 0 };
  }

  const candidates = await extractSessionMemoryCandidates(
    params.apiKey,
    params.userId,
    params.sessionId,
    params.log,
  );

  const created = await persistAutoExtractCandidates(
    {
      apiKey: params.apiKey,
      userId: params.userId,
      sessionId: params.sessionId,
      log: params.log,
    },
    candidates,
  );

  return { created };
}

export async function extractTopicMemoryCandidates(
  apiKey: string,
  userId: string,
  groupId: string,
  topicId: string,
  log?: LlmRequestLogContext,
): Promise<AutoExtractCandidate[]> {
  const messages =
    (await social.listGroupMessages(userId, groupId, topicId, { limit: 200 })) ?? [];
  const recent = messages
    .filter((m) => m.kind === 'human' || m.kind === 'ai')
    .slice(-20);

  if (recent.length < 4) return [];

  const transcript = recent
    .map((m) => {
      const who = m.kind === 'ai' ? '助手' : '成员';
      return `${who}: ${m.content}`;
    })
    .join('\n');

  const profile = DEFAULT_TASK_PROFILES.memory_auto_extract;
  const system = `从群话题对话中提炼 0～3 条值得记住的事实（偏好、项目背景、习惯）。
输出单独一行 JSON：
{"candidates":[{"title":"短标题","content":"事实","scope":"user|topic","category":"user_profile|project_note|general","confidence":0.0-1.0}]}
规则：
- scope=topic 表示仅本话题；明确长期有效 → scope=user
- 跳过琐碎内容；无则 candidates: []`;

  const raw = await chatCompletionRaw(
    apiKey,
    [
      { role: 'system', content: system },
      { role: 'user', content: transcript },
    ] as ChatMessageInput[],
    {
      maxTokens: profile.maxTokens,
      temperature: profile.temperature,
      log,
    },
  );

  return parseAutoExtractCandidates(raw, { defaultScope: 'topic' });
}

export async function runTopicAutoExtract(params: {
  apiKey: string;
  userId: string;
  groupId: string;
  topicId: string;
  log?: LlmRequestLogContext;
}): Promise<{ created: number }> {
  const settings = await intel.getUserMemorySettings(params.userId);
  if (!settings.autoExtractEnabled) {
    return { created: 0 };
  }

  const candidates = await extractTopicMemoryCandidates(
    params.apiKey,
    params.userId,
    params.groupId,
    params.topicId,
    params.log,
  );

  const created = await persistAutoExtractCandidates(
    {
      apiKey: params.apiKey,
      userId: params.userId,
      groupId: params.groupId,
      topicId: params.topicId,
      log: params.log,
    },
    candidates,
  );

  return { created };
}
