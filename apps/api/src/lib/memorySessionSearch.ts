import type { MemorySessionSearchHit } from '@xzz/shared';
import { previewMessageText } from '@xzz/shared';
import { getPool } from '../db/client.js';

export async function searchSessionMessages(params: {
  userId: string;
  query: string;
  sessionId?: string;
  groupId?: string;
  topicId?: string;
  limit?: number;
}): Promise<MemorySessionSearchHit[]> {
  const q = params.query.trim();
  if (q.length < 2) return [];

  // 钳到 [1,30]:负数/NaN 直达 SQL LIMIT 会让 PostgreSQL 报错 500(review PLAUSIBLE→真)
  const requested = Number(params.limit);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.floor(requested), 1), 30) : 15;
  const hits: MemorySessionSearchHit[] = [];

  if (!params.groupId) {
    let sql = `
      SELECT id, session_id, payload, created_at,
             ts_rank(to_tsvector('simple', coalesce(payload->>'content', '')), plainto_tsquery('simple', $2)) AS rank
      FROM private_chat_messages
      WHERE owner_id = $1
        AND to_tsvector('simple', coalesce(payload->>'content', '')) @@ plainto_tsquery('simple', $2)`;
    const sqlParams: unknown[] = [params.userId, q];
    if (params.sessionId) {
      sqlParams.push(params.sessionId);
      sql += ` AND session_id = $${sqlParams.length}`;
    }
    sql += ` ORDER BY rank DESC, created_at DESC LIMIT $${sqlParams.length + 1}`;
    sqlParams.push(limit);

    try {
      const { rows } = await getPool().query(sql, sqlParams);
      for (const r of rows) {
        const payload = r.payload as { role?: string; content?: string };
        hits.push({
          messageId: r.id,
          sessionId: r.session_id,
          role: payload.role ?? 'user',
          contentPreview: previewMessageText(payload.content ?? ''),
          createdAt: r.created_at.toISOString(),
          channel: 'private',
        });
      }
    } catch {
      const { rows } = await getPool().query(
        `SELECT id, session_id, payload, created_at
         FROM private_chat_messages
         WHERE owner_id = $1 AND payload->>'content' ILIKE $2
         ${params.sessionId ? 'AND session_id = $3' : ''}
         ORDER BY created_at DESC
         LIMIT ${params.sessionId ? '$4' : '$3'}`,
        params.sessionId
          ? [params.userId, `%${q}%`, params.sessionId, limit]
          : [params.userId, `%${q}%`, limit],
      );
      for (const r of rows) {
        const payload = r.payload as { role?: string; content?: string };
        hits.push({
          messageId: r.id,
          sessionId: r.session_id,
          role: payload.role ?? 'user',
          contentPreview: previewMessageText(payload.content ?? ''),
          createdAt: r.created_at.toISOString(),
          channel: 'private',
        });
      }
    }
  }

  if (params.groupId) {
    const sqlParams: unknown[] = [params.groupId, q];
    let sql = `
      SELECT id, group_id, topic_id, payload, created_at,
             ts_rank(to_tsvector('simple', coalesce(payload->>'content', '')), plainto_tsquery('simple', $2)) AS rank
      FROM group_messages
      WHERE group_id = $1
        AND to_tsvector('simple', coalesce(payload->>'content', '')) @@ plainto_tsquery('simple', $2)`;
    if (params.topicId) {
      sqlParams.push(params.topicId);
      sql += ` AND topic_id = $${sqlParams.length}`;
    }
    sql += ` ORDER BY rank DESC, created_at DESC LIMIT $${sqlParams.length + 1}`;
    sqlParams.push(limit);

    try {
      const { rows } = await getPool().query(sql, sqlParams);
      for (const r of rows) {
        const payload = r.payload as { role?: string; content?: string };
        hits.push({
          messageId: r.id,
          groupId: r.group_id,
          topicId: r.topic_id ?? undefined,
          role: payload.role ?? 'user',
          contentPreview: previewMessageText(payload.content ?? ''),
          createdAt: r.created_at.toISOString(),
          channel: 'group',
        });
      }
    } catch {
      const { rows } = await getPool().query(
        `SELECT id, group_id, topic_id, payload, created_at
         FROM group_messages
         WHERE group_id = $1 AND payload->>'content' ILIKE $2
         ${params.topicId ? 'AND topic_id = $3' : ''}
         ORDER BY created_at DESC
         LIMIT ${params.topicId ? '$4' : '$3'}`,
        params.topicId
          ? [params.groupId, `%${q}%`, params.topicId, limit]
          : [params.groupId, `%${q}%`, limit],
      );
      for (const r of rows) {
        const payload = r.payload as { role?: string; content?: string };
        hits.push({
          messageId: r.id,
          groupId: r.group_id,
          topicId: r.topic_id ?? undefined,
          role: payload.role ?? 'user',
          contentPreview: previewMessageText(payload.content ?? ''),
          createdAt: r.created_at.toISOString(),
          channel: 'group',
        });
      }
    }
  }

  return hits.slice(0, limit);
}
