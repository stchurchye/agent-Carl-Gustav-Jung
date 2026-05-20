import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { registerRiskyEcho, riskyEchoTool } from '../tools/riskyEcho.js';
import { autoResolveExpiredApprovals } from '../approval.js';
import { ensureUser } from './_groupFixture.js';

describe('autoResolveExpiredApprovals (worker tick)', () => {
  beforeAll(async () => {
    await runMigrations();
    registerRiskyEcho();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('processes only expired runs (1 expired + 1 not-yet-expired)', async () => {
    const u = await ensureUser('w');
    const r1 = await store.insertAgentRun({
      ownerId: u.id,
      channel: 'private',
      sessionId: null,
      groupId: null,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status: 'awaiting_approval',
      inputText: 'x',
      budget: DEFAULT_BUDGET,
      apiKeySource: 'server',
      apiKeyOwnerId: null,
    });
    await store.updateAgentRun(r1.id, {
      pendingApprovalToolName: riskyEchoTool.name,
      awaitingApprovalUntil: new Date(Date.now() - 1_000),
    });
    const r2 = await store.insertAgentRun({
      ownerId: u.id,
      channel: 'private',
      sessionId: null,
      groupId: null,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status: 'awaiting_approval',
      inputText: 'y',
      budget: DEFAULT_BUDGET,
      apiKeySource: 'server',
      apiKeyOwnerId: null,
    });
    await store.updateAgentRun(r2.id, {
      pendingApprovalToolName: riskyEchoTool.name,
      awaitingApprovalUntil: new Date(Date.now() + 30_000),
    });

    const n = await autoResolveExpiredApprovals(new Date());
    expect(n).toBe(1);
    // r1 是 medium-cost (riskyEchoTool) → auto-deny → replanning
    expect((await store.getAgentRun(r1.id))?.status).toBe('replanning');
    expect((await store.getAgentRun(r2.id))?.status).toBe('awaiting_approval');
  });

  it('returns 0 when nothing is expired', async () => {
    const n = await autoResolveExpiredApprovals(new Date());
    expect(n).toBe(0);
  });
});
