/**
 * M7 T5e：contextAdapter group 分支末尾拼 user_message_appended 作为 history。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getPool } from '../../../db/client.js';
import { snapshotForAgent } from '../contextAdapter.js';
import { applyMergeInTx } from '../store.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';
import { randomUUID } from 'crypto';

async function insertRun(opts: {
  ownerId: string;
  topicId: string;
  groupId: string;
}): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
       status, input_text, budget, api_key_source)
     VALUES ($1, $2, 'group', $3, $4, 'generalist',
       'running', 'main', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
       'server')`,
    [id, opts.ownerId, opts.groupId, opts.topicId],
  );
  return id;
}

describe('contextAdapter group includes user_message_appended (M7 T5e)', () => {
  let owner: { id: string };
  let groupId: string;
  let topicId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-ctx');
    const g = await ensureGroup(owner.id, 'ctx-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
  });

  it('appends user_message_appended step content as user history', async () => {
    const runId = await insertRun({ ownerId: owner.id, groupId, topicId });
    await applyMergeInTx(runId, {
      text: '追问 P4',
      byUserId: owner.id,
      byUsername: '小赵',
      at: new Date().toISOString(),
    });
    const snap = await snapshotForAgent({
      runId,
      userId: owner.id,
      channel: 'group',
      groupId, topicId,
      pendingUser: 'next q',
      apiKey: '',
    } as Parameters<typeof snapshotForAgent>[0]);
    const merged = snap.history.find(
      (m) => m.role === 'user' && m.content.includes('追问 P4'),
    );
    expect(merged).toBeDefined();
    expect(merged!.content).toContain('小赵');
  });
});
