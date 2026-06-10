import { it, expect, beforeAll, beforeEach } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import { randomUUID } from 'crypto';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as agentStore from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';

async function ensureUser(): Promise<string> {
  const u = await createUser({
    username: 'm3-store-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: 'm3-store-test',
  });
  return u.id;
}

function baseInsertInput(ownerId: string): agentStore.InsertAgentRunInput {
  return {
    ownerId,
    channel: 'private',
    sessionId: null,
    groupId: null,
    topicId: null,
    intentTurnId: null,
    role: 'generalist',
    status: 'draft',
    inputText: 'hi',
    budget: DEFAULT_BUDGET,
    apiKeySource: 'server',
    apiKeyOwnerId: null,
  };
}

describeDb('M3 Task 1: parent_run_id + pending_user_* columns', { timeout: 15000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('defaults: insertAgentRun + getAgentRun → parentRunId / pendingUserPrompt / pendingUserStepIdx all null', async () => {
    const ownerId = await ensureUser();
    const run = await agentStore.insertAgentRun(baseInsertInput(ownerId));
    expect(run.parentRunId).toBeNull();
    expect(run.pendingUserPrompt).toBeNull();
    expect(run.pendingUserStepIdx).toBeNull();

    const fetched = await agentStore.getAgentRun(run.id);
    expect(fetched?.parentRunId).toBeNull();
    expect(fetched?.pendingUserPrompt).toBeNull();
    expect(fetched?.pendingUserStepIdx).toBeNull();
  });

  it('insertAgentRun with parentRunId → getAgentRun returns the same parent', async () => {
    const ownerId = await ensureUser();
    const parent = await agentStore.insertAgentRun(baseInsertInput(ownerId));
    const child = await agentStore.insertAgentRun({
      ...baseInsertInput(ownerId),
      parentRunId: parent.id,
    });
    expect(child.parentRunId).toBe(parent.id);
    const fetched = await agentStore.getAgentRun(child.id);
    expect(fetched?.parentRunId).toBe(parent.id);
  });

  it("updateAgentRun: status='awaiting_user_input' + pendingUserPrompt + pendingUserStepIdx round-trip", async () => {
    const ownerId = await ensureUser();
    const run = await agentStore.insertAgentRun(baseInsertInput(ownerId));

    const updated = await agentStore.updateAgentRun(run.id, {
      status: 'awaiting_user_input',
      pendingUserPrompt: '需要你确认下选哪个城市？',
      pendingUserStepIdx: 3,
    });
    expect(updated?.status).toBe('awaiting_user_input');
    expect(updated?.pendingUserPrompt).toBe('需要你确认下选哪个城市？');
    expect(updated?.pendingUserStepIdx).toBe(3);

    const re = await agentStore.getAgentRun(run.id);
    expect(re?.status).toBe('awaiting_user_input');
    expect(re?.pendingUserPrompt).toBe('需要你确认下选哪个城市？');
    expect(re?.pendingUserStepIdx).toBe(3);
  });

  it('updateAgentRun: clearing pendingUserPrompt / pendingUserStepIdx back to null persists', async () => {
    const ownerId = await ensureUser();
    const run = await agentStore.insertAgentRun(baseInsertInput(ownerId));
    await agentStore.updateAgentRun(run.id, {
      status: 'awaiting_user_input',
      pendingUserPrompt: 'q?',
      pendingUserStepIdx: 2,
    });
    const cleared = await agentStore.updateAgentRun(run.id, {
      status: 'running',
      pendingUserPrompt: null,
      pendingUserStepIdx: null,
    });
    expect(cleared?.status).toBe('running');
    expect(cleared?.pendingUserPrompt).toBeNull();
    expect(cleared?.pendingUserStepIdx).toBeNull();

    const re = await agentStore.getAgentRun(run.id);
    expect(re?.pendingUserPrompt).toBeNull();
    expect(re?.pendingUserStepIdx).toBeNull();
  });
});
