import { expect, it, beforeAll, beforeEach } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import {
  writeGroupPlaceholder,
  finalizeGroupPlaceholder,
} from '../messageBridge.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';

/**
 * T8: 群聊 message bridge 集成测试。
 * 验证写入 invoke + placeholderAi + llm_invoke_jobs 三方关联，以及 finalize 终态写回。
 */
describeDb('messageBridge group placeholder', () => {
  beforeAll(async () => await runMigrations());

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    await getPool().query('DELETE FROM llm_invoke_jobs');
  });

  it('writes invoke + placeholderAi + pending llm job, all linked by llmJobId', async () => {
    const u = await ensureUser('mb-g');
    const { groupId, topicId } = await ensureGroup(u.id);
    const agentRunId = randomUUID();
    const r = await writeGroupPlaceholder({
      userId: u.id,
      groupId,
      topicId,
      inputText: '帮我跑三步 echo',
      agentRunId,
    });

    expect(r.invokeMessageId).toBeDefined();
    expect(r.placeholderAiMessageId).toBeDefined();
    expect(r.llmJobId).toBeDefined();

    const { rows: invRows } = await getPool().query(
      `SELECT payload FROM group_messages WHERE id = $1`,
      [r.invokeMessageId],
    );
    expect(invRows[0].payload?.agentRun?.agentRunId).toBe(agentRunId);
    expect(invRows[0].payload?.agentRun?.llmJobId).toBe(r.llmJobId);
    expect(invRows[0].payload?.agentRun?.role).toBe('invoker');
    expect(invRows[0].payload?.content).toBe('帮我跑三步 echo');

    const { rows: phRows } = await getPool().query(
      `SELECT payload FROM group_messages WHERE id = $1`,
      [r.placeholderAiMessageId],
    );
    expect(phRows[0].payload?.agentRun?.agentRunId).toBe(agentRunId);
    expect(phRows[0].payload?.agentRun?.llmJobId).toBe(r.llmJobId);
    expect(phRows[0].payload?.agentRun?.status).toBe('draft');
    expect(phRows[0].payload?.content).toBe('[Agent 任务进行中…]');

    const { rows: jobRows } = await getPool().query(
      `SELECT status, group_id, topic_id FROM llm_invoke_jobs WHERE id = $1`,
      [r.llmJobId],
    );
    expect(jobRows[0].status).toBe('pending');
    expect(jobRows[0].group_id).toBe(groupId);
    expect(jobRows[0].topic_id).toBe(topicId);
  });

  it('finalize completed → payload.content updated + agentRun.status=completed + job status=done', async () => {
    const u = await ensureUser('mb-fin');
    const { groupId, topicId } = await ensureGroup(u.id);
    const r = await writeGroupPlaceholder({
      userId: u.id,
      groupId,
      topicId,
      inputText: 'x',
      agentRunId: randomUUID(),
    });
    await finalizeGroupPlaceholder({
      ownerId: u.id,
      llmJobId: r.llmJobId,
      placeholderAiMessageId: r.placeholderAiMessageId,
      finalContent: '已完成 3 步 echo',
      status: 'completed',
    });

    const { rows } = await getPool().query(
      `SELECT payload FROM group_messages WHERE id = $1`,
      [r.placeholderAiMessageId],
    );
    expect(rows[0].payload?.content).toBe('已完成 3 步 echo');
    expect(rows[0].payload?.agentRun?.status).toBe('completed');
    // llmJobId 应保留
    expect(rows[0].payload?.agentRun?.llmJobId).toBe(r.llmJobId);

    const { rows: jr } = await getPool().query(
      `SELECT status, result_message_id FROM llm_invoke_jobs WHERE id = $1`,
      [r.llmJobId],
    );
    expect(jr[0].status).toBe('done');
    expect(jr[0].result_message_id).toBe(r.placeholderAiMessageId);
  });

  it('finalize cancelled maps llm job to failed status', async () => {
    const u = await ensureUser('mb-cxl');
    const { groupId, topicId } = await ensureGroup(u.id);
    const r = await writeGroupPlaceholder({
      userId: u.id,
      groupId,
      topicId,
      inputText: 'x',
      agentRunId: randomUUID(),
    });
    await finalizeGroupPlaceholder({
      ownerId: u.id,
      llmJobId: r.llmJobId,
      placeholderAiMessageId: r.placeholderAiMessageId,
      finalContent: '[任务已取消]',
      status: 'cancelled',
    });
    const { rows: jr } = await getPool().query(
      `SELECT status FROM llm_invoke_jobs WHERE id = $1`,
      [r.llmJobId],
    );
    expect(jr[0].status).toBe('failed');
  });

  it('finalize budget_exhausted maps llm job to failed status', async () => {
    const u = await ensureUser('mb-be');
    const { groupId, topicId } = await ensureGroup(u.id);
    const r = await writeGroupPlaceholder({
      userId: u.id,
      groupId,
      topicId,
      inputText: 'x',
      agentRunId: randomUUID(),
    });
    await finalizeGroupPlaceholder({
      ownerId: u.id,
      llmJobId: r.llmJobId,
      placeholderAiMessageId: r.placeholderAiMessageId,
      finalContent: '[预算已用尽]',
      status: 'budget_exhausted',
    });
    const { rows: jr } = await getPool().query(
      `SELECT status FROM llm_invoke_jobs WHERE id = $1`,
      [r.llmJobId],
    );
    expect(jr[0].status).toBe('failed');
  });
});
