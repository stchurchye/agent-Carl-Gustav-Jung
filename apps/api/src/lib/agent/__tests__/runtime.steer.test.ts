import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createChatSession } from '../../../store/pg.js';
import { registerEchoSleep } from '../tools/echoSleep.js';
import { executeRun } from '../runtime.js';
import { steerRun } from '../steer.js';
import { generatePlanForEcho } from '../planner.js';
import { runControllers } from '../runtimeRegistry.js';
import * as store from '../store.js';
import { writePrivatePlaceholder } from '../messageBridge.js';
import { ensureUser } from './_groupFixture.js';

describe('runtime steer e2e (T11)', () => {
  beforeAll(async () => {
    await runMigrations();
    registerEchoSleep();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    runControllers.clear();
  });

  it('steer mid-run aborts current step, replans, and runs new plan to completion', async () => {
    const u = await ensureUser('st');
    const s = await createChatSession(u.id, 'st');
    const run = await store.insertAgentRun({
      ownerId: u.id,
      channel: 'private',
      sessionId: s.id,
      groupId: null,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status: 'draft',
      inputText: '跑 5 步 echo',
      budget: { maxSteps: 20, maxSeconds: 600, maxTokens: 100_000 },
      apiKeySource: 'server',
      apiKeyOwnerId: null,
    });
    const ph = await writePrivatePlaceholder({
      userId: u.id,
      sessionId: s.id,
      inputText: '跑 5 步 echo',
      agentRunId: run.id,
    });
    await store.updateAgentRun(run.id, {
      resultMessageId: ph.placeholderMessageId,
    });
    const plan = generatePlanForEcho('跑 5 步 echo'); // 5 steps × 1500ms = 7.5s
    await store.updateAgentRun(run.id, {
      plan,
      todos: plan.todos,
      status: 'running',
    });

    // 启动 executeRun（并行），1.8s 后 steer
    const exec = executeRun(run.id);
    await new Promise((r) => setTimeout(r, 1_800));
    const steerRes = await steerRun({
      runId: run.id,
      byUserId: u.id,
      instruction: '改成跑两步',
    });
    expect(steerRes.accepted).toBe(true);
    await exec; // executeRun 因 abort('steer') 直接 return，无 throw

    const mid = await store.getAgentRun(run.id);
    expect(mid?.status).toBe('replanning');
    expect(mid?.plan?.version).toBe(2);
    expect(mid?.plan?.steps.length).toBe(2);

    // 模拟 worker re-pickup → 走 replanning 分支 → 跑新 plan 2 steps
    await executeRun(run.id);
    const final = await store.getAgentRun(run.id);
    expect(final?.status).toBe('completed');

    const steps = await store.listSteps(run.id);
    const kinds = steps.map((s) => s.kind);
    expect(kinds).toContain('steer');

    // 强断言：steer 之后正好 2 次 tool_call（对应新 plan 的 2 步）
    const steerIdx = steps.findIndex((s) => s.kind === 'steer');
    const toolCallsAfterSteer = steps
      .slice(steerIdx + 1)
      .filter((s) => s.kind === 'tool_call').length;
    expect(toolCallsAfterSteer).toBe(2);
  });
});
