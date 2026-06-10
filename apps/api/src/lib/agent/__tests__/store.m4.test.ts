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
    username: 'm4-store-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: 'm4-store-test',
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

describeDb('M4 Task 1: summary + pending_user_input_expires_at columns', { timeout: 15000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('defaults: insertAgentRun + getAgentRun → summary / pendingUserInputExpiresAt null', async () => {
    const ownerId = await ensureUser();
    const run = await agentStore.insertAgentRun(baseInsertInput(ownerId));
    expect(run.summary).toBeNull();
    expect(run.pendingUserInputExpiresAt).toBeNull();
    const re = await agentStore.getAgentRun(run.id);
    expect(re?.summary).toBeNull();
    expect(re?.pendingUserInputExpiresAt).toBeNull();
  });

  it("updateAgentRun: pendingUserInputExpiresAt round-trip", async () => {
    const ownerId = await ensureUser();
    const run = await agentStore.insertAgentRun(baseInsertInput(ownerId));
    const future = new Date(Date.now() + 24 * 3600 * 1000);
    const updated = await agentStore.updateAgentRun(run.id, {
      pendingUserInputExpiresAt: future,
    });
    expect(updated?.pendingUserInputExpiresAt?.getTime()).toBe(future.getTime());
    const re = await agentStore.getAgentRun(run.id);
    expect(re?.pendingUserInputExpiresAt?.getTime()).toBe(future.getTime());
  });

  it("updateAgentRun: pendingUserInputExpiresAt → null clears", async () => {
    const ownerId = await ensureUser();
    const run = await agentStore.insertAgentRun(baseInsertInput(ownerId));
    await agentStore.updateAgentRun(run.id, {
      pendingUserInputExpiresAt: new Date(),
    });
    const cleared = await agentStore.updateAgentRun(run.id, {
      pendingUserInputExpiresAt: null,
    });
    expect(cleared?.pendingUserInputExpiresAt).toBeNull();
  });

  it("updateAgentRun: summary round-trip", async () => {
    const ownerId = await ensureUser();
    const run = await agentStore.insertAgentRun(baseInsertInput(ownerId));
    const summary = {
      stepCount: 5,
      toolCount: 2,
      toolBreakdown: { search_web: 2, fetch_url: 1 },
      refCount: 3,
    };
    const updated = await agentStore.updateAgentRun(run.id, { summary });
    expect(updated?.summary).toEqual(summary);
    const re = await agentStore.getAgentRun(run.id);
    expect(re?.summary).toEqual(summary);
  });
});
