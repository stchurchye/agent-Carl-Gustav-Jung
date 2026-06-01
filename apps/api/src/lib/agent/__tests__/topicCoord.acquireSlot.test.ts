/**
 * M7 T2b：acquireTopicSlot 决策测试（TB1-TB5 + TB16 覆盖）。
 *
 * TB1: private / 无 active → create_fresh
 * TB2: 同 owner 任意时间 → merge
 * TB3: 跨 owner 30s 内 → merge with mergedByUserId
 * TB4: 跨 owner 30s 后 → queue with precedingCount
 * TB5: parentRunId 存在 → 强制 create_fresh
 * TB16: 同 topic 1 running + 1 queued → findBlocking 只返 running；不 merge 到 queued
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getPool } from '../../../db/client.js';
import { acquireTopicSlot, withTopicCoordination, type SlotDecision } from '../topicCoord.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';
import { randomUUID } from 'crypto';

/**
 * Helper：跑一次 withTopicCoordination 并把决策返出来（测试关注 decision，不做实际写入）。
 * 用真实 helper 而非裸 acquireTopicSlot，可以一并验证 advisory lock 不会自锁/死锁。
 */
async function decide(input: Parameters<typeof acquireTopicSlot>[0]): Promise<SlotDecision> {
  if (input.channel !== 'group' || !input.topicId) {
    return acquireTopicSlot(input);
  }
  return withTopicCoordination(input.topicId, (client) => acquireTopicSlot(input, client));
}

async function insertRun(opts: {
  ownerId: string;
  topicId: string | null;
  groupId: string | null;
  status: string;
  createdAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
       status, input_text, budget, api_key_source, created_at)
     VALUES ($1, $2, $3, $4, $5, 'generalist',
       $6, 'test', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
       'server', $7)`,
    [
      id,
      opts.ownerId,
      opts.groupId ? 'group' : 'private',
      opts.groupId,
      opts.topicId,
      opts.status,
      opts.createdAt ?? new Date(),
    ],
  );
  return id;
}

describe('acquireTopicSlot (M7 T2b)', () => {
  let user1: { id: string };
  let user2: { id: string };
  let groupId: string;
  let topicId: string;

  beforeEach(async () => {
    user1 = await ensureUser('m7-u1');
    user2 = await ensureUser('m7-u2');
    const g = await ensureGroup(user1.id, 'm7-t2b-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
  });

  // TB1
  it('private channel → always create_fresh', async () => {
    const d = await decide({
      channel: 'private',
      topicId: null,
      ownerId: user1.id,
    });
    expect(d.action).toBe('create_fresh');
  });

  // TB1.1
  it('group with no active → create_fresh', async () => {
    const d = await decide({
      channel: 'group',
      topicId,
      ownerId: user1.id,
    });
    expect(d.action).toBe('create_fresh');
  });

  // TB5
  it('parentRunId set → force create_fresh', async () => {
    await insertRun({ ownerId: user1.id, groupId, topicId, status: 'running' });
    const d = await decide({
      channel: 'group',
      topicId,
      ownerId: user1.id,
      parentRunId: 'p1',
    });
    expect(d.action).toBe('create_fresh');
  });

  // TB2
  it('same owner active → merge regardless of age', async () => {
    const blockingId = await insertRun({
      ownerId: user1.id, groupId, topicId, status: 'running',
      createdAt: new Date(Date.now() - 5 * 60_000), // 5 min ago
    });
    const d = await decide({
      channel: 'group',
      topicId,
      ownerId: user1.id,
    });
    expect(d.action).toBe('merge');
    if (d.action === 'merge') {
      expect(d.targetRunId).toBe(blockingId);
      expect(d.mergedByUserId).toBeUndefined();
    }
  });

  // TB3
  it('cross owner within 30s → merge with mergedByUserId', async () => {
    const blockingId = await insertRun({
      ownerId: user1.id, groupId, topicId, status: 'running',
      createdAt: new Date(Date.now() - 5_000),
    });
    const d = await decide({
      channel: 'group',
      topicId,
      ownerId: user2.id,
    });
    expect(d.action).toBe('merge');
    if (d.action === 'merge') {
      expect(d.targetRunId).toBe(blockingId);
      expect(d.mergedByUserId).toBe(user2.id);
    }
  });

  // TB4
  it('cross owner after 30s window → queue with precedingCount', async () => {
    await insertRun({
      ownerId: user1.id, groupId, topicId, status: 'running',
      createdAt: new Date(Date.now() - 60_000),
    });
    const d = await decide({
      channel: 'group',
      topicId,
      ownerId: user2.id,
    });
    expect(d.action).toBe('queue');
    if (d.action === 'queue') {
      expect(d.precedingCount).toBe(1);
    }
  });

  // TB16
  it('queued runs do not count as blocking', async () => {
    await insertRun({
      ownerId: user1.id, groupId, topicId, status: 'running',
      createdAt: new Date(Date.now() - 60_000),
    });
    await insertRun({
      ownerId: user1.id, groupId, topicId, status: 'queued',
      createdAt: new Date(Date.now() - 30_000),
    });
    // u2 进来：blocking = running，跨 owner 60s 前 → queue（precedingCount=2: 1 running + 1 queued）
    const d = await decide({
      channel: 'group',
      topicId,
      ownerId: user2.id,
    });
    expect(d.action).toBe('queue');
    if (d.action === 'queue') {
      expect(d.precedingCount).toBe(2);
    }
  });

  // 契约保护：群聊不传 client 直接调 acquireTopicSlot 必抛错
  it('group channel without client throws contract error', async () => {
    await expect(
      acquireTopicSlot({ channel: 'group', topicId, ownerId: user1.id }),
    ).rejects.toThrow(/withTopicCoordination/);
  });
});
