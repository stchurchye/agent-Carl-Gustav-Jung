import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';

import { runMigrations } from '../../../db/migrate.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun, executeRun } from '../runtime.js';
import { getAgentRun, listSteps, updateAgentRun } from '../store.js';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import type { Plan } from '../types.js';

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

/**
 * M1f #5：runtime 必须把 `output.ok === false` 识别为 soft-fail —— 把 error 写到
 * step.error，但 run 整体仍然完成，让 planner / critique 后续可见。
 */
describe('M1f runtime soft-fail recognition (#5)', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  it('tool returns ok=false → tool_call step.error 被填、run 不 fail', async () => {
    const probeName = 'softfail_probe_' + randomUUID().slice(0, 8);
    const probe: ToolDef<{ q: string }, { ok: boolean; error?: string }> = {
      name: probeName,
      description: 'probe tool that returns ok=false (M1f test fixture)',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: true,
      async handler() {
        return { ok: false, error: 'simulated soft-fail' };
      },
    };
    toolRegistry.register(probe);

    const user = await ensureUser('sf');
    const session = await createChatSession(user.id, 'sf');

    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'soft fail probe',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    const plan: Plan = {
      intentSummary: 'soft-fail probe',
      steps: [
        {
          toolName: probeName,
          input: { q: 'x' },
          reason: 'probe',
          todoId: 't1',
        },
      ],
      todos: [
        { id: 't1', text: 'probe', status: 'pending', stepRefs: [] },
      ],
      finalReplyHint: 'done',
      reasoning: null,
      version: 1,
    };
    await updateAgentRun(run.id, {
      plan,
      todos: plan.todos,
      status: 'running',
    });

    await executeRun(run.id);

    const steps = await listSteps(run.id);
    const probeStep = steps.find(
      (s) => s.kind === 'tool_call' && s.toolName === probeName,
    );
    expect(probeStep).toBeDefined();
    expect(probeStep?.error).toMatch(/simulated soft-fail/);

    // run 不应被标 failed —— soft-fail 只是 observation 标记，让 planner 决定
    const finalRun = await getAgentRun(run.id);
    expect(finalRun?.status).not.toBe('failed');
    // 单步 plan 跑完后 run 应该 completed
    expect(finalRun?.status).toBe('completed');
  });

  // M1f Task 3 followup (review blocker 1)：连续 2 次 soft-fail 必须触发 critique
  // → critique stub 标 shouldReplan → run 状态变 replanning（让 worker 重新规划）。
  // 修复前 critique gate 只 count `kind === 'tool_error'`，soft-fail 永远进不来，
  // 多步全 soft-fail 一路 completed。
  it('M1f blocker 1: 2 连续 soft-fail → critique 触发、run 进 replanning', async () => {
    const probeName = 'softfail_replan_' + randomUUID().slice(0, 8);
    let calls = 0;
    const probe: ToolDef<{ q: string }, { ok: boolean; error: string }> = {
      name: probeName,
      description: 'always-soft-fail probe（用于测 critique gate）',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: false, // 避免幂等缓存吞掉第二次调用
      async handler() {
        calls += 1;
        return { ok: false, error: `simulated fail #${calls}` };
      },
    };
    toolRegistry.register(probe);

    const user = await ensureUser('sfreplan');
    const session = await createChatSession(user.id, 'sfreplan');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'force critique',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    // 3 步 plan：第 1、2 步走 probe → 2 次 soft-fail 累计 → critique gate 触发；
    // 第 3 步本应跑但 critique shouldReplan=true 后 run 进 replanning 提前 return。
    const plan: Plan = {
      intentSummary: 'force critique on soft-fail',
      steps: [
        { toolName: probeName, input: { q: 'a' }, reason: 'p1', todoId: 't1' },
        { toolName: probeName, input: { q: 'b' }, reason: 'p2', todoId: 't2' },
        { toolName: probeName, input: { q: 'c' }, reason: 'p3', todoId: 't3' },
      ],
      todos: [
        { id: 't1', text: 'p1', status: 'pending', stepRefs: [] },
        { id: 't2', text: 'p2', status: 'pending', stepRefs: [] },
        { id: 't3', text: 'p3', status: 'pending', stepRefs: [] },
      ],
      finalReplyHint: 'done',
      reasoning: null,
      version: 1,
    };
    await updateAgentRun(run.id, {
      plan,
      todos: plan.todos,
      status: 'running',
    });

    await executeRun(run.id);

    const steps = await listSteps(run.id);
    // 第 3 步不应该被执行 —— critique 在第 2 步后就让 run 进 replanning 提前 return。
    expect(calls).toBe(2);
    // critique step 存在
    const critiqueSteps = steps.filter((s) => s.kind === 'critique');
    expect(critiqueSteps.length).toBeGreaterThanOrEqual(1);
    // 至少有一个 critique 输出 shouldReplan: true
    const replanCritique = critiqueSteps.find((s) => {
      const out = s.output as { shouldReplan?: boolean } | null;
      return out?.shouldReplan === true;
    });
    expect(replanCritique).toBeDefined();
    // run 此时应在 replanning（等 worker 下次 pickup 重做 plan）
    const finalRun = await getAgentRun(run.id);
    expect(finalRun?.status).toBe('replanning');
  });

  it('tool returns ok=true / 无 ok 字段 → step.error 为 null（向后兼容）', async () => {
    const probeName = 'softfail_okay_' + randomUUID().slice(0, 8);
    const probe: ToolDef<{ q: string }, { ok: boolean; data: string }> = {
      name: probeName,
      description: 'probe tool that returns ok=true (M1f test fixture)',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: true,
      async handler() {
        return { ok: true, data: 'fine' };
      },
    };
    toolRegistry.register(probe);

    const user = await ensureUser('sfok');
    const session = await createChatSession(user.id, 'sfok');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'probe ok',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    const plan: Plan = {
      intentSummary: 'ok probe',
      steps: [
        {
          toolName: probeName,
          input: { q: 'x' },
          reason: 'probe',
          todoId: 't1',
        },
      ],
      todos: [{ id: 't1', text: 'probe', status: 'pending', stepRefs: [] }],
      finalReplyHint: 'done',
      reasoning: null,
      version: 1,
    };
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });
    await executeRun(run.id);

    const steps = await listSteps(run.id);
    const probeStep = steps.find(
      (s) => s.kind === 'tool_call' && s.toolName === probeName,
    );
    expect(probeStep).toBeDefined();
    expect(probeStep?.error).toBeFalsy();
    const finalRun = await getAgentRun(run.id);
    expect(finalRun?.status).toBe('completed');
  });
});
