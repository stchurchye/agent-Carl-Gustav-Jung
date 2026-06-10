import { beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'crypto';

import { describeDb } from '../../../testUtils/dbGuard.js';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun, executeRun } from '../runtime.js';
import { getAgentRun, insertStep, listSteps, maxStepIdx, updateAgentRun } from '../store.js';
import { applyReplanningIfNeeded } from '../runExecuteHelpers.js';
import type { Plan } from '../types.js';

/**
 * issue 0005(P0-S4)exec 期:plan 含未注册 toolName(缓存/陈旧 plan 漏过 parse 校验)
 * → 不悬挂、不直接 failed,先 replan 一次(带 tool_error 让 planner 看到「工具 X 不存在」);
 * 已经 replan 过一次仍遇未知 → failed 终态,error 写明工具名。
 */

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

function unknownToolPlan(toolName = 'ghost_tool_xyz'): Plan {
  return {
    intentSummary: 'stale plan with unknown tool',
    steps: [{ toolName, input: {}, reason: 'r', todoId: 't1' }],
    todos: [{ id: 't1', text: 't', status: 'pending', stepRefs: [] }],
    finalReplyHint: '',
    reasoning: null,
    version: 1,
  };
}

async function mkRunWithPlan(plan: Plan) {
  const user = await ensureUser('unktool');
  const sess = await createChatSession(user.id, 'unktool');
  const { run } = await createAgentRun({
    ownerId: user.id,
    channel: 'private',
    sessionId: sess.id,
    inputText: 'exec unknown tool',
    apiKey: 'fake',
    apiKeySource: 'server',
  });
  await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });
  return run;
}

describeDb('exec 期未知工具 → replan 一次再 failed (issue 0005)', () => {
  beforeAll(async () => {
    await runMigrations();
    const { registerEchoSleep } = await import('../tools/echoSleep.js');
    registerEchoSleep();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('首遇未知工具 → status=replanning + replan{reason:unknown_tool} + tool_error 点名', async () => {
    const run = await mkRunWithPlan(unknownToolPlan());

    await executeRun(run.id);

    const after = (await getAgentRun(run.id))!;
    expect(after.status).toBe('replanning');

    const steps = await listSteps(run.id);
    const replan = steps.find(
      (s) => s.kind === 'replan' && (s.output as { reason?: string })?.reason === 'unknown_tool',
    );
    expect(replan).toBeDefined();
    expect((replan!.output as { toolName?: string }).toolName).toBe('ghost_tool_xyz');

    // tool_error step 让 buildPreviousFailureSummary 把「工具 X 不存在」喂给 planner 重规划
    const toolErr = steps.find((s) => s.kind === 'tool_error');
    expect(toolErr).toBeDefined();
    expect(toolErr!.toolName).toBe('ghost_tool_xyz');
    expect(toolErr!.error).toContain('ghost_tool_xyz');
  });

  it('已 replan 过一次仍遇未知工具 → failed 终态,error 写明工具名', async () => {
    const run = await mkRunWithPlan(unknownToolPlan());
    const idx = (await maxStepIdx(run.id)) + 1;
    await insertStep({
      runId: run.id,
      idx,
      kind: 'replan',
      output: { reason: 'unknown_tool', toolName: 'ghost_tool_xyz' },
    });

    await executeRun(run.id);

    const after = (await getAgentRun(run.id))!;
    expect(after.status).toBe('failed');
    // run 级无 error 列;失败原因经 softComplete(detail) 落 artifact.finalContent(「[任务失败:…]」)
    expect(after.artifact?.finalContent ?? '').toContain('ghost_tool_xyz');
    // 且 tool_error step 持久点名(审计可查)
    const toolErrs = (await listSteps(run.id)).filter((s) => s.kind === 'tool_error');
    expect(toolErrs.length).toBeGreaterThanOrEqual(1);
    expect(toolErrs.at(-1)!.error ?? '').toContain('ghost_tool_xyz');
  });

  it('applyReplanningIfNeeded:最新一步是 unknown_tool replan → 只清 plan,不补幻影 critique replan', async () => {
    const run = await mkRunWithPlan(unknownToolPlan());
    const idx = (await maxStepIdx(run.id)) + 1;
    await insertStep({
      runId: run.id,
      idx,
      kind: 'replan',
      output: { reason: 'unknown_tool', toolName: 'ghost_tool_xyz' },
    });
    await updateAgentRun(run.id, { status: 'replanning' });
    const stale = (await getAgentRun(run.id))!;

    const updated = await applyReplanningIfNeeded(stale);

    expect(updated.plan).toBeNull();
    expect(updated.status).toBe('running');
    const replans = (await listSteps(run.id)).filter((s) => s.kind === 'replan');
    expect(replans.length).toBe(1); // 没有第二条 critique_or_unspecified 幻影
  });
});
