import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun, executeRun, resolveToolCallKey } from '../runtime.js';
import { getAgentRun, listSteps, updateAgentRun, insertStep, maxStepIdx } from '../store.js';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import type { Plan, PlanStep } from '../types.js';

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

type CountedInput = { tag: string };
type CountedOutput = { tag: string; n: number };

// Mock 工具：每次调用 handler 自增计数；computeIdempotencyKey 用 input.tag。
const counter = { calls: 0 };
const countedTool: ToolDef<CountedInput, CountedOutput> = {
  name: 'counted_tool',
  description: 'idempotency 测试用：同 tag 应命中缓存',
  inputSchema: {
    type: 'object',
    required: ['tag'],
    properties: { tag: { type: 'string' } },
  },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  computeIdempotencyKey: (input) => `tag:${(input as CountedInput).tag}`,
  async handler(input) {
    counter.calls += 1;
    return { tag: input.tag, n: counter.calls };
  },
};

function buildPlanWithTwoSameTagSteps(): Plan {
  const steps: PlanStep[] = [
    { toolName: 'counted_tool', input: { tag: 'A' }, reason: 'first', todoId: 't1' },
    { toolName: 'counted_tool', input: { tag: 'A' }, reason: 'second (same tag)', todoId: 't2' },
  ];
  return {
    intentSummary: 'idempotency repeat tag A',
    steps,
    todos: [
      { id: 't1', text: 'tag A 第一次', status: 'pending', stepRefs: [] },
      { id: 't2', text: 'tag A 第二次', status: 'pending', stepRefs: [] },
    ],
    finalReplyHint: '应只调一次外部 handler',
    reasoning: null,
    version: 1,
  };
}

describe('runtime idempotency gate (M1c, T10)', () => {
  beforeAll(async () => {
    await runMigrations();
    if (!toolRegistry.get(countedTool.name)) {
      toolRegistry.register(countedTool);
    }
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    counter.calls = 0;
  });

  it('resolveToolCallKey 拼出 `tool:key` 形式（无 run，向后兼容）', () => {
    const planStep: PlanStep = {
      toolName: 'counted_tool',
      input: { tag: 'X' },
      reason: '',
      todoId: 't',
    };
    expect(resolveToolCallKey(countedTool as never, planStep)).toBe('counted_tool:tag:X');
  });

  it('M1e Task 13.3: resolveToolCallKey 带 run 时把 ownerId 加在最前面 (跨用户隔离)', () => {
    const planStep: PlanStep = {
      toolName: 'counted_tool',
      input: { tag: 'X' },
      reason: '',
      todoId: 't',
    };
    const fakeRunA = { ownerId: 'user-alice' } as unknown as Parameters<typeof resolveToolCallKey>[2];
    const fakeRunB = { ownerId: 'user-bob' } as unknown as Parameters<typeof resolveToolCallKey>[2];
    const keyA = resolveToolCallKey(countedTool as never, planStep, fakeRunA);
    const keyB = resolveToolCallKey(countedTool as never, planStep, fakeRunB);
    expect(keyA).toBe('user-alice:counted_tool:tag:X');
    expect(keyB).toBe('user-bob:counted_tool:tag:X');
    expect(keyA).not.toBe(keyB);
  });

  it('两个 plan steps 用同一 idempotency key → handler 只调一次,第二次写 observe 命中', async () => {
    const user = await ensureUser('idem');
    const session = await createChatSession(user.id, 'idem');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'fixture: idempotency',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    // 直接覆盖 plan,绕过 echo planner。
    const plan = buildPlanWithTwoSameTagSteps();
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });

    await executeRun(run.id);

    expect(counter.calls).toBe(1); // ← 关键：handler 只被调一次

    const after = await getAgentRun(run.id);
    expect(after?.status).toBe('completed');

    const steps = await listSteps(run.id);
    const toolCalls = steps.filter((s) => s.kind === 'tool_call' && s.toolName === 'counted_tool');
    const observes = steps.filter((s) => s.kind === 'observe' && s.toolName === 'counted_tool');
    expect(toolCalls.length).toBe(1);
    expect(observes.length).toBe(1);
    // M1e Task 13.3: idempotency key 加 ownerId 前缀，避免跨用户碰撞
    expect(toolCalls[0].toolCallKey).toBe(`${user.id}:counted_tool:tag:A`);
    // observe 不带 toolCallKey,避免和 tool_call 冲突 unique 索引
    expect(observes[0].toolCallKey).toBeNull();
    const obsInput = observes[0].input as { cached?: boolean; idempotencyKey?: string };
    expect(obsInput.cached).toBe(true);
    expect(obsInput.idempotencyKey).toBe(`${user.id}:counted_tool:tag:A`);
  });

  it('crash recovery: 预先写入完成的 tool_call,executeRun 不重跑外部 handler', async () => {
    const user = await ensureUser('crash');
    const session = await createChatSession(user.id, 'crash');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'fixture: crash recovery',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    const plan: Plan = {
      intentSummary: 'single tag B',
      steps: [
        { toolName: 'counted_tool', input: { tag: 'B' }, reason: 'r', todoId: 't1' },
      ],
      todos: [{ id: 't1', text: 'B', status: 'pending', stepRefs: [] }],
      finalReplyHint: '',
      reasoning: null,
      version: 1,
    };
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });

    // 预先注入 "上一次 run 已完成 tag B" 的 tool_call step（模拟 crash 后 recovery）。
    const nextIdx = (await maxStepIdx(run.id)) + 1;
    await insertStep({
      runId: run.id,
      idx: nextIdx,
      kind: 'tool_call',
      toolName: 'counted_tool',
      toolCallKey: 'counted_tool:tag:B',
      input: { tag: 'B' },
      output: { result: { tag: 'B', n: 999 }, retried: false },
    });

    await executeRun(run.id);

    expect(counter.calls).toBe(0); // 完全没调 handler

    const after = await getAgentRun(run.id);
    expect(after?.status).toBe('completed');

    // M1d T5 后契约：DB 里 tool_call 数 >= plan.steps.length 时，
    // reclaim 路径直接 skip 整个 for 循环，不会再写 observe。
    // （observe 只在"同 run 内 mid-execution 命中 idempotency 缓存"时写。）
    // 取而代之地，会写一条 reclaim step（M1e task 6 前叫 'heartbeat'）表示接管发生过。
    const steps = await listSteps(run.id);
    const reclaim = steps.find(
      (s) =>
        s.kind === 'reclaim' &&
        (s.output as { reclaim?: boolean } | null)?.reclaim === true,
    );
    expect(reclaim).toBeDefined();
    const toolCalls = steps.filter((s) => s.kind === 'tool_call');
    expect(toolCalls.length).toBe(1);
    expect((toolCalls[0].output as { result?: { n?: number } })?.result?.n).toBe(999);
  });
});
