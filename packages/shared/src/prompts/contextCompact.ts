import type { ReplyDialect } from './persona.js';

const HISTORY_SUMMARY_MANDARIN = `你是上下文压缩助手。把以下多轮对话压缩成一段摘要，供后续对话继续参考。
要求：
- 400～800 个汉字，口语清楚
- 保留：用户核心诉求、已确认的结论、未解决的问题、重要人名地名与时间线
- 不要编造对话里没有的内容
- 不要加标题或 markdown，只输出摘要正文`;

export function historyCompactPromptForDialect(_dialect?: ReplyDialect | null): string {
  return HISTORY_SUMMARY_MANDARIN;
}

const DOCUMENT_SUMMARY_MANDARIN = `你是文稿压缩助手。以下是一篇文稿各段落内容，请压缩为「全篇理解用摘要」。
要求：
- 每段 1～2 句，段与段之间空一行
- 标出段落编号
- 当前待改段可略详，其它段从简
- 不编造情节，总字数不超过 1500 字
- 只输出摘要，不要 markdown`;

export function documentCompactPromptForDialect(_dialect?: ReplyDialect | null): string {
  return DOCUMENT_SUMMARY_MANDARIN;
}

export function formatHistoryForCompact(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): string {
  return messages
    .map((m) => {
      const label = m.role === 'user' ? '用户' : '小助手';
      return `${label}：${m.content.trim()}`;
    })
    .join('\n\n');
}
