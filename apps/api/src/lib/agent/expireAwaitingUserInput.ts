/**
 * M4 Task 5：worker tick 的"过期 awaiting_user_input"检查。
 *
 * 行为：
 *   1. 查所有 status='awaiting_user_input' 且 pending_user_input_expires_at < now() 的 run
 *   2. 对每一个调 cancelRun(runId, ownerId, 'user_timeout')
 *
 * 不处理：
 *   - pending_user_input_expires_at IS NULL：兼容 M3 老 awaiting run，永远不回溯 cancel
 *   - 已 cancelled / completed 的 run：status 过滤已挡掉
 *
 * 返回处理掉的 run 数量（供 worker 日志 / 测试用）。
 */
import { getPool } from '../../db/client.js';
import { cancelRun } from './runLifecycle.js';

export async function autoExpireAwaitingUserInput(now: Date = new Date()): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT id, owner_id
       FROM agent_runs
      WHERE status = 'awaiting_user_input'
        AND pending_user_input_expires_at IS NOT NULL
        AND pending_user_input_expires_at < $1`,
    [now],
  );
  let resolved = 0;
  for (const row of rows) {
    try {
      await cancelRun(row.id as string, row.owner_id as string, 'user_timeout');
      resolved++;
    } catch (e) {
      console.warn('[autoExpireAwaitingUserInput] cancelRun failed (suppressed)', row.id, e);
    }
  }
  return resolved;
}
