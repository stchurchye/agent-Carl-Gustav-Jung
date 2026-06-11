import { randomUUID } from 'crypto';
import {
  LLM_REQUEST_CHANNEL_LABELS,
  buildLlmRequestDisplayTurns,
  buildLlmRequestListPreview,
  buildLlmRequestMetaLine,
  buildLlmRequestRawJson,
  type LlmRequestChannel,
  type LlmRequestLogDetail,
  type LlmRequestLogListItem,
  type LlmRequestMessage,
  type LlmRequestUsage,
} from '@xzz/shared';
import { log } from './logger.js';
import * as pgLlmLogs from '../store/pg-llm-logs.js';

export type LlmRequestLogInput = {
  userId: string;
  channel: LlmRequestChannel;
  provider: 'zenmux' | 'deepseek';
  model: string;
  messages: LlmRequestMessage[];
  responseText?: string;
  usage?: LlmRequestUsage;
  responseTimeMs?: number;
  status: 'ok' | 'error';
  errorMessage?: string;
  requestId?: string;
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  documentId?: string;
  contextRatio?: number;
};

/**
 * 单条消息内容入库上限(字符)。日志是自查/调试用途,不需要全文;
 * 全文落库会把用户敏感输入(密码/医疗信息/整篇文档)无界复制进日志表。
 */
export const LLM_LOG_CONTENT_CAP = 4000;
const TRUNCATED_MARK = '\n…（日志截断，原文 ';

function capContent(text: string): string {
  if (text.length <= LLM_LOG_CONTENT_CAP) return text;
  return `${text.slice(0, LLM_LOG_CONTENT_CAP)}${TRUNCATED_MARK}${text.length} 字符）`;
}

function buildDetail(input: LlmRequestLogInput): LlmRequestLogDetail {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const channelLabel = LLM_REQUEST_CHANNEL_LABELS[input.channel];
  // 截断后再构建 preview/turns/rawJson,确保全文不以任何形态落库
  const cappedMessages = input.messages.map((m) =>
    m.content.length > LLM_LOG_CONTENT_CAP ? { ...m, content: capContent(m.content) } : m,
  );
  const cappedResponse =
    input.responseText !== undefined ? capContent(input.responseText) : undefined;
  input = { ...input, messages: cappedMessages, responseText: cappedResponse };
  const listPreview = buildLlmRequestListPreview(input.messages, input.responseText);
  const metaLine = buildLlmRequestMetaLine({
    model: input.model,
    usage: input.usage,
    responseTimeMs: input.responseTimeMs,
    status: input.status,
  });
  const displayTurns = buildLlmRequestDisplayTurns(input.messages);
  const responseDisplay = input.responseText?.trim() ? input.responseText : undefined;
  const rawJson = buildLlmRequestRawJson({
    channel: input.channel,
    provider: input.provider,
    model: input.model,
    messages: input.messages,
    responseText: input.responseText,
    usage: input.usage,
    responseTimeMs: input.responseTimeMs,
    status: input.status,
    errorMessage: input.errorMessage,
    contextRatio: input.contextRatio,
    sessionId: input.sessionId,
    groupId: input.groupId,
    topicId: input.topicId,
    documentId: input.documentId,
    requestId: input.requestId,
  });

  return {
    id,
    createdAt,
    channel: input.channel,
    channelLabel,
    provider: input.provider,
    model: input.model,
    status: input.status,
    responseTimeMs: input.responseTimeMs,
    usage: input.usage,
    metaLine,
    listPreview,
    errorMessage: input.errorMessage,
    sessionId: input.sessionId,
    groupId: input.groupId,
    topicId: input.topicId,
    documentId: input.documentId,
    contextRatio: input.contextRatio,
    messages: input.messages,
    responseText: input.responseText,
    displayTurns,
    responseDisplay,
    rawJson,
  };
}

/** 写入数据库（异步，不阻塞 LLM 响应） */
export function recordLlmRequest(input: LlmRequestLogInput): void {
  const detail = buildDetail(input);
  void pgLlmLogs.insertLlmRequestLog(input.userId, detail, input.requestId).catch((e) => {
    log('warn', 'llm_request_log.persist_fail', {
      userId: input.userId,
      channel: input.channel,
      error: e instanceof Error ? e.message : String(e),
    });
  });
}

export async function listLlmRequestLogs(
  userId: string,
  limit = 50,
): Promise<LlmRequestLogListItem[]> {
  return pgLlmLogs.listLlmRequestLogs(userId, limit);
}

export async function getLlmRequestLog(
  userId: string,
  id: string,
): Promise<LlmRequestLogDetail | null> {
  return pgLlmLogs.getLlmRequestLog(userId, id);
}
