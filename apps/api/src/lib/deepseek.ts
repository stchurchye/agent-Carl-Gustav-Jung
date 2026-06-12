import {
  chatPersonaForDialect,
  chatSessionTitlePromptForDialect,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL_PRO,
  writingPersonaForDialect,
  writingIntentPromptForDialect,
  writingDoneComment,
  writingRetryDoneComment,
  WRITING_RETRY_PROMPT,
  ACTION_PROMPTS,
  type LlmRequestLogContext,
  type ReplyDialect,
} from '@xzz/shared';
import { recordLlmRequest } from './llmRequestLog.js';
import { resolveModelProfile } from './llm/factory.js';

export type ChatMessageInput = { role: 'system' | 'user' | 'assistant'; content: string };

export class DeepSeekError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'DeepSeekError';
  }
}

function resolveApiKey(headerKey?: string | null): string | null {
  const fromHeader = headerKey?.trim();
  if (fromHeader) return fromHeader;
  const fromEnv = process.env.DEEPSEEK_API_KEY?.trim();
  return fromEnv || null;
}

export function getApiKeyFromRequest(headerKey?: string | null): string {
  const key = resolveApiKey(headerKey);
  if (!key) {
    throw new DeepSeekError('API_KEY_MISSING');
  }
  return key;
}

export function hasApiKeyConfigured(headerKey?: string | null): boolean {
  return Boolean(resolveApiKey(headerKey));
}

export async function chatCompletionRaw(
  apiKey: string,
  messages: ChatMessageInput[],
  options?: {
    maxTokens?: number;
    temperature?: number;
    log?: LlmRequestLogContext;
  },
): Promise<string> {
  const logCtx = options?.log;
  const model = DEEPSEEK_MODEL_PRO;
  // deepseek-v4-pro / reasoner 是 reasoning model，reasoning_tokens 计入 max_tokens；
  // 默认必须给足，否则长文会 finish_reason=length 截断（实测 2048 写 ~1800 字即被截）。
  // 复用 factory 的 per-model 预算表作单一来源（v4-pro→4096 / reasoner→8192）。
  const defaultMaxTokens = resolveModelProfile('deepseek', model).defaultMaxTokens;
  const started = Date.now();
  try {
    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        max_tokens: options?.maxTokens ?? defaultMaxTokens,
        temperature: options?.temperature ?? 0.7,
      }),
    });

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
      error?: { message?: string };
    };

    if (!res.ok) {
      const msg = json.error?.message ?? `DeepSeek 请求失败（${res.status}）`;
      throw new DeepSeekError(msg, res.status);
    }

    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new DeepSeekError('Bow Wow 没有返回内容，请再试一次');

    if (logCtx) {
      const promptTokens = json.usage?.prompt_tokens;
      const completionTokens = json.usage?.completion_tokens;
      const totalTokens =
        json.usage?.total_tokens ??
        (promptTokens != null && completionTokens != null
          ? promptTokens + completionTokens
          : 0);
      recordLlmRequest({
        ...logCtx,
        provider: 'deepseek',
        model,
        messages,
        responseText: content,
        usage: totalTokens > 0 ? { promptTokens, completionTokens, totalTokens } : undefined,
        responseTimeMs: Date.now() - started,
        status: 'ok',
      });
    }
    return content;
  } catch (e) {
    if (logCtx) {
      const msg = e instanceof Error ? e.message : String(e);
      recordLlmRequest({
        ...logCtx,
        provider: 'deepseek',
        model,
        messages,
        responseTimeMs: Date.now() - started,
        status: 'error',
        errorMessage: msg,
      });
    }
    throw e;
  }
}

/** 验证密钥是否可用 */
export async function verifyDeepSeekKey(apiKey: string): Promise<boolean> {
  await chatCompletionRaw(
    apiKey,
    [
      { role: 'system', content: '你是助手。' },
      { role: 'user', content: '请只回复：好的' },
    ],
    { maxTokens: 16, temperature: 0 },
  );
  return true;
}

/** 写作：续写 / 润色等 */
export async function deepseekWriting(params: {
  apiKey: string;
  action: string;
  oldText: string;
  instruction?: string;
  styleGuide?: string;
  dialect?: ReplyDialect;
  chapterTitle?: string;
  understandingScope?: 'chapter' | 'document';
  documentExcerpt?: string;
}): Promise<{ text: string; comment: string }> {
  const actionPrompt = ACTION_PROMPTS[params.action] ?? ACTION_PROMPTS['润色'];
  const isContinue = params.action === '续写';
  const useFullDoc = params.understandingScope === 'document';

  const system = `${writingPersonaForDialect(params.dialect)}

${actionPrompt}

要求：
- 每次只能修改「待改本段」的正文；其它段落仅供理解上下文，不得改写或输出其它段落内容。
${isContinue ? '- 只输出需要续写的新增段落，不要重复原文，不要加标题或说明' : '- 只输出修改后的完整段落正文，不要加标题、引号或解释'}
- 不要使用 markdown 格式`;

  const userParts = [
    params.styleGuide ? `写作风格：${params.styleGuide}` : '',
    params.chapterTitle ? `待改本段：${params.chapterTitle}` : '',
    useFullDoc
      ? '理解范围：可参考下方全篇节选理解上下文，但输出只能替换待改本段正文。'
      : '理解范围：仅根据待改本段正文理解，不要引用其它段落内容来改写。',
    `待改本段正文：\n${params.oldText || '（空）'}`,
    useFullDoc && params.documentExcerpt?.trim()
      ? `全篇节选（仅供理解，勿改其它段）：\n${params.documentExcerpt.trim()}`
      : '',
    params.instruction ? `用户补充：${params.instruction}` : '',
  ].filter(Boolean);

  const text = await chatCompletionRaw(params.apiKey, [
    { role: 'system', content: system },
    { role: 'user', content: userParts.join('\n\n') },
  ]);

  const merged = isContinue ? params.oldText + text : text;
  const comment = writingDoneComment(params.action, params.dialect);

  return { text: merged, comment };
}

/** 再改一版：保留初次要求 + 上一版改稿 + 历次/本轮补充意见 */
export async function deepseekWritingRetry(params: {
  apiKey: string;
  action: string;
  oldText: string;
  baseInstruction: string;
  previousSuggestion: string;
  additionalFeedback: string;
  priorFeedback?: string[];
  styleGuide?: string;
  dialect?: ReplyDialect;
}): Promise<{ text: string; comment: string }> {
  const actionPrompt = ACTION_PROMPTS[params.action] ?? ACTION_PROMPTS['润色'];
  const isContinue = params.action === '续写';

  const system = `${writingPersonaForDialect(params.dialect)}

${actionPrompt}

${WRITING_RETRY_PROMPT}
${isContinue ? '- 续写任务：在上一版改稿末尾继续写，只输出新增段落' : ''}`;

  const priorLines = (params.priorFeedback ?? [])
    .filter((line) => line.trim())
    .map((line, i) => `${i + 1}. ${line.trim()}`)
    .join('\n');

  const userParts = [
    params.styleGuide ? `写作风格：${params.styleGuide}` : '',
    `原文：\n${params.oldText || '（空）'}`,
    params.baseInstruction.trim()
      ? `初次改稿要求：\n${params.baseInstruction.trim()}`
      : '',
    `Bow Wow 上一版改稿：\n${params.previousSuggestion}`,
    priorLines ? `历次补充意见：\n${priorLines}` : '',
    `用户本轮补充意见：\n${params.additionalFeedback.trim()}`,
  ].filter(Boolean);

  const text = await chatCompletionRaw(params.apiKey, [
    { role: 'system', content: system },
    { role: 'user', content: userParts.join('\n\n') },
  ]);

  const merged = isContinue ? params.previousSuggestion + text : text;
  return {
    text: merged,
    comment: writingRetryDoneComment(params.dialect),
  };
}

export type WritingIntentResult = {
  displayText: string;
  action: string;
  instruction: string;
  ready: boolean;
};

export function parseIntentJson(raw: string): {
  displayText: string;
  action: string;
  instruction: string;
  ready: boolean;
} {
  const lines = raw.split('\n');
  const line = lines
    .map((l) => l.trim())
    .find((l) => l.startsWith('{') && l.endsWith('}'));
  if (!line) {
    return { displayText: raw.trim(), action: '润色', instruction: raw.trim(), ready: false };
  }
  // 按「整行等于 JSON 行」过滤,而不是 raw.replace(line,''):后者只删第一个匹配,
  // JSON 行重复出现时残余会原样展示给用户(review P2)。
  const displayText = lines
    .filter((l) => l.trim() !== line)
    .join('\n')
    .trim();
  try {
    const j = JSON.parse(line) as {
      action?: string;
      instruction?: string;
      ready?: boolean;
    };
    return {
      displayText: displayText || raw.trim(),
      action: j.action?.trim() || '润色',
      instruction: j.instruction?.trim() ?? '',
      ready: Boolean(j.ready),
    };
  } catch {
    return { displayText: raw.trim(), action: '润色', instruction: '', ready: false };
  }
}

/** 写作侧栏：理解改稿意图并生成确认话术 */
export async function deepseekWritingIntent(params: {
  apiKey: string;
  userMessage: string;
  articleExcerpt?: string;
  chapterTitle?: string;
  chapterContent?: string;
  documentExcerpt?: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  dialect?: ReplyDialect;
}): Promise<WritingIntentResult> {
  const chapterBlock = [
    params.chapterTitle ? `当前待改段：${params.chapterTitle}` : '',
    `本段内容：\n${params.chapterContent?.trim() || params.articleExcerpt?.trim() || '（本段尚无正文）'}`,
  ]
    .filter(Boolean)
    .join('\n');

  const docBlock = params.documentExcerpt?.trim()
    ? `全篇节选（供理解意图；实际改稿仍只改上面这一段）：\n${params.documentExcerpt.trim()}`
    : '';

  const messages: ChatMessageInput[] = [
    { role: 'system', content: writingIntentPromptForDialect(params.dialect) },
    ...params.history.slice(-12),
    {
      role: 'user',
      content: [chapterBlock, docBlock, `用户说：${params.userMessage}`].filter(Boolean).join('\n\n'),
    },
  ];
  const raw = await chatCompletionRaw(params.apiKey, messages, { temperature: 0.4 });
  const parsed = parseIntentJson(raw);
  return {
    displayText: parsed.displayText,
    action: parsed.action,
    instruction: parsed.instruction || params.userMessage,
    ready: parsed.ready,
  };
}

export function parseReplyDialect(_header?: string | null): ReplyDialect {
  return 'mandarin';
}

function sanitizeChatSessionTitle(raw: string, fallback: string): string {
  const line = raw
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return fallback;
  const cleaned = line
    .replace(/^["'「『【]|["'」』】]$/g, '')
    .replace(/[。．.!！?？…]+$/g, '')
    .trim()
    .slice(0, 32);
  return cleaned || fallback;
}

/** 根据最近上下文为问答话题起名（突出最后一次用户提问） */
export async function summarizeChatSessionTitle(params: {
  apiKey: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  lastUserMessage: string;
  dialect?: ReplyDialect;
}): Promise<string> {
  const fallback = params.lastUserMessage.trim().replace(/\s+/g, ' ').slice(0, 28);
  const recent = params.messages.slice(-10);
  if (recent.length === 0) {
    return fallback || '和 Bow Wow 聊聊';
  }

  const transcript = recent
    .map((m) => {
      const label = m.role === 'user' ? '用户' : 'Bow Wow';
      const text = m.content.trim().replace(/\s+/g, ' ');
      return `${label}：${text.slice(0, 400)}`;
    })
    .join('\n');

  const raw = await chatCompletionRaw(
    params.apiKey,
    [
      { role: 'system', content: chatSessionTitlePromptForDialect(params.dialect) },
      {
        role: 'user',
        content: `最近对话：\n${transcript}\n\n用户最后一次提问：${params.lastUserMessage.trim()}\n\n请输出话题标题：`,
      },
    ],
    { maxTokens: 48, temperature: 0.2 },
  );

  return sanitizeChatSessionTitle(raw, fallback || '和 Bow Wow 聊聊');
}

/** 问答（使用已组装的 messages，含摘要 + 最近轮） */
export async function deepseekChatFromMessages(
  apiKey: string,
  messages: ChatMessageInput[],
  options?: { log?: LlmRequestLogContext },
): Promise<string> {
  return chatCompletionRaw(apiKey, messages, { log: options?.log });
}

/** @deprecated 请用 prepareChatContext + deepseekChatFromMessages */
export async function deepseekChat(params: {
  apiKey: string;
  history: ChatMessageInput[];
  userMessage: string;
  dialect?: ReplyDialect;
}): Promise<string> {
  const messages: ChatMessageInput[] = [
    { role: 'system', content: chatPersonaForDialect(params.dialect) },
    ...params.history.filter((m) => m.role !== 'system'),
    { role: 'user', content: params.userMessage },
  ];
  return chatCompletionRaw(params.apiKey, messages);
}

/** 写作意图（使用已组装的 messages） */
export async function deepseekWritingIntentFromMessages(
  apiKey: string,
  messages: ChatMessageInput[],
  options?: { log?: LlmRequestLogContext },
): Promise<WritingIntentResult> {
  const raw = await chatCompletionRaw(apiKey, messages, {
    temperature: 0.4,
    log: options?.log,
  });
  const parsed = parseIntentJson(raw);
  const lastUser =
    [...messages].reverse().find((m) => m.role === 'user')?.content?.trim() ?? '';
  return {
    displayText: parsed.displayText,
    action: parsed.action,
    instruction: parsed.instruction || lastUser,
    ready: parsed.ready,
  };
}
