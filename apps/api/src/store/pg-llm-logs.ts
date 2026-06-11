import type { LlmRequestLogDetail, LlmRequestLogListItem } from '@xzz/shared';
import { getPool } from '../db/client.js';

const MAX_PER_USER = 500;
// 日志含用户消息内容,条数上限之外再加时间留存:超过 14 天即清
const RETENTION_DAYS = 14;

function rowToListItem(row: {
  id: string;
  created_at: Date;
  channel: string;
  provider: string;
  model: string;
  status: string;
  response_time_ms: number | null;
  context_ratio: number | null;
  session_id: string | null;
  group_id: string | null;
  topic_id: string | null;
  document_id: string | null;
  meta_line: string;
  list_preview: string;
  error_message: string | null;
  record: LlmRequestLogDetail;
}): LlmRequestLogListItem {
  const d = row.record;
  return {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    channel: d.channel,
    channelLabel: d.channelLabel,
    provider: row.provider as LlmRequestLogListItem['provider'],
    model: row.model,
    status: row.status as LlmRequestLogListItem['status'],
    responseTimeMs: row.response_time_ms ?? undefined,
    usage: d.usage,
    metaLine: row.meta_line,
    listPreview: row.list_preview,
    errorMessage: row.error_message ?? undefined,
    sessionId: row.session_id ?? undefined,
    groupId: row.group_id ?? undefined,
    topicId: row.topic_id ?? undefined,
    documentId: row.document_id ?? undefined,
    contextRatio: row.context_ratio ?? undefined,
  };
}

export async function insertLlmRequestLog(
  userId: string,
  detail: LlmRequestLogDetail,
  requestId?: string,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO llm_request_logs
     (id, user_id, channel, provider, model, status, response_time_ms, context_ratio,
      session_id, group_id, topic_id, document_id, request_id, meta_line, list_preview,
      error_message, record, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)`,
    [
      detail.id,
      userId,
      detail.channel,
      detail.provider,
      detail.model,
      detail.status,
      detail.responseTimeMs ?? null,
      detail.contextRatio ?? null,
      detail.sessionId ?? null,
      detail.groupId ?? null,
      detail.topicId ?? null,
      detail.documentId ?? null,
      requestId ?? null,
      detail.metaLine,
      detail.listPreview,
      detail.errorMessage ?? null,
      JSON.stringify(detail),
      detail.createdAt,
    ],
  );

  await pool.query(
    `DELETE FROM llm_request_logs
     WHERE user_id = $1
       AND (
         created_at < now() - make_interval(days => $3)
         OR id NOT IN (
           SELECT id FROM llm_request_logs
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT $2
         )
       )`,
    [userId, MAX_PER_USER, RETENTION_DAYS],
  );
}

export async function listLlmRequestLogs(
  userId: string,
  limit = 50,
): Promise<LlmRequestLogListItem[]> {
  const cap = Math.min(200, Math.max(1, limit));
  const res = await getPool().query(
    `SELECT id, created_at, channel, provider, model, status, response_time_ms,
            context_ratio, session_id, group_id, topic_id, document_id,
            meta_line, list_preview, error_message, record
     FROM llm_request_logs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, cap],
  );
  return res.rows.map((row) =>
    rowToListItem({
      ...row,
      record: row.record as LlmRequestLogDetail,
    }),
  );
}

export async function getLlmRequestLog(
  userId: string,
  id: string,
): Promise<LlmRequestLogDetail | null> {
  const res = await getPool().query(
    `SELECT record FROM llm_request_logs WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  const row = res.rows[0];
  if (!row) return null;
  return row.record as LlmRequestLogDetail;
}
