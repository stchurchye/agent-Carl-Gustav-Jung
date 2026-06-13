import { randomUUID } from 'crypto';
import type { DiaryEntry, DiaryScope, DiaryStatus } from '@xzz/shared';
import { getPool } from '../db/client.js';

function now(): string {
  return new Date().toISOString();
}

function toIso(v: unknown): string {
  return typeof v === 'string' ? v : (v as Date).toISOString();
}

/** diary_entries 行(显式列,snake_case)→ DiaryEntry(客户端面向,camelCase)。 */
function rowDiary(r: Record<string, unknown>): DiaryEntry {
  return {
    id: r.id as string,
    scope: r.scope as DiaryScope,
    scopeId: r.scope_id as string,
    scopeName: (r.scope_name as string | null) ?? null,
    dayKey: r.day_key as string,
    summary: r.summary as string,
    status: r.status as DiaryStatus,
    sourceCount: Number(r.source_count),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export interface UpsertDiaryInput {
  scope: DiaryScope;
  scopeId: string;
  scopeName?: string | null;
  dayKey: string;
  summary: string;
  status?: DiaryStatus;
  sourceCount?: number;
  sourceMaxMsgId?: string | null;
}

/**
 * 写入或覆盖一篇日记(每人每天每 scope 一篇,靠 UNIQUE 幂等)。
 * 生成/重生成用:命中 (owner,scope,scope_id,day_key) 则更新正文与水位,不新增行。
 * 注意:status 只在首次插入时按 input.status(默认 draft)写入;命中冲突时**保留既有 status**
 * (不会把已 confirmed/distilled 的日记打回 draft)。状态转移请走 setDiaryStatus。
 */
export async function upsertDiaryEntry(
  userId: string,
  input: UpsertDiaryInput,
): Promise<DiaryEntry> {
  const ts = now();
  const { rows } = await getPool().query(
    `INSERT INTO diary_entries
       (id, owner_id, scope, scope_id, scope_name, day_key, summary, status, source_count, source_max_msg_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
     ON CONFLICT (owner_id, scope, scope_id, day_key) DO UPDATE SET
       scope_name = EXCLUDED.scope_name,
       summary = EXCLUDED.summary,
       source_count = EXCLUDED.source_count,
       source_max_msg_id = EXCLUDED.source_max_msg_id,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      randomUUID(),
      userId,
      input.scope,
      input.scopeId,
      input.scopeName ?? null,
      input.dayKey,
      input.summary,
      input.status ?? 'draft',
      input.sourceCount ?? 0,
      input.sourceMaxMsgId ?? null,
      ts,
    ],
  );
  return rowDiary(rows[0]);
}

export async function getDiaryEntry(
  userId: string,
  scope: DiaryScope,
  scopeId: string,
  dayKey: string,
): Promise<DiaryEntry | undefined> {
  const { rows } = await getPool().query(
    `SELECT * FROM diary_entries
     WHERE owner_id = $1 AND scope = $2 AND scope_id = $3 AND day_key = $4`,
    [userId, scope, scopeId, dayKey],
  );
  return rows[0] ? rowDiary(rows[0]) : undefined;
}

export async function listDiaryEntries(
  userId: string,
  opts?: { scope?: DiaryScope; scopeId?: string; limit?: number },
): Promise<DiaryEntry[]> {
  const params: unknown[] = [userId];
  let q = `SELECT * FROM diary_entries WHERE owner_id = $1`;
  if (opts?.scope) {
    params.push(opts.scope);
    q += ` AND scope = $${params.length}`;
  }
  if (opts?.scopeId !== undefined) {
    params.push(opts.scopeId);
    q += ` AND scope_id = $${params.length}`;
  }
  q += ` ORDER BY day_key DESC`;
  params.push(Math.min(opts?.limit ?? 60, 200));
  q += ` LIMIT $${params.length}`;
  const { rows } = await getPool().query(q, params);
  return rows.map(rowDiary);
}

/** 矫正:改写正文并回到 draft(内容变了需重新确认);篇不存在返回 undefined。 */
export async function setDiarySummary(
  userId: string,
  scope: DiaryScope,
  scopeId: string,
  dayKey: string,
  summary: string,
): Promise<DiaryEntry | undefined> {
  const { rows } = await getPool().query(
    `UPDATE diary_entries
     SET summary = $5, status = 'draft', updated_at = $6
     WHERE owner_id = $1 AND scope = $2 AND scope_id = $3 AND day_key = $4
     RETURNING *`,
    [userId, scope, scopeId, dayKey, summary, now()],
  );
  return rows[0] ? rowDiary(rows[0]) : undefined;
}

/** 确认/蒸馏时改状态(可顺带打 distilled_at);不动正文。 */
export async function setDiaryStatus(
  userId: string,
  scope: DiaryScope,
  scopeId: string,
  dayKey: string,
  status: DiaryStatus,
  opts?: { distilledAt?: string | null },
): Promise<DiaryEntry | undefined> {
  const { rows } = await getPool().query(
    `UPDATE diary_entries
     SET status = $5, distilled_at = COALESCE($6, distilled_at), updated_at = $7
     WHERE owner_id = $1 AND scope = $2 AND scope_id = $3 AND day_key = $4
     RETURNING *`,
    [userId, scope, scopeId, dayKey, status, opts?.distilledAt ?? null, now()],
  );
  return rows[0] ? rowDiary(rows[0]) : undefined;
}
