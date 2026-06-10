/**
 * M7 TB6：softComplete / cancelRun on group run → topic 队首 dequeue。
 */
import { it, expect, beforeEach } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import { getPool } from '../../../db/client.js';
import { softComplete, cancelRun } from '../runLifecycle.js';
import * as store from '../store.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';
import { randomUUID } from 'crypto';

async function insertRun(opts: {
  ownerId: string;
  topicId: string;
  groupId: string;
  status: string;
}): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
       status, input_text, budget, api_key_source)
     VALUES ($1, $2, 'group', $3, $4, 'generalist',
       $5, 'test', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb, 'server')`,
    [id, opts.ownerId, opts.groupId, opts.topicId, opts.status],
  );
  return id;
}

describeDb('softComplete/cancelRun dequeues queued head (M7 TB6)', () => {
  let owner: { id: string };
  let groupId: string;
  let topicId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-tb6');
    const g = await ensureGroup(owner.id, 'tb6-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
  });

  it('completed → queued head → draft', async () => {
    const activeId = await insertRun({ ownerId: owner.id, groupId, topicId, status: 'running' });
    const queuedId = await insertRun({ ownerId: owner.id, groupId, topicId, status: 'queued' });
    const active = (await store.getAgentRun(activeId))!;

    await softComplete(active, 'completed');

    const { rows } = await getPool().query(
      `SELECT status, queue_position FROM agent_runs WHERE id = $1`,
      [queuedId],
    );
    expect(rows[0].status).toBe('draft');
    expect(rows[0].queue_position).toBeNull();
  });

  it('cancelled → queued head → draft', async () => {
    const activeId = await insertRun({ ownerId: owner.id, groupId, topicId, status: 'running' });
    const queuedId = await insertRun({ ownerId: owner.id, groupId, topicId, status: 'queued' });

    await cancelRun(activeId, owner.id);

    const { rows } = await getPool().query(
      `SELECT status FROM agent_runs WHERE id = $1`,
      [queuedId],
    );
    expect(rows[0].status).toBe('draft');
  });
});
