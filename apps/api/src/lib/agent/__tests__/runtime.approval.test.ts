import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createChatSession } from '../../../store/pg.js';
import { registerEchoSleep } from '../tools/echoSleep.js';
import { registerRiskyEcho, riskyEchoTool } from '../tools/riskyEcho.js';
import { executeRun } from '../runtime.js';
import { approveRun, denyRun, autoResolveExpiredApprovals } from '../approval.js';
import * as store from '../store.js';
import { ensureUser } from './_groupFixture.js';
import { toolRegistry } from '../toolRegistry.js';
import { writePrivatePlaceholder } from '../messageBridge.js';

const RUN_BUDGET = { maxSteps: 20, maxSeconds: 600, maxTokens: 100_000 };

async function mkRunWithPlan(
  ownerId: string,
  sessionId: string,
  toolName: string,
  nSteps: number,
) {
  const run = await store.insertAgentRun({
    ownerId,
    channel: 'private',
    sessionId,
    groupId: null,
    topicId: null,
    intentTurnId: null,
    role: 'generalist',
    status: 'draft',
    inputText: `跑 ${nSteps} 步 ${toolName}`,
    budget: RUN_BUDGET,
    apiKeySource: 'server',
    apiKeyOwnerId: null,
  });
  const ph = await writePrivatePlaceholder({
    userId: ownerId,
    sessionId,
    inputText: 'x',
    agentRunId: run.id,
  });
  await store.updateAgentRun(run.id, { resultMessageId: ph.placeholderMessageId });
  const plan = {
    intentSummary: 'plan',
    steps: Array.from({ length: nSteps }, (_, i) => ({
      toolName,
      input: { text: `t${i + 1}`, sleepMs: 50 },
      reason: `r${i + 1}`,
      todoId: `t${i + 1}`,
    })),
    todos: Array.from({ length: nSteps }, (_, i) => ({
      id: `t${i + 1}`,
      text: `step ${i + 1}`,
      status: 'pending' as const,
      stepRefs: [],
    })),
    finalReplyHint: '完成',
    reasoning: null,
    version: 1,
  };
  await store.updateAgentRun(run.id, {
    plan,
    todos: plan.todos,
    status: 'running',
  });
  return run.id;
}

describe('runtime approval e2e (T4)', () => {
  beforeAll(async () => {
    await runMigrations();
    registerEchoSleep();
    registerRiskyEcho();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('approve resumes run (let-go model)', async () => {
    const u = await ensureUser('ape');
    const s = await createChatSession(u.id, 'ape');
    const runId = await mkRunWithPlan(u.id, s.id, 'risky_echo', 1);

    await executeRun(runId);
    expect((await store.getAgentRun(runId))?.status).toBe('awaiting_approval');

    expect(await approveRun(runId, u.id)).toBe(true);
    expect((await store.getAgentRun(runId))?.status).toBe('running');

    // 模拟 worker re-pickup
    await executeRun(runId);
    const after = await store.getAgentRun(runId);
    expect(after?.status).toBe('completed');
    const kinds = (await store.listSteps(runId)).map((x) => x.kind);
    expect(kinds).toContain('approval_request');
    expect(kinds).toContain('approval_grant');
    expect(kinds.filter((k) => k === 'tool_call').length).toBe(1);
  });

  it('deny → replanning (NOT cancelled); re-pickup replans via planner', async () => {
    const u = await ensureUser('dne');
    const s = await createChatSession(u.id, 'dne');
    const runId = await mkRunWithPlan(u.id, s.id, 'risky_echo', 1);

    await executeRun(runId);
    expect((await store.getAgentRun(runId))?.status).toBe('awaiting_approval');

    await denyRun(runId, u.id, 'nope');
    const denied = await store.getAgentRun(runId);
    expect(denied?.status).toBe('replanning');
    expect(
      (await store.listSteps(runId)).some((s) => s.kind === 'approval_deny'),
    ).toBe(true);

    // re-pickup → 进 replanning 分支，planner 生成新 plan，跑完
    await executeRun(runId);
    const final = await store.getAgentRun(runId);
    expect(final?.status).toBe('completed');
    // M1c：deny → 记 replan{reason:approval_deny,directive(含被拒工具)} + 清 plan，让 buildInitialPlan
    // 据 directive 走 LLM 改用替代方案（替代旧 M1b echo 桩的 [after deny] intentSummary）。
    const replan = (await store.listSteps(runId)).find(
      (s) =>
        s.kind === 'replan' &&
        (s.output as { reason?: string } | null)?.reason === 'approval_deny',
    );
    expect(replan).toBeDefined();
    expect((replan!.output as { directive?: string }).directive).toMatch(/risky_echo/);
  });

  it('timeout-low auto-grants → run resumes & completes', async () => {
    const u = await ensureUser('tla');
    const s = await createChatSession(u.id, 'tla');
    // 自定义 low-cost 工具
    toolRegistry.register({
      ...riskyEchoTool,
      name: 'low_risky_e2e',
      costHint: 'low',
    });
    const runId = await mkRunWithPlan(u.id, s.id, 'low_risky_e2e', 1);

    await executeRun(runId);
    expect((await store.getAgentRun(runId))?.status).toBe('awaiting_approval');

    // 让它过期
    await getPool().query(
      `UPDATE agent_runs SET awaiting_approval_until = $1 WHERE id = $2`,
      [new Date(Date.now() - 1_000), runId],
    );
    const n = await autoResolveExpiredApprovals(new Date());
    expect(n).toBe(1);
    expect((await store.getAgentRun(runId))?.status).toBe('running');

    await executeRun(runId);
    expect((await store.getAgentRun(runId))?.status).toBe('completed');
  });

  it('timeout-medium auto-denies → replanning → re-pickup completes via planner', async () => {
    const u = await ensureUser('tmd');
    const s = await createChatSession(u.id, 'tmd');
    const runId = await mkRunWithPlan(u.id, s.id, 'risky_echo', 1);

    await executeRun(runId);
    await getPool().query(
      `UPDATE agent_runs SET awaiting_approval_until = $1 WHERE id = $2`,
      [new Date(Date.now() - 1_000), runId],
    );
    await autoResolveExpiredApprovals(new Date());
    expect((await store.getAgentRun(runId))?.status).toBe('replanning');

    await executeRun(runId);
    expect((await store.getAgentRun(runId))?.status).toBe('completed');
  });

  it('M1c: 被拒工具执行期硬门 —— deniedTools 里的工具被跳过(不执行)，记 approval_deny 无 output', async () => {
    const u = await ensureUser('dtg');
    const s = await createChatSession(u.id, 'dtg');
    // echo_after_sleep 是 auto 工具：无硬门会真执行；标记为本 run 已拒后应被跳过。
    const runId = await mkRunWithPlan(u.id, s.id, 'echo_after_sleep', 2);
    await store.updateAgentRun(runId, { deniedTools: ['echo_after_sleep'] });

    await executeRun(runId);

    const steps = await store.listSteps(runId);
    // 被拒工具没真执行（无 tool_call），被硬门跳过。
    expect(
      steps.some((st) => st.kind === 'tool_call' && st.toolName === 'echo_after_sleep'),
    ).toBe(false);
    const skips = steps.filter(
      (st) => st.kind === 'approval_deny' && st.toolName === 'echo_after_sleep',
    );
    expect(skips.length).toBe(2); // 2 步都被硬门跳过
    expect(skips[0].error).toMatch(/exec-time guard/);
    // exec-time 跳过无 output → applyReplanningIfNeeded 的 lastDeny(output!=null) 排除，
    // 不会被误当「新的用户拒绝」再触发 deny 重规划。
    expect(skips[0].output).toBeNull();
  });
});
