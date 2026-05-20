import type {
  LlmRequestLogContext,
  MemoryCategory,
  MemoryIntentSlots,
  MemoryScope,
} from '@xzz/shared';
import { DEFAULT_TASK_PROFILES } from '@xzz/shared';
import { chatCompletionRaw, type ChatMessageInput } from './deepseek.js';

export type MemoryExtractResult = {
  kind: 'remember' | 'correct' | 'forget' | 'none';
  scope: MemoryScope;
  content: string;
  title: string;
  explicitGlobal: boolean;
  category: MemoryCategory;
};

export async function extractMemoryIntent(
  apiKey: string,
  text: string,
  defaultScope: MemoryScope,
  log?: LlmRequestLogContext,
): Promise<MemoryExtractResult> {
  const profile = DEFAULT_TASK_PROFILES.memory_extract;
  const system = `你是记忆提炼助手。根据用户一句话判断意图并提炼要记住/修正的事实。
输出单独一行 JSON，不要代码块：
{"kind":"remember|correct|forget|none","scope":"user|session|topic","title":"短标题","content":"提炼后的事实","explicitGlobal":false,"category":"user_profile|project_note|general"}
规则：
- 「记住」「别忘了」→ remember
- 「记错了」「应该是」→ correct，content 写正确事实
- 「别再说」「忘掉」→ forget，content 可简述要压制的内容
- 若用户说「记住到全局/长期」→ scope=user, explicitGlobal=true
- category: user_profile=关于用户偏好/称呼/语气；project_note=项目/技术/工作流；general=其它
- 跳过琐碎、一次性、易搜索的常识 → kind=none
- 普通聊天 → kind=none
- 默认 scope 为 ${defaultScope}`;

  const raw = await chatCompletionRaw(
    apiKey,
    [
      { role: 'system', content: system },
      { role: 'user', content: text },
    ] as ChatMessageInput[],
    {
      maxTokens: profile.maxTokens,
      temperature: profile.temperature,
      log,
    },
  );

  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  try {
    const parsed = JSON.parse(line ?? '{}') as {
      kind?: string;
      scope?: MemoryScope;
      title?: string;
      content?: string;
      explicitGlobal?: boolean;
      category?: MemoryCategory;
    };
    const kind =
      parsed.kind === 'remember' ||
      parsed.kind === 'correct' ||
      parsed.kind === 'forget'
        ? parsed.kind
        : 'none';
    const category =
      parsed.category === 'user_profile' || parsed.category === 'project_note'
        ? parsed.category
        : 'general';
    return {
      kind,
      scope: parsed.explicitGlobal ? 'user' : (parsed.scope ?? defaultScope),
      content: String(parsed.content ?? '').trim(),
      title: String(parsed.title ?? '记忆').trim() || '记忆',
      explicitGlobal: Boolean(parsed.explicitGlobal),
      category,
    };
  } catch {
    return {
      kind: 'none',
      scope: defaultScope,
      content: '',
      title: '记忆',
      explicitGlobal: false,
      category: 'general',
    };
  }
}

export function slotsFromExtract(
  extract: MemoryExtractResult,
  targetFragmentId?: string,
): MemoryIntentSlots {
  return {
    scope: extract.scope,
    content: extract.content,
    targetFragmentId,
    explicitGlobal: extract.explicitGlobal,
    category: extract.category,
  };
}
