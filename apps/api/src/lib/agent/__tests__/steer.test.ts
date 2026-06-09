import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { steerRun } from '../steer.js';
import { generatePlanForEcho } from '../planner.js';
import { runControllers } from '../runtimeRegistry.js';
import { ensureUser } from './_groupFixture.js';

async function mkRunningWithPlan(ownerId: string, text = '跑 5 步 echo') {
  const r = await store.insertAgentRun({
    ownerId,
    channel: 'private',
    sessionId: null,
    groupId: null,
    topicId: null,
    intentTurnId: null,
    role: 'generalist',
    status: 'running',
    inputText: text,
    budget: DEFAULT_BUDGET,
    apiKeySource: 'server',
    apiKeyOwnerId: null,
  });
  const plan = generatePlanForEcho(text);
  await store.updateAgentRun(r.id, { plan, todos: plan.todos });
  return (await store.getAgentRun(r.id))!;
}

describe('steerRun', () => {
  beforeAll(async () => await runMigrations());
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    runControllers.clear();
  });

  it('accepted: clears plan + status → replanning, steer step records instruction (M1c LLM replan deferred to worker)', async () => {
    const u = await ensureUser('s1');
    const run = await mkRunningWithPlan(u.id);
    const res = await steerRun({
      runId: run.id,
      byUserId: u.id,
      instruction: '改成跑两步',
    });
    expect(res.accepted).toBe(true);
    const after = await store.getAgentRun(run.id);
    expect(after?.status).toBe('replanning');
    // M1c：steer 不再同步生成 echo plan；清 plan 让 worker re-pickup 走 LLM 真重规划。
    expect(after?.plan).toBeNull();
    // M1c：持久改向字段写入 —— 跨后续 continuation replan 不丢。
    expect(after?.steerDirective).toBe('改成跑两步');
    const steps = await store.listSteps(run.id);
    const steerStep = steps.find((s) => s.kind === 'steer');
    expect(steerStep).toBeDefined();
    expect((steerStep?.input as { instruction?: string })?.instruction).toBe('改成跑两步');
  });

  it('aborts the active controller if present', async () => {
    const u = await ensureUser('sa');
    const run = await mkRunningWithPlan(u.id);
    const ctl = new AbortController();
    runControllers.set(run.id, ctl);
    expect(ctl.signal.aborted).toBe(false);
    await steerRun({
      runId: run.id,
      byUserId: u.id,
      instruction: '改成跑两步',
    });
    expect(ctl.signal.aborted).toBe(true);
  });

  it('rejected on terminal status', async () => {
    const u = await ensureUser('s2');
    const run = await mkRunningWithPlan(u.id);
    await store.updateAgentRun(run.id, {
      status: 'completed',
      endedAt: new Date(),
    });
    const res = await steerRun({
      runId: run.id,
      byUserId: u.id,
      instruction: 'x',
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toBe('terminal');
  });

  it('rejected when run has no plan', async () => {
    const u = await ensureUser('s3');
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
    const res = await steerRun({
      runId: r.id,
      byUserId: u.id,
      instruction: 'x',
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toBe('no_plan');
  });
});
