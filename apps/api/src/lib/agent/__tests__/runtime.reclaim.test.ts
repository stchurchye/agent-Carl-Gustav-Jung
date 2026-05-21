import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun, executeRun } from '../runtime.js';
import {
  getAgentRun,
  listSteps,
  updateAgentRun,
  insertStep,
  maxStepIdx,
} from '../store.js';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import type { Plan, PlanStep } from '../types.js';

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

type CountedInput = { idx: number };
type CountedOutput = { idx: number; n: number };

// 与 idempotency 测试里那个不同：这里 **不** 提供 computeIdempotencyKey，
// 专门暴露 "缺幂等的工具被 reclaim 重跑" 的风险。
const counter = { calls: 0 };
const reclaimTool: ToolDef<CountedInput, CountedOutput> = {
  name: 'reclaim_counted',
  description: 'crash-recovery 测试：每次 handler 调用都自增计数',
  inputSchema: {
    type: 'object',
    required: ['idx'],
    properties: { idx: { type: 'number' } },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: true, // 模拟有副作用，重跑就是坏
  idempotent: false,
  async handler(input) {
    counter.calls += 1;
    return { idx: input.idx, n: counter.calls };
  },
};

function buildPlan(): Plan {
  const steps: PlanStep[] = [
    { toolName: 'reclaim_counted', input: { idx: 0 }, reason: '', todoId: 't1' },
    { toolName: 'reclaim_counted', input: { idx: 1 }, reason: '', todoId: 't2' },
    { toolName: 'reclaim_counted', input: { idx: 2 }, reason: '', todoId: 't3' },
  ];
  return {
    intentSummary: 'reclaim test',
    steps,
    todos: [
      { id: 't1', text: '0', status: 'pending', stepRefs: [] },
      { id: 't2', text: '1', status: 'pending', stepRefs: [] },
      { id: 't3', text: '2', status: 'pending', stepRefs: [] },
    ],
    finalReplyHint: '',
    reasoning: null,
    version: 1,
  };
}

describe('runtime reclaim after worker A crash (T5)', () => {
  beforeAll(async () => {
    await runMigrations();
    if (!toolRegistry.get(reclaimTool.name)) {
      toolRegistry.register(reclaimTool);
    }
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    counter.calls = 0;
  });

  it('worker A wrote tool_call step but crashed before incrementUsage → worker B does NOT re-execute', async () => {
    const user = await ensureUser('reclaim');
    const session = await createChatSession(user.id, 'reclaim');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'fixture: reclaim',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    const plan = buildPlan();
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });

    // 手工模拟："worker A 已经成功跑完 step 0、写了 tool_call step，
    // 但在 incrementUsage 写回前进程被 kill"。
    //
    // 即：DB 有 tool_call (idx=0)，但 agent_runs.usage.steps 仍是 0。
    const stepIdx = (await maxStepIdx(run.id)) + 1;
    await insertStep({
      runId: run.id,
      idx: stepIdx,
      kind: 'tool_call',
      toolName: 'reclaim_counted',
      input: { idx: 0 },
      output: { result: { idx: 0, n: 999 }, retried: false }, // ← n=999 表明是 worker A 写的
      durationMs: 10,
    });

    // worker B 接管
    await executeRun(run.id);

    const after = await getAgentRun(run.id);
    expect(after?.status).toBe('completed');

    // 关键 assertion：handler 只被调 2 次（step 1、step 2），不是 3 次
    expect(counter.calls).toBe(2);

    // DB 里 tool_call 应有 3 条（worker A 写的 1 条 + worker B 跑的 2 条）
    const steps = await listSteps(run.id);
    const toolCalls = steps.filter((s) => s.kind === 'tool_call' && s.toolName === 'reclaim_counted');
    expect(toolCalls.length).toBe(3);

    // 第 0 条是 worker A 的"残留"，应保留 n=999
    expect((toolCalls[0].output as { result?: { n?: number } })?.result?.n).toBe(999);
  });

  it('M1e task 6: worker A wrote approval_deny then crashed → worker B counts deny as advancing, does NOT re-emit deny or spurious reclaim', async () => {
    const user = await ensureUser('reclaim-deny');
    const session = await createChatSession(user.id, 'reclaim-deny');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'fixture: deny race',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    const plan = buildPlan();
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });

    // worker A：把第 0 步 tool_call + observe 都写了，然后第 1 步触发 approval_deny 后崩。
    // 即 DB 推进步数 = 3 (tool_call+observe+approval_deny)，usage.steps 仍是 0。
    let idx = (await maxStepIdx(run.id)) + 1;
    await insertStep({
      runId: run.id, idx: idx++, kind: 'tool_call',
      toolName: 'reclaim_counted', input: { idx: 0 },
      output: { result: { idx: 0, n: 1 }, retried: false }, durationMs: 10,
    });
    await insertStep({
      runId: run.id, idx: idx++, kind: 'observe',
      toolName: 'reclaim_counted', input: {}, output: { result: { idx: 0, n: 1 } },
      durationMs: 0,
    });
    await insertStep({
      runId: run.id, idx: idx++, kind: 'approval_deny',
      toolName: 'reclaim_counted', input: { reason: 'manual deny' }, output: null,
      durationMs: 0,
    });

    // worker B 接管
    await executeRun(run.id);

    const steps = await listSteps(run.id);
    // 关键 assertion 1：worker B 应当承认 worker A 写的 approval_deny —— 只 1 条 deny
    const denies = steps.filter((s) => s.kind === 'approval_deny');
    expect(denies.length).toBe(1);
    // 关键 assertion 2：completedCount 应包含 deny（3 条 advancing），所以 reclaim step
    // 应该写出（因为 dbAdvancing=3 > usage.steps=0），但只写一条。
    const reclaims = steps.filter((s) => s.kind === 'reclaim');
    expect(reclaims.length).toBe(1);
    // 关键 assertion 3：reclaim.output.dbAdvancing 应为 3（包含 deny）
    expect((reclaims[0].output as { dbAdvancing?: number })?.dbAdvancing).toBe(3);
  });

  it('reclaim records a step (kind=reclaim, M1e task 6) with reclaim=true for traceability', async () => {
    const user = await ensureUser('trace');
    const session = await createChatSession(user.id, 'trace');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'fixture: trace',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    const plan = buildPlan();
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });

    // 模拟"已经跑过 1 步，但 usage 没追上"
    const stepIdx = (await maxStepIdx(run.id)) + 1;
    await insertStep({
      runId: run.id,
      idx: stepIdx,
      kind: 'tool_call',
      toolName: 'reclaim_counted',
      input: { idx: 0 },
      output: { result: { idx: 0, n: 1 }, retried: false },
      durationMs: 10,
    });

    await executeRun(run.id);

    const steps = await listSteps(run.id);
    // M1e task 6：kind 从 'heartbeat' 改为 'reclaim'
    const reclaim = steps.find(
      (s) =>
        s.kind === 'reclaim' &&
        (s.output as { reclaim?: boolean } | null)?.reclaim === true,
    );
    expect(reclaim).toBeDefined();
  });
});
