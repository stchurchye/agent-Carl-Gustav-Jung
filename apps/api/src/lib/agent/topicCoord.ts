/**
 * M7 子项目 B：群聊 Agent 并发协调入口（ADR-M7-14 + R13）。
 *
 * 核心契约：
 *   1. 群聊 agent_run 创建路径必须套在 withTopicCoordination(topicId, fn) 内执行；
 *   2. fn 接到的 client 已经在 BEGIN + pg_advisory_xact_lock 状态下，acquireTopicSlot
 *      + 后续 createFreshInTx / applyMergeInTx / applyQueueInTx 必须复用同 client；
 *   3. fn 返回后 helper 统一 COMMIT 释放锁；异常路径 ROLLBACK。
 *
 *   "先 acquireTopicSlot commit 再 createAgentRun" 是错误模式 —— 两个并发请求都能在锁外
 *   看到 "无 active"，从而双写 fresh run。R13 / TB1 / TB16 verify。
 *
 * 决策矩阵（详见 design spec §8.1）：
 *   parentRunId 非空 ............ create_fresh （ADR-M7-7：子 run 不被合并）
 *   private / 无 topicId ........ create_fresh
 *   blocking 不存在 ............. create_fresh
 *   blocking.ownerId == self .... merge        （同 owner 任意时间合并）
 *   blocking.createdAt 30s 内 ... merge        （跨 owner 30s 窗口合并）
 *   其它 ........................ queue
 */
import type { PoolClient } from 'pg';
import { getPool } from '../../db/client.js';
import * as store from './store.js';
import type { AgentChannel } from './types.js';

export const MERGE_WINDOW_MS = 30_000;

export type SlotDecision =
  | { action: 'create_fresh' }
  | { action: 'merge'; targetRunId: string; mergedByUserId?: string }
  | { action: 'queue'; precedingCount: number };

export type AcquireTopicSlotInput = {
  channel: AgentChannel;
  topicId: string | null;
  ownerId: string;
  parentRunId?: string | null;
};

/**
 * 同 topic 决策 + 落库的串行化 helper。fn 内的所有 store 写入必须把 client 透传过去。
 */
export async function withTopicCoordination<T>(
  topicId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // hashtext 返回 32-bit → 用两位 key 降低跨 topic 哈希碰撞概率
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtext('agent_topic_coord:' || $1),
         hashtext('m7')
       )`,
      [topicId],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 仅做决策（读 blocking + 算 precedingCount），不开事务/不持锁。
 * 群聊路径必须由 withTopicCoordination 提供持锁的 client；客户端否则会触发 race（R13）。
 */
export async function acquireTopicSlot(
  input: AcquireTopicSlotInput,
  client?: PoolClient,
): Promise<SlotDecision> {
  // ADR-M7-7：子 run 强制 fresh（防自合并到父 run）
  if (input.parentRunId) return { action: 'create_fresh' };

  // 私聊 / 无 topicId：不参与协调（无需持锁）
  if (input.channel !== 'group' || !input.topicId) {
    return { action: 'create_fresh' };
  }

  // 严格契约：群聊场景必须传 client（来自 withTopicCoordination）
  if (!client) {
    throw new Error(
      '[acquireTopicSlot] group channel requires a transactional client; ' +
        'wrap the call in withTopicCoordination(topicId, async (client) => ...)',
    );
  }

  const topicId = input.topicId;
  const blocking = await store.findBlockingActiveOnTopic(topicId, client);
  if (!blocking) return { action: 'create_fresh' };

  // 同 owner → 任意时间合并
  if (blocking.ownerId === input.ownerId) {
    return { action: 'merge', targetRunId: blocking.id };
  }

  // 跨 owner + 窗口内 → 合并
  const ageMs = Date.now() - blocking.createdAt.getTime();
  if (ageMs < MERGE_WINDOW_MS) {
    return {
      action: 'merge',
      targetRunId: blocking.id,
      mergedByUserId: input.ownerId,
    };
  }

  // 跨 owner + 窗口外 → queue
  const precedingCount = await store.countBlockingPlusQueuedOnTopic(topicId, client);
  return { action: 'queue', precedingCount };
}

/**
 * M7：active run 进 terminal 时调用，把同 topic 队首 'queued' run 提到 'draft'，
 * worker 下一 tick 自然 pickup。
 *
 * 触发点（T4b）：softComplete / cancelRun 两个出口调；reclaim 仅延续 run 不释放 slot。
 */
export async function dequeueNextOnTopic(topicId: string | null): Promise<void> {
  if (!topicId) return;
  // queued 本身不算 blocking；如果还有 running 等就别 dequeue（让它跑完）。
  const stillBlocking = await store.findBlockingActiveOnTopic(topicId);
  if (stillBlocking) return;
  const next = await store.findQueuedHeadOnTopic(topicId);
  if (!next) return;
  const updated = await store.updateAgentRun(next.id, {
    status: 'draft',
    queuePosition: null,
  });
  if (updated) {
    const { agentHookBus } = await import('./hooks.js');
    agentHookBus.emitEvent({ type: 'run.dequeued', run: updated });
  }
}
