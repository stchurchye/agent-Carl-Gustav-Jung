import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import type { Plan } from '../types.js';

/**
 * issue 0001：continuation-replan。
 *
 * 现状:plan.steps 跑完后无条件 softComplete('completed')，即使还有"有 step 却
 * 没完成"的 todo(其 step soft-fail 了、且失败数 < critique 的 ≥2 阈值)。
 *
 * 目标(安全信号版/option A):loop 收尾时若存在某 todo —— 它有对应 plan.step
 * (step.todoId===todo.id)且 status !== 'completed' —— 说明计划里这块活没干成,
 * 进 'replanning' 续跑一轮,而不是直接收尾。纯标签 todo(无 step)不触发。
 */
describe('continuation-replan: plan 跑完但有未完成的 todo → 续跑而非收尾 (issue 0001)', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  afterEach(async () => {
    // 测试注册的 probe 工具留在 registry 无害(名字随机),无需清理。
  });

  it('plan 含 1 个 soft-fail step(对应 todo 没完成)→ run 不直接 completed，而是进 replanning 续跑一轮', async () => {
    const probeName = 'cont_probe_' + randomUUID().slice(0, 8);
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
        return { ok: false, error: 'simulated fail' };
      },
    };
    toolRegistry.register(probe);

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'cont-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'cont',
    });
    const sess = await createChatSession(user.id, 'cont');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'do the task',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    // 单步 plan:probe 会 soft-fail → t1 不会被标 completed。
    // 只有 1 次失败 < critique 的 ≥2 阈值 → critique 不会先一步 replan。
    const plan: Plan = {
      intentSummary: 'one failing step',
      steps: [{ toolName: probeName, input: { q: 'a' }, reason: 'p1', todoId: 't1' }],
      todos: [{ id: 't1', text: 'p1', status: 'pending', stepRefs: [] }],
      finalReplyHint: 'done',
      reasoning: null,
      version: 1,
    };
    const { updateAgentRun, getAgentRun } = await import('../store.js');
    await updateAgentRun(run.id, {
      plan,
      todos: plan.todos,
      status: 'running',
    });

    const { executeRun } = await import('../runExecute.js');
    await executeRun(run.id);

    const after = await getAgentRun(run.id);
    // t1 有 step 却没完成 → 不该直接 completed，应续跑(replanning)
    expect(after?.status).toBe('replanning');
  });

  it('M7 共存：续跑触发不污染 merged_inputs_consumed_count', async () => {
    const probeName = 'cont_probe_m7_' + randomUUID().slice(0, 8);
    const probe: ToolDef<{ q: string }, { ok: boolean; error?: string }> = {
      name: probeName,
      description: 'always-soft-fail probe',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: false,
      async handler() {
        return { ok: false, error: 'simulated fail' };
      },
    };
    toolRegistry.register(probe);

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'm7c-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'm7c',
    });
    const sess = await createChatSession(user.id, 'm7c');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'task with a consumed merge',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    const plan: Plan = {
      intentSummary: 'one failing step',
      steps: [{ toolName: probeName, input: { q: 'a' }, reason: 'p1', todoId: 't1' }],
      todos: [{ id: 't1', text: 'p1', status: 'pending', stepRefs: [] }],
      finalReplyHint: 'done',
      reasoning: null,
      version: 1,
    };
    const { updateAgentRun, getAgentRun } = await import('../store.js');
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });
    // 预置一条「已消费」的合并追问：merged_inputs 长度 1、consumed_count 1。
    // 合并检查(total>consumed)为 false → 不触发 merge replan；loop 收尾才走续跑。
    await getPool().query(
      `UPDATE agent_runs
         SET merged_inputs = $2::jsonb, merged_inputs_consumed_count = 1
       WHERE id = $1`,
      [
        run.id,
        JSON.stringify([
          { text: '顺便也…', byUserId: user.id, byUsername: 'X', at: new Date(0).toISOString() },
        ]),
      ],
    );

    const { executeRun } = await import('../runExecute.js');
    await executeRun(run.id);

    const after = await getAgentRun(run.id);
    // 续跑触发了（soft-fail + 未完成 todo）
    expect(after?.status).toBe('replanning');
    // 但 merge 的消费记账没被续跑动过
    const { rows } = await getPool().query(
      'SELECT merged_inputs_consumed_count AS c, jsonb_array_length(merged_inputs) AS n FROM agent_runs WHERE id = $1',
      [run.id],
    );
    expect(Number(rows[0].c)).toBe(1);
    expect(Number(rows[0].n)).toBe(1);
  });

  it('续跑硬上限：已续跑 CAP 次后即使仍 soft-fail 也收尾，不再无限续跑', async () => {
    const probeName = 'cont_probe_cap_' + randomUUID().slice(0, 8);
    const probe: ToolDef<{ q: string }, { ok: boolean; error?: string }> = {
      name: probeName,
      description: 'always-soft-fail probe',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: false,
      async handler() {
        return { ok: false, error: 'simulated fail' };
      },
    };
    toolRegistry.register(probe);

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'cap-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'cap',
    });
    const sess = await createChatSession(user.id, 'cap');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'persistently failing task',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    // 预置 2 条续跑记录（= CONTINUATION_ROUND_CAP），模拟已经续跑过 CAP 次。
    const { recordStep } = await import('../stepRecorder.js');
    await recordStep({ runId: run.id, kind: 'replan', output: { reason: 'continuation' } });
    await recordStep({ runId: run.id, kind: 'replan', output: { reason: 'continuation' } });

    const plan: Plan = {
      intentSummary: 'still failing',
      steps: [{ toolName: probeName, input: { q: 'a' }, reason: 'p1', todoId: 't1' }],
      todos: [{ id: 't1', text: 'p1', status: 'pending', stepRefs: [] }],
      finalReplyHint: 'done',
      reasoning: null,
      version: 1,
    };
    const { updateAgentRun, getAgentRun } = await import('../store.js');
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });

    const { executeRun } = await import('../runExecute.js');
    await executeRun(run.id);

    const after = await getAgentRun(run.id);
    // 已达上限 → 即使本轮仍 soft-fail，也收尾而非再续跑
    expect(after?.status).toBe('completed');
  });

  it('续跑优先于残留 approval_deny：applyReplanningIfNeeded 清 plan 走重建，不被旧 deny 误路由', async () => {
    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'mr-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'mr',
    });
    const sess = await createChatSession(user.id, 'mr');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'task with a never-tool + soft-fail',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    const { updateAgentRun, getAgentRun } = await import('../store.js');
    const { recordStep } = await import('../stepRecorder.js');
    await updateAgentRun(run.id, {
      status: 'running',
      plan: {
        intentSummary: 'x',
        steps: [{ toolName: 'some_never_tool', input: {}, reason: 'r', todoId: 't1' }],
        todos: [{ id: 't1', text: 't1', status: 'pending', stepRefs: [] }],
        finalReplyHint: 'h',
        reasoning: null,
        version: 1,
      },
    });
    // 历史里有一条更早的 approval_deny；最新一步是续跑触发写的 continuation replan
    await recordStep({ runId: run.id, kind: 'approval_deny', toolName: 'some_never_tool' });
    await recordStep({ runId: run.id, kind: 'replan', output: { reason: 'continuation', progress: null } });
    await updateAgentRun(run.id, { status: 'replanning' });

    const { applyReplanningIfNeeded } = await import('../runExecuteHelpers.js');
    const dbRun = await getAgentRun(run.id);
    await applyReplanningIfNeeded(dbRun!);

    // 续跑路径：plan 被清空（走 buildInitialPlan 重建），而非被 deny 分支换成 deny plan
    const out = await getAgentRun(run.id);
    expect(out?.plan).toBeNull();
    expect(out?.status).toBe('running');
  });

  it('stall guard：续跑无进展（累计成功步数没增）→ 收尾，不再续到 CAP（issue 0002）', async () => {
    const probeName = 'stall_probe_' + randomUUID().slice(0, 8);
    const probe: ToolDef<{ q: string }, { ok: boolean; error?: string }> = {
      name: probeName,
      description: 'always-soft-fail probe',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: false,
      async handler() {
        return { ok: false, error: 'simulated fail' };
      },
    };
    toolRegistry.register(probe);

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'stall-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'stall',
    });
    const sess = await createChatSession(user.id, 'stall');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'stalled task',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    const { recordStep } = await import('../stepRecorder.js');
    // 上一轮续跑记录，存了当时的累计成功步数 successCount=0；本轮 probe 也只会失败，
    // 累计成功步数仍是 0（没增）→ 无进展。（不预录成功 tool_call，否则会被当成已完成
    // 的 plan step 把 probe 跳过。）
    await recordStep({
      runId: run.id,
      kind: 'replan',
      output: { reason: 'continuation', successCount: 0 },
    });

    const plan: Plan = {
      intentSummary: 'still failing',
      steps: [{ toolName: probeName, input: { q: 'a' }, reason: 'p1', todoId: 't1' }],
      todos: [{ id: 't1', text: 'p1', status: 'pending', stepRefs: [] }],
      finalReplyHint: 'done',
      reasoning: null,
      version: 1,
    };
    const { updateAgentRun, getAgentRun } = await import('../store.js');
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });

    const { executeRun } = await import('../runExecute.js');
    await executeRun(run.id);

    const after = await getAgentRun(run.id);
    // probe 失败、成功步数仍是 1（没增）→ 无进展 → 收尾（而非 rounds=1<CAP=2 继续续跑）
    expect(after?.status).toBe('completed');
  });
});
