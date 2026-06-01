/**
 * M7 T2a：store 层 topic slot 查询函数测试。
 *
 * 覆盖：
 *   - findBlockingActiveOnTopic：排除 queued
 *   - findQueuedHeadOnTopic：FIFO 取队首
 *   - countBlockingPlusQueuedOnTopic：union count
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { getPool } from '../../../db/client.js';
import * as store from '../store.js';
import type { AgentRunStatus } from '../types.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';

async function insertRunRaw(opts: {
  ownerId: string;
  topicId: string;
  groupId: string;
  status: AgentRunStatus;
  createdAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
       status, input_text, budget, api_key_source, created_at, last_heartbeat_at)
     VALUES ($1, $2, 'group', $3, $4, 'generalist',
       $5, 'test', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
       'server', $6, NULL)`,
    [id, opts.ownerId, opts.groupId, opts.topicId, opts.status, opts.createdAt ?? new Date()],
  );
  return id;
}

describe('store topic slot queries (M7 T2a)', () => {
  let owner: { id: string };
  let groupId: string;
  let topicId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-store');
    const g = await ensureGroup(owner.id, 'm7-t2a-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
  });

  it('findBlockingActiveOnTopic excludes queued runs', async () => {
    const runningId = await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'running' });
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'queued' });
    const r = await store.findBlockingActiveOnTopic(topicId);
    expect(r?.id).toBe(runningId);
  });

  it('findBlockingActiveOnTopic returns null when only queued', async () => {
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'queued' });
    const r = await store.findBlockingActiveOnTopic(topicId);
    expect(r).toBeNull();
  });

  it('findQueuedHeadOnTopic returns FIFO oldest', async () => {
    const t0 = new Date(Date.now() - 5000);
    const t1 = new Date(Date.now() - 3000);
    const t2 = new Date(Date.now() - 1000);
    const a = await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'queued', createdAt: t0 });
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'queued', createdAt: t1 });
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'queued', createdAt: t2 });
    const r = await store.findQueuedHeadOnTopic(topicId);
    expect(r?.id).toBe(a);
  });

  it('countBlockingPlusQueuedOnTopic includes both sets', async () => {
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'running' });
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'awaiting_user_input' });
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'queued' });
    await insertRunRaw({ ownerId: owner.id, groupId, topicId, status: 'completed' }); // 不算
    const n = await store.countBlockingPlusQueuedOnTopic(topicId);
    expect(n).toBe(3);
  });
});
