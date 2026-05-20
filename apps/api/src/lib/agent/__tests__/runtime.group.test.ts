import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { registerEchoSleep } from '../tools/echoSleep.js';
import { createAgentRun, executeRun, cancelRun } from '../runtime.js';
import { getAgentRun, listSteps } from '../store.js';
import { ensureUser, ensureGroup, addMember } from './_groupFixture.js';

/**
 * 群聊 e2e（AC1 + AC2）：
 * - 跑三步 echo 到 completed，placeholder content/job status 同步更新
 * - 跨成员取消（AC2）：成员（非 owner）取消 owner 发起的群聊任务，应正常 cancelled
 */
describe('agent runtime group e2e', () => {
  beforeAll(async () => {
    await runMigrations();
    registerEchoSleep();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    await getPool().query('DELETE FROM llm_invoke_jobs');
  });

  it('runs 3 echo steps and finalize updates group placeholder + llm_invoke_jobs', async () => {
    const owner = await ensureUser('rg-owner');
    const { groupId, topicId } = await ensureGroup(owner.id);
    const { run, placeholderMessageId, llmJobId } = await createAgentRun({
      ownerId: owner.id,
      channel: 'group',
      groupId,
      topicId,
      inputText: '帮我跑三步 echo',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    expect(placeholderMessageId).toBeTruthy();
    expect(llmJobId).toBeTruthy();

    await executeRun(run.id);

    const after = await getAgentRun(run.id);
    expect(after?.status).toBe('completed');
    const steps = await listSteps(run.id);
    expect(steps.filter((s) => s.kind === 'tool_call').length).toBe(3);

    const { rows: phRows } = await getPool().query(
      `SELECT payload FROM group_messages WHERE id = $1`,
      [placeholderMessageId],
    );
    expect(phRows[0].payload?.agentRun?.status).toBe('completed');
    expect(typeof phRows[0].payload?.content).toBe('string');
    expect(phRows[0].payload.content.length).toBeGreaterThan(0);

    const { rows: jrRows } = await getPool().query(
      `SELECT status FROM llm_invoke_jobs WHERE id = $1`,
      [llmJobId],
    );
    expect(jrRows[0].status).toBe('done');
  });

  it('AC2: any group member can cancel an owner-initiated group run', async () => {
    const owner = await ensureUser('rg-o2');
    const member = await ensureUser('rg-m2');
    const { groupId, topicId } = await ensureGroup(owner.id);
    await addMember(groupId, member.id, 'member');

    const { run, placeholderMessageId, llmJobId } = await createAgentRun({
      ownerId: owner.id,
      channel: 'group',
      groupId,
      topicId,
      inputText: '跑三步 echo',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    // 成员（非 owner）发起取消
    await cancelRun(run.id, member.id, 'user');
    // 启动 executeRun（应快速看到 cancelled 状态）
    await executeRun(run.id);

    const after = await getAgentRun(run.id);
    expect(['cancelled', 'failed']).toContain(after?.status);
    expect(after?.cancelReason).toBe('user');
    expect(after?.cancelledByUserId).toBe(member.id);

    const { rows: phRows } = await getPool().query(
      `SELECT payload FROM group_messages WHERE id = $1`,
      [placeholderMessageId],
    );
    expect(phRows[0].payload?.agentRun?.status).toBe('cancelled');

    const { rows: jrRows } = await getPool().query(
      `SELECT status FROM llm_invoke_jobs WHERE id = $1`,
      [llmJobId],
    );
    expect(jrRows[0].status).toBe('failed');
  });
});
