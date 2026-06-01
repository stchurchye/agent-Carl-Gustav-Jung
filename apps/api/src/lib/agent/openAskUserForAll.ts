/**
 * M7 T6e：群聊 ask_user owner 独占 → 30s 后升级为"任意群成员可答"。
 *
 * 模式对齐 M4 autoExpireAwaitingUserInput：每 worker tick 扫一次。
 *
 * 单事务做 3 件事：
 *   1. UPDATE agent_runs SET ask_user_opened_for_all_at = NOW()
 *   2. UPDATE group_messages SET payload.askUser.openedForAll = true
 *   3. emit ask_user.opened_for_all hook
 *
 * 关键设计：用 ask_user_started_at（独立时间戳）判 30s，
 * 而不是 last_heartbeat_at（被 worker 持续刷新）。
 */
import { getPool } from '../../db/client.js';
import * as store from './store.js';
import { agentHookBus } from './hooks.js';

const ASK_USER_OWNER_LOCK_MS = 30_000;

export async function autoOpenAskUserForAll(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ASK_USER_OWNER_LOCK_MS);
  const client = await getPool().connect();
  try {
    const { rows: candidates } = await client.query(
      `SELECT id FROM agent_runs
        WHERE status = 'awaiting_user_input'
          AND channel = 'group'
          AND ask_user_opened_for_all_at IS NULL
          AND ask_user_started_at IS NOT NULL
          AND ask_user_started_at < $1`,
      [cutoff],
    );

    let resolved = 0;
    for (const row of candidates) {
      const runId = row.id as string;
      await client.query('BEGIN');
      try {
        const upd = await client.query(
          `UPDATE agent_runs
              SET ask_user_opened_for_all_at = NOW()
            WHERE id = $1
              AND status = 'awaiting_user_input'
              AND ask_user_opened_for_all_at IS NULL
            RETURNING id`,
          [runId],
        );
        if (upd.rowCount === 0) {
          await client.query('ROLLBACK');
          continue; // 已被另一 worker 抢
        }
        await client.query(
          `UPDATE group_messages
              SET payload = jsonb_set(
                COALESCE(payload, '{}'::jsonb),
                '{askUser,openedForAll}',
                'true'::jsonb,
                true
              )
            WHERE payload->>'kind' = 'agent_ask_user'
              AND payload->'askUser'->>'runId' = $1`,
          [runId],
        );
        await client.query('COMMIT');
        const latest = await store.getAgentRun(runId);
        if (latest) {
          agentHookBus.emitEvent({
            type: 'ask_user.opened_for_all',
            runId,
            run: latest,
          });
        }
        resolved++;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.warn('[autoOpenAskUserForAll] update failed', runId, e);
      }
    }
    return resolved;
  } finally {
    client.release();
  }
}
