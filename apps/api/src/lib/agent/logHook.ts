import { randomUUID } from 'crypto';
import { getPool } from '../../db/client.js';
import { agentHookBus, type AgentHookEvent } from './hooks.js';

let unsub: (() => void) | null = null;

/**
 * 订阅 agentHookBus，把每个事件序列化写入 `agent_event_logs`。
 *
 * 这是 M1b-3 的最简消费者，证明 hook bus 链路可用；
 * M1c+ 再扩展 webhook / Slack / 文件归档等路由。
 *
 * 失败必须吞掉错误，不能影响 agent 主流程。
 */
export function registerLogHook(): void {
  if (unsub) return;
  unsub = agentHookBus.onEvent((e) => {
    void persistEvent(e).catch((err) => {
      console.error('[agent logHook] insert failed', err);
    });
  });
}

export function unregisterLogHook(): void {
  unsub?.();
  unsub = null;
}

async function persistEvent(e: AgentHookEvent): Promise<void> {
  const { runId, userId, payload } = serializeEvent(e);
  await getPool().query(
    `INSERT INTO agent_event_logs (id, event_type, run_id, user_id, payload, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, now())`,
    [randomUUID(), `agent.${e.type}`, runId, userId, JSON.stringify(payload)],
  );
}

function serializeEvent(e: AgentHookEvent): {
  runId: string | null;
  userId: string | null;
  payload: unknown;
} {
  switch (e.type) {
    case 'step.recorded':
      return {
        runId: e.runId,
        userId: e.step.byUserId,
        payload: {
          step: {
            idx: e.step.idx,
            kind: e.step.kind,
            toolName: e.step.toolName,
            error: e.step.error,
          },
        },
      };
    case 'run.failed':
      return {
        runId: e.run.id,
        userId: e.run.ownerId,
        payload: { status: e.run.status, error: e.error },
      };
    case 'run.cancelled':
      return {
        runId: e.run.id,
        userId: e.run.ownerId,
        payload: { status: e.run.status, byUserId: e.byUserId },
      };
    case 'run.budget_exhausted':
      return {
        runId: e.run.id,
        userId: e.run.ownerId,
        payload: { status: e.run.status, resource: e.resource },
      };
    default:
      return {
        runId: e.run.id,
        userId: e.run.ownerId,
        payload: { status: e.run.status },
      };
  }
}
