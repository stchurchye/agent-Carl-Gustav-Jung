import { beforeAll, beforeEach, expect, vi, afterEach } from 'vitest';
import { describeDb, itDb } from '../../../testUtils/dbGuard.js';
import { randomUUID } from 'crypto';

import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun, executeRun } from '../runtime.js';
import { getAgentRun, insertStep, listSteps, updateAgentRun } from '../store.js';
import { recordReclaimIfNeeded } from '../runExecuteHelpers.js';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import type { Plan } from '../types.js';

/**
 * Review 2026-06-11 [P2][agent-runtime] runExecute.ts:186 / :727
 *
 * :186 — replanning 重置 usage.steps=0 后 worker 崩溃、worker B re-pickup 时
 *   status 已是 'running'(applyReplanningIfNeeded 已切),enteredViaReplanning=false。
 *   旧版 reclaim 把**旧 plan 时代**的推进步也算进 dbAdvancing → completedCount
 *   超过新 plan 长度,新 plan 被整体跳过、run 假完成;审计 reclaim 步数据失真。
 *   修后:只数最近一条 kind='plan' 步之后的推进步(新 plan 时代)。
 *
 * :727 — reflection LLM 调用非 abort 异常被静默吞掉(fail-open 收尾本身保留),
 *   连一条日志都没有。修后:console.warn 记录,可观测。
 */

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

function planOf(toolName: string, n: number): Plan {
  return {
    intentSummary: 'reclaim probe',
    steps: Array.from({ length: n }, (_, i) => ({
      toolName,
      input: { q: `q${i}` },
      reason: `p${i}`,
      todoId: `t${i}`,
    })),
    todos: Array.from({ length: n }, (_, i) => ({
      id: `t${i}`,
      text: `p${i}`,
      status: 'pending' as const,
      stepRefs: [],
    })),
    finalReplyHint: 'done',
    reasoning: null,
    version: 2,
  };
}

describeDb('recordReclaimIfNeeded 只看新 plan 时代的推进步', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  async function makeRunWithHistory(opts: { newEraToolCalls: number; usageSteps: number }) {
    const user = await ensureUser('reclaim');
    const sess = await createChatSession(user.id, 'reclaim');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'reclaim probe',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    // 旧 plan 时代:plan + 3 tool_call + replan(steer)
    let idx = 0;
    await insertStep({ runId: run.id, idx: idx++, kind: 'plan', output: { v: 1 } });
    for (let i = 0; i < 3; i++) {
      await insertStep({
        runId: run.id,
        idx: idx++,
        kind: 'tool_call',
        toolName: 'x',
        output: { result: { ok: true } },
      });
    }
    await insertStep({
      runId: run.id,
      idx: idx++,
      kind: 'replan',
      output: { reason: 'steer', directive: 'go' },
    });
    // 新 plan 时代:plan + N tool_call
    await insertStep({ runId: run.id, idx: idx++, kind: 'plan', output: { v: 2 } });
    for (let i = 0; i < opts.newEraToolCalls; i++) {
      await insertStep({
        runId: run.id,
        idx: idx++,
        kind: 'tool_call',
        toolName: 'x',
        output: { result: { ok: true } },
      });
    }
    const plan = planOf('x', 3);
    const updated = (await updateAgentRun(run.id, {
      plan,
      todos: plan.todos,
      status: 'running',
      usage: { ...run.usage, steps: opts.usageSteps },
    }))!;
    return updated;
  }

  itDb('usage 与新时代步数一致 → 不触发 reclaim(旧时代的 4 步不连坐)', async () => {
    const run = await makeRunWithHistory({ newEraToolCalls: 1, usageSteps: 1 });
    const { completedCount } = await recordReclaimIfNeeded(run, false);
    expect(completedCount).toBe(1); // 旧版:dbAdvancing=4 → completedCount=4,新 plan 被跳过
    const steps = await listSteps(run.id);
    expect(steps.some((s) => s.kind === 'reclaim')).toBe(false);
  });

  itDb('新时代确有未入账步 → 仍正确 reclaim,数字只含新时代', async () => {
    const run = await makeRunWithHistory({ newEraToolCalls: 2, usageSteps: 1 });
    const { completedCount } = await recordReclaimIfNeeded(run, false);
    expect(completedCount).toBe(2);
    const steps = await listSteps(run.id);
    const reclaim = steps.find((s) => s.kind === 'reclaim');
    expect(reclaim).toBeDefined();
    expect((reclaim!.output as { dbAdvancing?: number }).dbAdvancing).toBe(2);
  });
});

describeDb('reflection 非 abort 异常不再静默吞掉', () => {
  const realFetch = global.fetch;
  const ORIGINAL_VITEST = process.env.VITEST;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_DS = process.env.DEEPSEEK_API_KEY;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    // 仿 reflection.test.ts:test env 下 reflection 分支被机械信号短路,需切到 production
    delete process.env.VITEST;
    process.env.NODE_ENV = 'production';
    process.env.DEEPSEEK_API_KEY = 'sk-fake-server-key';
    const mod = await import('../runLlmClient.js');
    mod._resetRunLlmClientNoticeDedup();
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
    if (ORIGINAL_VITEST === undefined) delete process.env.VITEST;
    else process.env.VITEST = ORIGINAL_VITEST;
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_DS === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = ORIGINAL_DS;
  });

  itDb('reflection LLM 连接失败 → fail-open 收尾 completed,但留下 warn 日志', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('Connection refused');
    }) as unknown as typeof fetch;
    const warnSpy = vi.spyOn(console, 'warn');

    const okToolName = 'reflect_fail_' + randomUUID().slice(0, 8);
    const probe: ToolDef<Record<string, never>, { ok: boolean }> = {
      name: okToolName,
      description: 'always ok',
      inputSchema: { type: 'object', properties: {} },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: false,
      async handler() {
        return { ok: true };
      },
    };
    toolRegistry.register(probe);

    const user = await ensureUser('reflwarn');
    const sess = await createChatSession(user.id, 'reflwarn');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: '反思失败探针',
      apiKey: 'sk-fake',
      apiKeySource: 'server',
    });
    await updateAgentRun(run.id, {
      status: 'running',
      plan: {
        intentSummary: 'x',
        steps: [{ toolName: okToolName, input: {}, reason: 'r', todoId: 't1' }],
        todos: [{ id: 't1', text: 't1', status: 'pending', stepRefs: [] }],
        finalReplyHint: 'h',
        reasoning: null,
        version: 1,
      },
    });

    await executeRun(run.id);

    const after = await getAgentRun(run.id);
    expect(after?.status).toBe('completed'); // fail-open 保留
    const calls = warnSpy.mock.calls.map((c) => c.join(' '));
    expect(calls.some((c) => c.includes('reflection'))).toBe(true); // 旧版:无任何日志
  });
});
