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

function buildDetail(input: LlmRequestLogInput): LlmRequestLogDetail {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const channelLabel = LLM_REQUEST_CHANNEL_LABELS[input.channel];
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
