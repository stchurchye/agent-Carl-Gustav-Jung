import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';

import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun, executeRun } from '../runtime.js';
import {
  getAgentRun,
  insertStep,
  listSteps,
  maxStepIdx,
  updateAgentRun,
} from '../store.js';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { applyReplanningIfNeeded } from '../runExecuteHelpers.js';
import type { Plan, PlanStep, TodoItem } from '../types.js';

/**
 * M1f polish #1 close-loop：critique-driven replan 必须真的清掉旧 plan，
 * 让 executeRun 重跑 buildInitialPlan，进而让 previousFailure 被传给 planner。
 *
 * 历史 bug：applyReplanningIfNeeded 对 critique-replan 不动 plan，executeRun
 * 的 `if (!run.plan)` gate 永远 false → buildInitialPlan 不再被调 →
 * previousFailure 永远不被传 → 重新规划仍跑旧 plan / 复现同样错。
 *
 * 测试矩阵：
 *  - applyReplanningIfNeeded 单元：3 个分支（deny / steer / critique）各自的 plan 走向
 *  - end-to-end：2 连续 soft-fail → critique 触发 → re-pickup → plan 被清 +
 *    重新生成（test env 走 echo plan 也能验证"plan 不再是旧 broken 的 3 步 plan"）
 */

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

function makePlan(opts: {
  intent: string;
  toolName: string;
  steps: number;
}): Plan {
  const todos: TodoItem[] = [];
  const steps: PlanStep[] = [];
  for (let i = 1; i <= opts.steps; i++) {
    const id = `t${i}`;
    todos.push({ id, text: `do ${i}`, status: 'pending', stepRefs: [] });
    steps.push({
      toolName: opts.toolName,
      input: { q: `q${i}` },
      reason: `step-${i}`,
      todoId: id,
    });
  }
  return {
    intentSummary: opts.intent,
    steps,
    todos,
    finalReplyHint: 'done',
    reasoning: null,
    version: 1,
  };
}

describe('applyReplanningIfNeeded: critique branch clears plan (M1f polish #1 finish)', () => {
  beforeAll(async () => {
    await runMigrations();
    // e2e 测试要让 buildInitialPlan 重生成出可执行的 echo plan,
    // echo_after_sleep 必须已注册（其他 file 也注册它，这里 idempotent）
    const { registerEchoSleep } = await import('../tools/echoSleep.js');
    registerEchoSleep();
  });

  beforeEach(async () => {
    // 隔离上下文 —— 别让别的 test 留下的 run 影响本 file。
    // 用 owner_id 过滤代价高，干脆清这两张表（其他 file 都靠 beforeEach 已 reset）。
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('critique-driven (无 steer/deny step) → plan 被清成 null + 写 replan step', async () => {
    const user = await ensureUser('crit');
    const sess = await createChatSession(user.id, 'crit');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'force critique replan',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    const plan = makePlan({ intent: 'old', toolName: 'echo_after_sleep', steps: 3 });
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'replanning' });
    const stale = (await getAgentRun(run.id))!;

    const updated = await applyReplanningIfNeeded(stale);

    expect(updated.plan).toBeNull();
    expect(updated.todos).toEqual([]);
    expect(updated.status).toBe('running');
    expect(updated.usage.steps).toBe(0);

    // DB 必须也写 null，不是只把 in-memory 对象清掉
    const dbRow = await getPool().query(
      `SELECT plan, todos FROM agent_runs WHERE id = $1`,
      [run.id],
    );
    expect(dbRow.rows[0].plan).toBeNull();
    expect(dbRow.rows[0].todos).toEqual([]);

    // 必须写一条 replan step，output.clearedPlan = true（审计 / 排查）
    const steps = await listSteps(run.id);
    const replanStep = steps.find((s) => s.kind === 'replan');
    expect(replanStep).toBeDefined();
    const out = replanStep!.output as { clearedPlan?: boolean; prevPlanVersion?: number };
    expect(out.clearedPlan).toBe(true);
    expect(out.prevPlanVersion).toBe(1);
  });

  it('steer-driven (lastSteer 是最新 trigger) → M1c: 清 plan + 记 replan{reason:steer,directive}', async () => {
    const user = await ensureUser('steer');
    const sess = await createChatSession(user.id, 'steer');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'steer flow',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    const steeredPlan = makePlan({
      intent: 'steered',
      toolName: 'echo_after_sleep',
      steps: 2,
    });
    await updateAgentRun(run.id, {
      plan: steeredPlan,
      todos: steeredPlan.todos,
      status: 'replanning',
    });
    const stepIdx = (await maxStepIdx(run.id)) + 1;
    await insertStep({
      runId: run.id,
      idx: stepIdx,
      kind: 'steer',
      input: { instruction: 'do thing', newPlanVersion: steeredPlan.version },
    });

    const stale = (await getAgentRun(run.id))!;
    const updated = await applyReplanningIfNeeded(stale);

    // M1c：steer 分支不再 no-op；清 plan 让 buildInitialPlan 走 LLM 真重规划。
    expect(updated.plan).toBeNull();
    expect(updated.status).toBe('running');

    // 写一条 replan{reason:'steer', directive=steer 指令}，供 buildInitialPlan/readStashedReplanDirective 读。
    const steps = await listSteps(run.id);
    const replan = steps.find((s) => s.kind === 'replan');
    expect(replan).toBeDefined();
    const out = replan!.output as { reason?: string; directive?: string };
    expect(out.reason).toBe('steer');
    expect(out.directive).toBe('do thing');
  });

  it('deny-driven (lastDeny 是最新 trigger) → M1c: 清 plan + 记 replan{reason:approval_deny,directive}', async () => {
    const user = await ensureUser('deny');
    const sess = await createChatSession(user.id, 'deny');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'deny flow',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    const oldPlan = makePlan({ intent: 'old', toolName: 'echo_after_sleep', steps: 3 });
    await updateAgentRun(run.id, {
      plan: oldPlan,
      todos: oldPlan.todos,
      status: 'replanning',
    });
    const stepIdx = (await maxStepIdx(run.id)) + 1;
    await insertStep({
      runId: run.id,
      idx: stepIdx,
      kind: 'approval_deny',
      toolName: 'some_tool',
      output: { reason: 'manual', by: 'user' },
    });

    const stale = (await getAgentRun(run.id))!;
    const updated = await applyReplanningIfNeeded(stale);

    // M1c：deny 不再用 echo 桩；清 plan 让 buildInitialPlan 走 LLM 重规划。
    expect(updated.plan).toBeNull();
    expect(updated.status).toBe('running');
    // M1c：被拒工具 append 到持久 run.deniedTools —— 跨后续 continuation replan 不丢。
    expect(updated.deniedTools).toContain('some_tool');

    // 写一条 replan{reason:approval_deny, directive(含被拒工具), deniedTool} 供审计。
    const steps = await listSteps(run.id);
    const replanStep = steps.find((s) => s.kind === 'replan');
    expect(replanStep).toBeDefined();
    const out = replanStep!.output as { reason?: string; directive?: string; deniedTool?: string };
    expect(out.reason).toBe('approval_deny');
    expect(out.deniedTool).toBe('some_tool');
    expect(out.directive).toMatch(/some_tool/);
  });

  // End-to-end: 2 连续 soft-fail 触发 critique → re-pickup 时 plan 被清 + 重新
  // 生成（test env 下 buildInitialPlan 走 echo plan，但仍能观察到"plan 不再
  // 是旧的 3 步 probe plan"）。
  it('e2e: 2 soft-fails → critique → re-pickup 清旧 plan + 新 plan 生成 + 跑到 completed', async () => {
    const probeName = 'replanloop_probe_' + randomUUID().slice(0, 8);
    let calls = 0;
    const probe: ToolDef<{ q: string }, { ok: boolean; error?: string }> = {
      name: probeName,
      description: 'always-soft-fail probe',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: false,
      async handler() {
        calls += 1;
        return { ok: false, error: `simulated fail #${calls}` };
      },
    };
    toolRegistry.register(probe);

    const user = await ensureUser('e2e');
    const sess = await createChatSession(user.id, 'e2e');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      // 关键：inputText 含 'echo' 让 test-env buildInitialPlan 走 generatePlanForEcho，
      // 重新生成出能走完的 echo plan，避免依赖 LLM stub
      inputText: 'echo 1 一步',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    const oldPlan: Plan = {
      intentSummary: 'old broken plan',
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
      plan: oldPlan,
      todos: oldPlan.todos,
      status: 'running',
    });

    // 第 1 次 executeRun：跑 2 步 probe → 2 soft-fails → critique 触发 →
    // status=replanning，提前 return。第 3 步不应执行。
    await executeRun(run.id);
    expect(calls).toBe(2);
    let cur = (await getAgentRun(run.id))!;
    expect(cur.status).toBe('replanning');
    // plan 此时还没被清 —— applyReplanningIfNeeded 只在下次 pickup 才跑
    expect(cur.plan?.intentSummary).toBe('old broken plan');

    // 第 2 次 executeRun (worker re-pickup)：applyReplanningIfNeeded 清 plan
    // → buildInitialPlan 生成新 plan（test env 走 echo plan）→ 跑完 → completed
    await executeRun(run.id);
    cur = (await getAgentRun(run.id))!;

    // 关键断言：plan 被替换了，不再是旧的 3 步 probe plan
    expect(cur.plan).not.toBeNull();
    expect(cur.plan!.intentSummary).not.toBe('old broken plan');
    expect(
      cur.plan!.steps.every((s) => s.toolName === probeName),
    ).toBe(false); // 新 plan 用 echo_after_sleep，不会全是 probe
    expect(cur.status).toBe('completed');

    // probe 没被再调 —— 新 plan 已经不引用它
    expect(calls).toBe(2);

    // 审计：必须有一条 replan step 标 clearedPlan=true
    const steps = await listSteps(run.id);
    const replanStep = steps.find(
      (s) => s.kind === 'replan' &&
        (s.output as { clearedPlan?: boolean })?.clearedPlan === true,
    );
    expect(replanStep).toBeDefined();
    expect(
      (replanStep!.output as { prevPlanVersion?: number }).prevPlanVersion,
    ).toBe(1);
  });
});
