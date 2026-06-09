import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';

import { runMigrations } from '../../../db/migrate.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun, executeRun } from '../runtime.js';
import { getAgentRun, listSteps, updateAgentRun } from '../store.js';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { registerDatetimeNow } from '../tools/datetimeNow.js';
import { registerRenderDiagram } from '../tools/renderDiagram.js';
import { SUBAGENT_TOOL_WHITELIST } from '../subagentTools.js';
import { applyReplanningIfNeeded } from '../runExecuteHelpers.js';
import { recordStep } from '../stepRecorder.js';
import type { Plan } from '../types.js';

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

/**
 * M3-S0 安全护栏：子 agent(`parentRunId` 非空)的可用工具白名单
 * `SUBAGENT_TOOL_WHITELIST` 此前只在 planner-time 生效。续跑 / steer / 缓存 plan
 * 等路径能绕过 planner 裁剪，让子 run 在 exec-time 执行白名单外工具(含副作用的
 * run_python / deep_research)。本测试把白名单升级为 exec-time 硬约束:
 *
 *  1. 子 run + 白名单外工具 → handler 不被调用，记 approval_deny step，run 不 fail。
 *  2. 非子 run(parentRunId=null) + 同一白名单外工具 → handler 正常被调用(护栏不误伤顶层)。
 *  3. 子 run + 白名单内工具(datetime_now) → handler 正常被调用。
 */
describe('M3-S0 subagent tool whitelist exec-time guard', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  /** 注册一个白名单外、带"调用计数"的探针工具，返回工具名 + 取计数闭包。 */
  function registerCountingProbe(): { name: string; calls: () => number } {
    const probeName = 'guard_probe_' + randomUUID().slice(0, 8);
    let calls = 0;
    const probe: ToolDef<{ q: string }, { ok: true; data: string }> = {
      name: probeName,
      description: 'non-whitelisted side-effecting probe (M3-S0 guard fixture)',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
      approvalMode: 'auto',
      hasSideEffects: true,
      idempotent: false,
      async handler() {
        calls += 1;
        return { ok: true, data: 'side-effect happened' };
      },
    };
    toolRegistry.register(probe);
    // 前置断言:探针确实在白名单外,否则本测试无意义。
    expect(SUBAGENT_TOOL_WHITELIST.has(probeName)).toBe(false);
    return { name: probeName, calls: () => calls };
  }

  function oneStepPlan(toolName: string): Plan {
    return {
      intentSummary: 'guard probe',
      steps: [{ toolName, input: { q: 'x' }, reason: 'probe', todoId: 't1' }],
      todos: [{ id: 't1', text: 'probe', status: 'pending', stepRefs: [] }],
      finalReplyHint: 'done',
      reasoning: null,
      version: 1,
    };
  }

  it('子 run + 白名单外工具 → handler 不被调用、记 subagent_tool_denied step、整条越权 plan 零工作 → run 硬失败', async () => {
    const { name: probeName, calls } = registerCountingProbe();

    const user = await ensureUser('guardchild');
    const session = await createChatSession(user.id, 'guardchild');

    // 先建一个父 run 当 parentRunId 锚点。
    const { run: parent } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'parent',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    // 子 run:parentRunId 非空。plan 含白名单外工具(模拟续跑/缓存 plan 绕过 planner 裁剪)。
    const { run: child } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'child with forbidden tool',
      apiKey: 'fake',
      apiKeySource: 'server',
      parentRunId: parent.id,
    });
    await updateAgentRun(child.id, {
      plan: oneStepPlan(probeName),
      todos: oneStepPlan(probeName).todos,
      status: 'running',
    });

    await executeRun(child.id);

    // handler 绝不能被调用(副作用被挡住)。
    expect(calls()).toBe(0);

    const steps = await listSteps(child.id);
    // 不应有该工具的 tool_call step。
    const toolCall = steps.find(
      (s) => s.kind === 'tool_call' && s.toolName === probeName,
    );
    expect(toolCall).toBeUndefined();
    // 应有一条专用 subagent_tool_denied step（不复用 approval_deny，避免被
    // applyReplanningIfNeeded 误判成 denyIsNewest 触发 echo 替代 plan）。
    const deny = steps.find(
      (s) => s.kind === 'subagent_tool_denied' && s.toolName === probeName,
    );
    expect(deny).toBeDefined();
    expect(deny?.error).toMatch(/subagent/i);
    // 不得复用 approval_deny kind（语义串台守卫）。
    expect(steps.some((s) => s.kind === 'approval_deny')).toBe(false);

    // 整条 plan 越权、零工作 → 不能向父 run 报 completed，应硬失败。
    const finalRun = await getAgentRun(child.id);
    expect(finalRun?.status).toBe('failed');
  });

  it('非子 run(parentRunId=null) + 同一白名单外工具 → handler 正常被调用(护栏不误伤顶层)', async () => {
    const { name: probeName, calls } = registerCountingProbe();

    const user = await ensureUser('guardtop');
    const session = await createChatSession(user.id, 'guardtop');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'top-level with forbidden-for-subagent tool',
      apiKey: 'fake',
      apiKeySource: 'server',
      // parentRunId 缺省 → null
    });
    await updateAgentRun(run.id, {
      plan: oneStepPlan(probeName),
      todos: oneStepPlan(probeName).todos,
      status: 'running',
    });

    await executeRun(run.id);

    // 顶层 run 不受白名单约束:handler 必须被调用。
    expect(calls()).toBe(1);
    const steps = await listSteps(run.id);
    const toolCall = steps.find(
      (s) => s.kind === 'tool_call' && s.toolName === probeName,
    );
    expect(toolCall).toBeDefined();
    const finalRun = await getAgentRun(run.id);
    expect(finalRun?.status).toBe('completed');
  });

  it('子 run + 白名单内工具(datetime_now) → handler 正常被调用', async () => {
    registerDatetimeNow();
    expect(SUBAGENT_TOOL_WHITELIST.has('datetime_now')).toBe(true);

    const user = await ensureUser('guardallow');
    const session = await createChatSession(user.id, 'guardallow');
    const { run: parent } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'parent2',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    const { run: child } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'child with allowed tool',
      apiKey: 'fake',
      apiKeySource: 'server',
      parentRunId: parent.id,
    });
    const plan: Plan = {
      intentSummary: 'allowed tool',
      steps: [{ toolName: 'datetime_now', input: {}, reason: 'probe', todoId: 't1' }],
      todos: [{ id: 't1', text: 'probe', status: 'pending', stepRefs: [] }],
      finalReplyHint: 'done',
      reasoning: null,
      version: 1,
    };
    await updateAgentRun(child.id, {
      plan,
      todos: plan.todos,
      status: 'running',
    });

    await executeRun(child.id);

    const steps = await listSteps(child.id);
    // 白名单内工具应正常产生 tool_call step(handler 跑了)。
    const toolCall = steps.find(
      (s) => s.kind === 'tool_call' && s.toolName === 'datetime_now',
    );
    expect(toolCall).toBeDefined();
    const out = toolCall?.output as { result?: { ok?: boolean } } | null;
    expect(out?.result?.ok).toBe(true);
    // 不应被白名单护栏拒绝。
    const deny = steps.find((s) => s.kind === 'approval_deny');
    expect(deny).toBeUndefined();
  });

  it('护栏拦截后该子 run 进入 replanning → 不被误判成 deny-replan（不生成 echo 替代 plan）', async () => {
    const { name: probeName } = registerCountingProbe();

    const user = await ensureUser('guardreplan');
    const session = await createChatSession(user.id, 'guardreplan');
    const { run: parent } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'parent3',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    const { run: child } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'child denied then replans',
      apiKey: 'fake',
      apiKeySource: 'server',
      parentRunId: parent.id,
    });
    const origPlan = oneStepPlan(probeName);
    await updateAgentRun(child.id, {
      plan: origPlan,
      todos: origPlan.todos,
      status: 'running',
    });

    // 1) 跑一轮:护栏写 subagent_tool_denied step。
    await executeRun(child.id);
    const afterGuard = await listSteps(child.id);
    expect(
      afterGuard.some((s) => s.kind === 'subagent_tool_denied'),
    ).toBe(true);

    // 2) 模拟外部触发把该子 run 推回 replanning(plan 仍是原 plan),再过
    //    applyReplanningIfNeeded —— 若护栏复用了 approval_deny,这里会被 denyIsNewest 命中,
    //    走 deny 重规划分支(记 directive「用户拒绝了工具 X」+ 清 plan → LLM 误当换方案)。
    const replanning = (await updateAgentRun(child.id, {
      plan: origPlan,
      status: 'replanning',
    }))!;
    const after = await applyReplanningIfNeeded(replanning);

    // critique/unspecified 分支应清空 plan(让 buildInitialPlan 重生成),
    // 绝不应落到 deny-echo 替代 plan。
    expect(after.plan).toBeNull();
    const steps = await listSteps(child.id);
    const echoReplan = steps.find(
      (s) =>
        s.kind === 'replan' &&
        (s.output as { intentSummary?: string } | null)?.intentSummary?.includes(
          'after deny',
        ),
    );
    expect(echoReplan).toBeUndefined();
    // 也不应残留 echo_after_sleep 工具的 step。
    expect(
      steps.some(
        (s) =>
          (s.output as { steps?: { toolName?: string }[] } | null)?.steps?.some(
            (st) => st.toolName === 'echo_after_sleep',
          ),
      ),
    ).toBe(false);
  });

  it('M3-S1: 子 run role=analyst → analyst 专属工具(render_diagram)放行；role=researcher → 同工具被拦', async () => {
    registerRenderDiagram();
    const user = await ensureUser('roleguard');
    const session = await createChatSession(user.id, 'roleguard');
    const { run: parent } = await createAgentRun({
      ownerId: user.id, channel: 'private', sessionId: session.id,
      inputText: 'parent', apiKey: 'fake', apiKeySource: 'server',
    });
    const diagramPlan = (): Plan => ({
      intentSummary: 'diagram',
      steps: [{ toolName: 'render_diagram', input: { mermaid: 'graph TD; A-->B', title: 't' }, reason: 'r', todoId: 't1' }],
      todos: [{ id: 't1', text: 'd', status: 'pending', stepRefs: [] }],
      finalReplyHint: 'done', reasoning: null, version: 1,
    });

    // role=researcher：render_diagram 不在子集 → exec 守卫拦截。
    const { run: childR } = await createAgentRun({
      ownerId: user.id, channel: 'private', sessionId: session.id,
      inputText: 'r', apiKey: 'fake', apiKeySource: 'server',
      parentRunId: parent.id, role: 'researcher',
    });
    await updateAgentRun(childR.id, { plan: diagramPlan(), todos: diagramPlan().todos, status: 'running' });
    await executeRun(childR.id);
    const rSteps = await listSteps(childR.id);
    expect(rSteps.some((s) => s.kind === 'subagent_tool_denied' && s.toolName === 'render_diagram')).toBe(true);
    expect(rSteps.some((s) => s.kind === 'tool_call' && s.toolName === 'render_diagram')).toBe(false);

    // role=analyst：render_diagram 在子集 → 放行(有 tool_call,无 denied)。
    const { run: childA } = await createAgentRun({
      ownerId: user.id, channel: 'private', sessionId: session.id,
      inputText: 'a', apiKey: 'fake', apiKeySource: 'server',
      parentRunId: parent.id, role: 'analyst',
    });
    await updateAgentRun(childA.id, { plan: diagramPlan(), todos: diagramPlan().todos, status: 'running' });
    await executeRun(childA.id);
    const aSteps = await listSteps(childA.id);
    expect(aSteps.some((s) => s.kind === 'subagent_tool_denied' && s.toolName === 'render_diagram')).toBe(false);
    expect(aSteps.some((s) => s.kind === 'tool_call' && s.toolName === 'render_diagram')).toBe(true);
  });
});
