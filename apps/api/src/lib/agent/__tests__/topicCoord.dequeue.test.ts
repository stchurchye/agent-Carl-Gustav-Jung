/**
 * M7 T4a：dequeueNextOnTopic 测试（TB6 + TB16 集成）。
 */
import { it, expect, beforeEach } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import { getPool } from '../../../db/client.js';
import { dequeueNextOnTopic } from '../topicCoord.js';
import { agentHookBus } from '../hooks.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';
import { randomUUID } from 'crypto';

async function insertRun(opts: {
  ownerId: string;
  topicId: string;
  groupId: string;
  status: string;
  createdAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
       status, input_text, budget, api_key_source, created_at)
     VALUES ($1, $2, 'group', $3, $4, 'generalist',
       $5, 'test', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
       'server', $6)`,
    [id, opts.ownerId, opts.groupId, opts.topicId, opts.status, opts.createdAt ?? new Date()],
  );
  return id;
}

describeDb('dequeueNextOnTopic (M7 T4a)', () => {
  let owner: { id: string };
  let groupId: string;
  let topicId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-deq');
    const g = await ensureGroup(owner.id, 'm7-deq-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
  });

  it('dequeues FIFO head when no blocking exists', async () => {
    const oldId = await insertRun({
      ownerId: owner.id, groupId, topicId, status: 'queued',
      createdAt: new Date(Date.now() - 5_000),
    });
    await insertRun({
      ownerId: owner.id, groupId, topicId, status: 'queued',
      createdAt: new Date(Date.now() - 1_000),
    });

    const events: unknown[] = [];
    const off = agentHookBus.onEvent((e) => events.push(e));
    await dequeueNextOnTopic(topicId);
    off();

    const { rows } = await getPool().query(
      `SELECT id, status, queue_position FROM agent_runs WHERE id = $1`,
      [oldId],
    );
    expect(rows[0].status).toBe('draft');
    expect(rows[0].queue_position).toBeNull();

    const dequeued = events.find(
      (e) => (e as { type: string }).type === 'run.dequeued',
    );
    expect(dequeued).toBeDefined();
  });

  it('does nothing when blocking active still exists', async () => {
    await insertRun({ ownerId: owner.id, groupId, topicId, status: 'running' });
    const queuedId = await insertRun({
      ownerId: owner.id, groupId, topicId, status: 'queued',
    });
    await dequeueNextOnTopic(topicId);
    const { rows } = await getPool().query(
      `SELECT status FROM agent_runs WHERE id = $1`,
      [queuedId],
    );
    expect(rows[0].status).toBe('queued');
  });
});
