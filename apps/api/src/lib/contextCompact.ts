import {
  formatHistoryForCompact,
  historyCompactPromptForDialect,
  documentCompactPromptForDialect,
  type ReplyDialect,
} from '@xzz/shared';
import { ZENMUX_CHAT_COMPACT_MODEL } from '@xzz/shared';
import { zenmuxChatFromMessages } from './zenmux.js';

/** 将多轮对话压成摘要（可与已有摘要合并） */
export async function compactHistoryViaLlm(params: {
  apiKey: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  existingSummary?: string | null;
  dialect?: ReplyDialect;
}): Promise<string> {
  if (params.messages.length === 0) {
    return params.existingSummary?.trim() ?? '';
  }

  const transcript = formatHistoryForCompact(params.messages);
  const existing = params.existingSummary?.trim();
  const userContent = existing
    ? `已有摘要：\n${existing}\n\n请把下面更早的对话合并进摘要（去重、保留关键信息）：\n\n${transcript}`
    : `请压缩以下对话：\n\n${transcript}`;

  const raw = await zenmuxChatFromMessages(
    params.apiKey,
    ZENMUX_CHAT_COMPACT_MODEL,
    [
      { role: 'system', content: historyCompactPromptForDialect(params.dialect) },
      { role: 'user', content: userContent },
    ],
    { maxTokens: 900, temperature: 0.2 },
  );

  return raw.content.trim();
}

export async function compactDocumentExcerptViaLlm(params: {
  apiKey: string;
  documentExcerpt: string;
  dialect?: ReplyDialect;
}): Promise<string> {
  const raw = await zenmuxChatFromMessages(
    params.apiKey,
    ZENMUX_CHAT_COMPACT_MODEL,
    [
      { role: 'system', content: documentCompactPromptForDialect(params.dialect) },
      { role: 'user', content: params.documentExcerpt },
    ],
    { maxTokens: 1200, temperature: 0.2 },
  );
  return raw.content.trim();
}

export function mergeSummaries(existing: string | null | undefined, addition: string): string {
  const a = existing?.trim();
  const b = addition.trim();
  if (!a) return b;
  if (!b) return a;
  return `${a}\n\n${b}`;
}
