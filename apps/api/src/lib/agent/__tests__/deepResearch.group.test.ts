/**
 * M7 TB11：deep_research 群聊子 run。
 *
 * 验证：
 *   - 父 channel=group → 子 channel=group + 同 topic
 *   - 子 placeholder 仅 1 条 ai 消息（无 human）
 *   - acquireTopicSlot 不被合并（parentRunId 强制 create_fresh）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPool } from '../../../db/client.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';
import { randomUUID } from 'crypto';

// Mock dispatchChildRun 不真跑（避免 LLM）。
vi.mock('../childExecutor.js', () => ({
  dispatchChildRun: vi.fn(async (id: string) => {
    const { getPool } = await import('../../../db/client.js');
    await getPool().query(
      `UPDATE agent_runs SET status='completed', ended_at=NOW() WHERE id=$1`,
      [id],
    );
  }),
}));

describe('deep_research group child run (M7 TB11)', () => {
  let owner: { id: string };
  let groupId: string;
  let topicId: string;
  let parentId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-dr');
    const g = await ensureGroup(owner.id, 'dr-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
    parentId = randomUUID();
    await getPool().query(
      `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
         status, input_text, budget, api_key_source)
       VALUES ($1, $2, 'group', $3, $4, 'generalist',
         'running', 'main', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
         'server')`,
      [parentId, owner.id, groupId, topicId],
    );
  });

  it('spawns child in same group/topic with 1 ai placeholder only', async () => {
    const { deepResearchTool } = await import('../tools/deepResearch.js');
    const ctx = {
      runId: parentId, stepId: 'step-1', ownerId: owner.id,
      channel: 'group' as const,
      groupId, topicId,
      signal: new AbortController().signal,
    };
    const before = await getPool().query(
      `SELECT COUNT(*)::int AS c FROM group_messages WHERE group_id=$1 AND topic_id=$2`,
      [groupId, topicId],
    );
    const result = await deepResearchTool.handler({ question: 'subtopic xyz' }, ctx);
    expect(result.ok).toBe(true);

    // 子 run 同 group/topic
    const { rows } = await getPool().query(
      `SELECT channel, group_id, topic_id FROM agent_runs WHERE parent_run_id = $1`,
      [parentId],
    );
    expect(rows[0].channel).toBe('group');
    expect(rows[0].group_id).toBe(groupId);
    expect(rows[0].topic_id).toBe(topicId);

    // group_messages 只多 1 条
    const after = await getPool().query(
      `SELECT COUNT(*)::int AS c FROM group_messages WHERE group_id=$1 AND topic_id=$2`,
      [groupId, topicId],
    );
    expect(after.rows[0].c - before.rows[0].c).toBe(1);

    // 那条是 ai
    const { rows: msgs } = await getPool().query(
      `SELECT payload FROM group_messages WHERE group_id=$1 AND topic_id=$2 ORDER BY created_at DESC LIMIT 1`,
      [groupId, topicId],
    );
    const p = msgs[0].payload as { kind?: string };
    expect(p.kind).toBe('ai');
  });
});
