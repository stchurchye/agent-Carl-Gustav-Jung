import { getPool } from '../../db/client.js';
import * as store from './store.js';
import { recordStep } from './stepRecorder.js';

/**
 * Approval 让出模型（ADR-1）：
 *
 * runtime 写完 approval_request step + 切 status='awaiting_approval' 后**立即 return**。
 * 三条恢复路径：
 *   1) HTTP /approve → approveRun(runId, userId)
 *   2) HTTP /deny    → denyRun(runId, userId, reason) → status='replanning'（不是 cancelled）
 *   3) worker tick autoResolveExpiredApprovals(now) 按 costHint 自动 grant/deny
 *
 * 所有路径都通过 `lastHeartbeatAt = null` 让 pickupNextRun 优先捡走。
 */

/**
 * 'system' 是 sentinel 字符串：表示自动 timeout 触发，agent_steps.by_user_id
 * 列有 FK 约束（→ users.id），所以 system 路径要写 null（同时把 'system' 留在
 * output.reason 里供查询）。
 */
const SYSTEM_SENTINEL = 'system';
function byUserIdForStep(byUserId: string): string | null {
  return byUserId === SYSTEM_SENTINEL ? null : byUserId;
}

export async function approveRun(
  runId: string,
  byUserId: string,
  reason: string = 'manual',
): Promise<boolean> {
  const run = await store.getAgentRun(runId);
  if (!run || run.status !== 'awaiting_approval') return false;
  const toolName = run.pendingApprovalToolName;
  await store.updateAgentRun(runId, {
    status: 'running',
    awaitingApprovalUntil: null,
    awaitingApprovalStepIdx: null,
    pendingApprovalToolName: null,
    lastHeartbeatAt: null,
  });
  await recordStep({
    runId,
    kind: 'approval_grant',
    toolName: toolName ?? null,
    byUserId: byUserIdForStep(byUserId),
    output: { reason, by: byUserId },
  });
  return true;
}

export async function denyRun(
  runId: string,
  byUserId: string,
  reason: string = 'manual',
): Promise<boolean> {
  const run = await store.getAgentRun(runId);
  if (!run || run.status !== 'awaiting_approval') return false;
  const toolName = run.pendingApprovalToolName;
  await store.updateAgentRun(runId, {
    status: 'replanning',
    awaitingApprovalUntil: null,
    awaitingApprovalStepIdx: null,
    pendingApprovalToolName: null,
    lastHeartbeatAt: null,
  });
  await recordStep({
    runId,
    kind: 'approval_deny',
    toolName: toolName ?? null,
    byUserId: byUserIdForStep(byUserId),
    output: { reason, by: byUserId },
  });
  return true;
}

/**
 * worker tick 周期调用。扫所有过期 awaiting_approval：
 * - costHint='low' → 自动 approve（'system'）
 * - 其他 → 自动 deny（'system'，进入 replanning）
 *
 * 都额外写一条 approval_timeout step（auto: 'granted' | 'denied'）。
 */
export async function autoResolveExpiredApprovals(
  now: Date = new Date(),
): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT id, pending_approval_tool_name FROM agent_runs
     WHERE status = 'awaiting_approval' AND awaiting_approval_until < $1`,
    [now],
  );
  let resolved = 0;
  for (const row of rows) {
    const toolName: string | null = row.pending_approval_tool_name;
    const { toolRegistry } = await import('./toolRegistry.js');
    const tool = toolName ? toolRegistry.get(toolName) : null;
    const isLowCost = tool?.costHint === 'low';
    if (isLowCost) {
      await approveRun(row.id, 'system', 'auto-low-cost-timeout');
      await recordStep({
        runId: row.id,
        kind: 'approval_timeout',
        toolName,
        output: { auto: 'granted' },
      });
    } else {
      await denyRun(row.id, 'system', 'auto-timeout-deny');
      await recordStep({
        runId: row.id,
        kind: 'approval_timeout',
        toolName,
        output: { auto: 'denied' },
      });
    }
    resolved++;
  }
  return resolved;
}
