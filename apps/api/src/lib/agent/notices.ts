/**
 * User-facing notice 通道（M1e task 2）。
 *
 * 把"静默 fallback"暴露给用户：key 解密失败、retry 重复、planner LLM 失败、
 * skill 注入被 reject 等情况，都通过这里 emit 一条 notice，UI 顶部 banner 展示。
 *
 * 设计要点：
 * - 复用 `agent_event_logs` 表（已有 JSONB payload + event_type 列），
 *   `event_type='user_facing_notice'`，无 migration。
 * - `emitNotice` 必须 try/catch，DB 写失败绝不能阻塞 agent run（仅 console.warn）。
 * - SSE 中的 notice 事件 id 用 `n:${agent_event_logs.id}` 命名空间，
 *   与 step 事件 `s:${agent_steps.id}` 区分；Last-Event-ID 重连时按前缀 dispatch。
 * - 所有 emit 必须用下面的 `NoticeCode` enum，便于未来 i18n / 分类 / sentry 路由。
 */
import { randomUUID } from 'crypto';
import { getPool } from '../../db/client.js';

export const NOTICE_EVENT_TYPE = 'user_facing_notice';

export type NoticeCode =
  // key / 鉴权
  | 'USER_KEY_MISSING'
  | 'USER_KEY_DECRYPT_FAILED'
  | 'NO_API_KEY'
  // retry / 幂等
  | 'RETRY_DEDUPED'
  // LLM 失败
  | 'PLANNER_LLM_FALLBACK'
  | 'REPLY_LLM_FALLBACK'
  // skill / 注入防御
  | 'SKILL_WARN_KEYWORD'
  | 'SKILL_DROPPED'
  // 工具
  | 'DOC_EXPORT_VERSIONED'
  | 'TOOL_PAYLOAD_TOO_LARGE'
  // MCP
  | 'MCP_HANDSHAKE_FAILED'
  // M4: cost accounting
  | 'COST_UNKNOWN_MODEL';

export type NoticeSeverity = 'info' | 'warn' | 'error';

export type UserNotice = {
  /** agent_event_logs.id，UI 不直接展示 */
  id: string;
  runId: string;
  severity: NoticeSeverity;
  code: NoticeCode;
  /** 给用户看的中文（不参数化，参数走 context） */
  message: string;
  context?: Record<string, unknown>;
  /** ISO string */
  createdAt: string;
};

export type EmitNoticeInput = {
  runId: string;
  severity: NoticeSeverity;
  code: NoticeCode;
  message: string;
  context?: Record<string, unknown>;
};

/**
 * 把一条 user-facing notice 落到 agent_event_logs。
 * 失败仅 console.warn，绝不抛出（防止阻塞 agent run）。
 */
export async function emitNotice(input: EmitNoticeInput): Promise<void> {
  try {
    const id = randomUUID();
    const payload = {
      severity: input.severity,
      code: input.code,
      message: input.message,
      context: input.context ?? null,
    };
    await getPool().query(
      `INSERT INTO agent_event_logs (id, event_type, run_id, user_id, payload, created_at)
       VALUES ($1, $2, $3, NULL, $4::jsonb, now())`,
      [id, NOTICE_EVENT_TYPE, input.runId, JSON.stringify(payload)],
    );
  } catch (e) {
    console.warn(
      '[agent.emitNotice] insert failed (suppressed)',
      input.code,
      e,
    );
  }
}

function rowToNotice(row: Record<string, unknown>): UserNotice {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const created = row.created_at as Date | string;
  return {
    id: row.id as string,
    runId: row.run_id as string,
    severity: (payload.severity as NoticeSeverity) ?? 'info',
    code: (payload.code as NoticeCode) ?? 'USER_KEY_MISSING',
    message: (payload.message as string) ?? '',
    context: (payload.context as Record<string, unknown> | null) ?? undefined,
    createdAt:
      typeof created === 'string' ? created : created.toISOString(),
  };
}

/**
 * 拉某个 run 的 notice 列表，最新优先。GET /api/agent/runs/:id 的响应里附带。
 */
export async function listNoticesForRun(
  runId: string,
  opts?: { limit?: number },
): Promise<UserNotice[]> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 20, 100));
  const { rows } = await getPool().query(
    `SELECT id, run_id, payload, created_at
       FROM agent_event_logs
      WHERE run_id = $1 AND event_type = $2
      ORDER BY created_at DESC
      LIMIT $3`,
    [runId, NOTICE_EVENT_TYPE, limit],
  );
  return rows.map(rowToNotice);
}

/**
 * SSE 续传用：拉 notice 表里 created_at > 给定 id 的那条之后的所有 notice，按时间正序。
 *
 * 若 afterId 为 null / 不是合法 UUID / 在 DB 找不到（被清理或 client 拿到了脏值），
 * 退回"全部 asc"——客户端按 `id` 在本地去重便宜，而漏 notice 不可接受。
 *
 * 注：M1e review 修复——之前的实现里 SQL `created_at > (SELECT ... WHERE id=$3)`
 * 在子查询无行时返回 NULL，使 outer WHERE 评估为 UNKNOWN → 实际返回空集，
 * 与本函数 doc-comment 描述相反。现在显式两步查找。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listNoticesAfter(
  runId: string,
  afterId: string | null,
): Promise<UserNotice[]> {
  let anchorExists = false;
  if (afterId && UUID_RE.test(afterId)) {
    const anchor = await getPool().query(
      `SELECT 1 FROM agent_event_logs
        WHERE id = $1 AND event_type = $2 LIMIT 1`,
      [afterId, NOTICE_EVENT_TYPE],
    );
    anchorExists = anchor.rows.length > 0;
  }

  if (!anchorExists) {
    const { rows } = await getPool().query(
      `SELECT id, run_id, payload, created_at
         FROM agent_event_logs
        WHERE run_id = $1 AND event_type = $2
        ORDER BY created_at ASC`,
      [runId, NOTICE_EVENT_TYPE],
    );
    return rows.map(rowToNotice);
  }

  // Anchor 存在 → 用 subquery 比较 created_at，让 PG 全程在 μs 精度比，
  // 避免经 JS Date (ms 精度) 中转丢精度导致同 μs 内的 notice 被多发。
  const { rows } = await getPool().query(
    `SELECT id, run_id, payload, created_at
       FROM agent_event_logs
      WHERE run_id = $1 AND event_type = $2
        AND created_at > (
          SELECT created_at FROM agent_event_logs
           WHERE id = $3 AND event_type = $2
        )
      ORDER BY created_at ASC`,
    [runId, NOTICE_EVENT_TYPE, afterId],
  );
  return rows.map(rowToNotice);
}
