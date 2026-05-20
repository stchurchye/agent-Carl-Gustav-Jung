import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { registerEchoSleep } from '../tools/echoSleep.js';
import { createAgentRun, executeRun, cancelRun } from '../runtime.js';
import { getAgentRun, listSteps } from '../store.js';

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

describe('agent runtime end-to-end (echo)', () => {
  beforeAll(async () => {
    await runMigrations();
    registerEchoSleep();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('creates a run + runs 3 echo steps to completion', async () => {
    const user = await ensureUser('e2e');
    const session = await createChatSession(user.id, 'agent test');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: '跑三步 echo',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    expect(run.status).toBe('draft');
    await executeRun(run.id);
    const after = await getAgentRun(run.id);
    expect(after?.status).toBe('completed');
    const steps = await listSteps(run.id);
    const kinds = steps.map((s) => s.kind);
    expect(kinds).toContain('plan');
    expect(kinds.filter((k) => k === 'tool_call').length).toBe(3);
    expect(kinds[kinds.length - 1]).toBe('reply');
  });

  it('respects cancellation mid-run', async () => {
    const user = await ensureUser('cxl');
    const session = await createChatSession(user.id, 'cxl');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: '跑 5 步 echo',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    const exec = executeRun(run.id);
    await new Promise((r) => setTimeout(r, 800));
    await cancelRun(run.id, user.id);
    await exec;
    const after = await getAgentRun(run.id);
    expect(after?.status).toBe('cancelled');
    expect(after?.cancelReason).toBe('user');
  });

  it('soft-completes when budget exhausts on steps', async () => {
    const user = await ensureUser('bgt');
    const session = await createChatSession(user.id, 'bgt');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: '跑 5 步 echo',
      apiKey: 'fake',
      apiKeySource: 'server',
      budget: { maxSteps: 2, maxSeconds: 600, maxTokens: 100_000 },
    });
    await executeRun(run.id);
    const after = await getAgentRun(run.id);
    expect(after?.status).toBe('budget_exhausted');
    const steps = await listSteps(run.id);
    expect(steps.filter((s) => s.kind === 'tool_call').length).toBeLessThanOrEqual(2);

    // M1d T14：finalContent 应当展示已花费明细 + 上限
    const pool = (await import('../../../db/client.js')).getPool();
    const { rows } = await pool.query(
      `SELECT payload->>'content' AS content FROM private_chat_messages WHERE id = $1`,
      [after!.resultMessageId],
    );
    const content = rows[0]?.content as string;
    expect(content).toContain('预算已用尽');
    expect(content).toMatch(/步骤\s*2\/2/);
    expect(content).toContain('再试一次');
  });
});
