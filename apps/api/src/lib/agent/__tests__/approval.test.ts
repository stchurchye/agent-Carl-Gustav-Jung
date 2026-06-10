import { expect, it, beforeAll, beforeEach } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import {
  approveRun,
  denyRun,
  autoResolveExpiredApprovals,
} from '../approval.js';
import { registerRiskyEcho, riskyEchoTool } from '../tools/riskyEcho.js';
import { toolRegistry } from '../toolRegistry.js';
import { ensureUser } from './_groupFixture.js';

async function mkAwaiting(
  ownerId: string,
  toolName: string,
  untilOffsetMs = 60_000,
) {
  const r = await store.insertAgentRun({
    ownerId,
    channel: 'private',
    sessionId: null,
    groupId: null,
    topicId: null,
    intentTurnId: null,
    role: 'generalist',
    status: 'running',
    inputText: 'x',
    budget: DEFAULT_BUDGET,
    apiKeySource: 'server',
    apiKeyOwnerId: null,
  });
  await store.updateAgentRun(r.id, {
    status: 'awaiting_approval',
    pendingApprovalToolName: toolName,
    awaitingApprovalUntil: new Date(Date.now() + untilOffsetMs),
  });
  return r.id;
}

describeDb('approval (let-go model)', () => {
  beforeAll(async () => {
    await runMigrations();
    registerRiskyEcho();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('approveRun: awaiting → running + writes approval_grant', async () => {
    const u = await ensureUser('ap');
    const id = await mkAwaiting(u.id, riskyEchoTool.name);
    expect(await approveRun(id, u.id)).toBe(true);
    const r = await store.getAgentRun(id);
    expect(r?.status).toBe('running');
    expect(r?.pendingApprovalToolName).toBeNull();
    expect(r?.awaitingApprovalUntil).toBeNull();
    expect(r?.lastHeartbeatAt).toBeNull();
    const steps = await store.listSteps(id);
    expect(steps.some((s) => s.kind === 'approval_grant')).toBe(true);
  });

  it('denyRun: awaiting → replanning (NOT cancelled) + writes approval_deny', async () => {
    const u = await ensureUser('dn');
    const id = await mkAwaiting(u.id, riskyEchoTool.name);
    expect(await denyRun(id, u.id, 'no')).toBe(true);
    const r = await store.getAgentRun(id);
    expect(r?.status).toBe('replanning');
    const steps = await store.listSteps(id);
    const denyStep = steps.find((s) => s.kind === 'approval_deny');
    expect(denyStep).toBeDefined();
    expect(denyStep!.byUserId).toBe(u.id);
  });

  it('approve/deny return false on non-awaiting status', async () => {
    const u = await ensureUser('na');
    const r = await store.insertAgentRun({
      ownerId: u.id,
      channel: 'private',
      sessionId: null,
      groupId: null,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status: 'running',
      inputText: 'x',
      budget: DEFAULT_BUDGET,
      apiKeySource: 'server',
      apiKeyOwnerId: null,
    });
    expect(await approveRun(r.id, u.id)).toBe(false);
    expect(await denyRun(r.id, u.id)).toBe(false);
  });

  it('autoResolveExpiredApprovals: low-cost tool auto-grants', async () => {
    const u = await ensureUser('tl');
    toolRegistry.register({
      ...riskyEchoTool,
      name: 'low_risky',
      costHint: 'low',
    });
    const id = await mkAwaiting(u.id, 'low_risky', -1_000);
    const n = await autoResolveExpiredApprovals(new Date());
    expect(n).toBe(1);
    const r = await store.getAgentRun(id);
    expect(r?.status).toBe('running');
    const steps = await store.listSteps(id);
    expect(
      steps.some(
        (s) =>
          s.kind === 'approval_timeout' &&
          (s.output as { auto?: string } | null)?.auto === 'granted',
      ),
    ).toBe(true);
  });

  it('autoResolveExpiredApprovals: medium-cost tool auto-denies → replanning', async () => {
    const u = await ensureUser('tm');
    const id = await mkAwaiting(u.id, riskyEchoTool.name, -1_000);
    await autoResolveExpiredApprovals(new Date());
    const r = await store.getAgentRun(id);
    expect(r?.status).toBe('replanning');
    const steps = await store.listSteps(id);
    expect(
      steps.some(
        (s) =>
          s.kind === 'approval_timeout' &&
          (s.output as { auto?: string } | null)?.auto === 'denied',
      ),
    ).toBe(true);
  });

  it('not-yet-expired runs are not auto-resolved', async () => {
    const u = await ensureUser('nx');
    await mkAwaiting(u.id, riskyEchoTool.name, 60_000);
    const n = await autoResolveExpiredApprovals(new Date());
    expect(n).toBe(0);
  });
});
