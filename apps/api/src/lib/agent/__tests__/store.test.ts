import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as agentStore from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';

async function ensureUser(name: string): Promise<string> {
  const u = await createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
  return u.id;
}

describe('agent store', { timeout: 15000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('creates and reads an agent run', async () => {
    const ownerId = await ensureUser('runner');
    const created = await agentStore.insertAgentRun({
      ownerId,
      channel: 'private',
      sessionId: null,
      groupId: null,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status: 'draft',
      inputText: 'hello',
      budget: DEFAULT_BUDGET,
      apiKeySource: 'user',
      apiKeyOwnerId: ownerId,
    });
    expect(created.id).toBeDefined();
    expect(created.status).toBe('draft');
    const fetched = await agentStore.getAgentRun(created.id);
    expect(fetched?.inputText).toBe('hello');
    expect(fetched?.budget.maxSteps).toBe(20);
    expect(fetched?.usage.steps).toBe(0);
  });

  it('updates status and usage', async () => {
    const ownerId = await ensureUser('u2');
    const r = await agentStore.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'draft',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await agentStore.updateAgentRun(r.id, {
      status: 'running',
      usage: { steps: 1, elapsedSeconds: 5, tokens: 100, costCny: 0.01 },
      lastHeartbeatAt: new Date(),
    });
    const after = await agentStore.getAgentRun(r.id);
    expect(after?.status).toBe('running');
    expect(after?.usage.tokens).toBe(100);
    expect(after?.lastHeartbeatAt).toBeTruthy();
  });

  it('inserts steps and lists by idx', async () => {
    const ownerId = await ensureUser('u3');
    const r = await agentStore.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await agentStore.insertStep({ runId: r.id, idx: 0, kind: 'plan', input: { hi: 1 } });
    await agentStore.insertStep({ runId: r.id, idx: 1, kind: 'tool_call', toolName: 'echo', input: { x: 1 }, output: { x: 1 } });
    const steps = await agentStore.listSteps(r.id);
    expect(steps.length).toBe(2);
    expect(steps[0].kind).toBe('plan');
    expect(steps[1].toolName).toBe('echo');
  });

  it('inserts step idempotently (UNIQUE run_id, idx)', async () => {
    const ownerId = await ensureUser('u4');
    const r = await agentStore.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await agentStore.insertStep({ runId: r.id, idx: 0, kind: 'plan' });
    await expect(
      agentStore.insertStep({ runId: r.id, idx: 0, kind: 'plan' }),
    ).rejects.toThrow();
  });

  it('finds step by tool_call_key', async () => {
    const ownerId = await ensureUser('u5');
    const r = await agentStore.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await agentStore.insertStep({
      runId: r.id, idx: 0, kind: 'tool_call', toolName: 'echo',
      toolCallKey: 'k1', input: { x: 1 }, output: { x: 1 },
    });
    const found = await agentStore.findStepByToolCallKey(r.id, 'k1');
    expect(found?.toolName).toBe('echo');
  });

  it('pickupNextRun returns oldest stale run', async () => {
    const ownerId = await ensureUser('u6');
    const r = await agentStore.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'draft',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    const picked = await agentStore.pickupNextRun();
    expect(picked?.id).toBe(r.id);
    expect(picked?.lastHeartbeatAt).toBeTruthy();
  });
});
