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
