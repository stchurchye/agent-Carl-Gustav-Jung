import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';

/**
 * issue 0003：Reflection —— LLM 兜底的「目标完成判断」，解 #7/#2b 的根:
 * 续跑/收尾不再只靠机械的 todo 状态，而是让 LLM 语义判断"用户的目标达成了吗"。
 *
 * 行为 1（tracer）：reflectGoalCompletion 调 LLM、解析 {goalMet,reason}；
 * 对一个没干完的 run 返回 goalMet:false，且 prompt 带上用户目标。
 * 测试沿用 runPlanGlue.progress.test.ts 的 NODE_ENV=production + fetch-stub 模式。
 */

const realFetch = global.fetch;

function installReflectCaptureFetch(goalMet: boolean, reason: string): {
  getLast: () => { messages: Array<{ role: string; content: string }> } | null;
} {
  let last: { messages: Array<{ role: string; content: string }> } | null = null;
  global.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const urlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as { url?: string })?.url ?? '';
    if (urlStr.includes('chat/completions') && init?.body) {
      try {
        const parsed = JSON.parse(init.body as string) as {
          messages?: Array<{ role: string; content: string }>;
        };
        last = { messages: parsed.messages ?? [] };
      } catch {
        /* ignore */
      }
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ goalMet, reason }) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { getLast: () => last };
}

describe('buildStepDigest with checkpoint (S2)', () => {
  it('prepends accumulated findings from the checkpoint so the judge sees the whole run', async () => {
    const { buildStepDigest } = await import('../reflection.js');
    const digest = buildStepDigest([], {
      version: 1,
      goal: 'g',
      intent: 'i',
      completed: [
        { text: 'fetch_url', finding: '早期已确认信托三要素', refs: [{ kind: 'url', id: 'https://e.example', label: 'x' }] },
      ],
      remainingPlan: [],
      openQuestions: [],
      nextStep: '',
      successCount: 1,
      producedAtIdx: 2,
      digestTail: '',
    });
    expect(digest).toContain('早期已确认信托三要素');
  });
});

describe('reflectGoalCompletion (issue 0003)', () => {
  const ORIGINAL_VITEST = process.env.VITEST;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_DS = process.env.DEEPSEEK_API_KEY;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
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

  it('LLM 判定目标未达成 → 返回 goalMet:false，且 prompt 带上用户目标', async () => {
    const capture = installReflectCaptureFetch(false, 'X 还没做完');

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'refl-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'refl',
    });
    const sess = await createChatSession(user.id, 'refl');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'task',
      apiKey: 'sk-fake',
      apiKeySource: 'server',
    });

    const { resolveLlmClient } = await import('../runLlmClient.js');
    const { getAgentRun } = await import('../store.js');
    const dbRun = await getAgentRun(run.id);
    const llm = await resolveLlmClient(dbRun!);
    expect(llm).not.toBeNull();

    const { reflectGoalCompletion } = await import('../reflection.js');
    const out = await reflectGoalCompletion({
      inputText: '帮我完成任务-GOALMARK',
      steps: [],
      llm: llm!,
      signal: new AbortController().signal,
    });

    expect(out.goalMet).toBe(false);
    const last = capture.getLast();
    expect(last).not.toBeNull();
    const userMsg = last!.messages.find((m) => m.role === 'user')?.content ?? '';
    // prompt 带上了用户目标
    expect(userMsg).toMatch(/GOALMARK/);
  });

  it('收尾时 Reflection 判目标未达成 → 续跑，即使机械信号没响（解 #7）', async () => {
    installReflectCaptureFetch(false, '还差关键一步');

    // 注册一个一定成功的 auto 工具：todo 会被标完成、无 soft-fail → 机械续跑信号沉默
    const { toolRegistry } = await import('../toolRegistry.js');
    const okToolName = 'reflect_ok_' + randomUUID().slice(0, 8);
    toolRegistry.register({
      name: okToolName,
      description: 'always-ok',
      inputSchema: { type: 'object', properties: {} },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: false,
      async handler() {
        return { ok: true, note: 'done' };
      },
    } as never);

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'refl2-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'refl2',
    });
    const sess = await createChatSession(user.id, 'refl2');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: '多步任务-GOAL',
      apiKey: 'sk-fake',
      apiKeySource: 'server',
    });

    const { updateAgentRun, getAgentRun } = await import('../store.js');
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

    const { executeRun } = await import('../runExecute.js');
    await executeRun(run.id);

    const after = await getAgentRun(run.id);
    // 工具成功、todo 完成 → 机械信号沉默；但 Reflection 判 goalMet:false → 续跑
    expect(after?.status).toBe('replanning');
  });

  it('digest 纳入 tool_error 硬失败，reflection prompt 能看到失败（review #2）', async () => {
    const capture = installReflectCaptureFetch(false, 'x');

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'refl3-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'refl3',
    });
    const sess = await createChatSession(user.id, 'refl3');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'task',
      apiKey: 'sk-fake',
      apiKeySource: 'server',
    });
    const { resolveLlmClient } = await import('../runLlmClient.js');
    const { getAgentRun } = await import('../store.js');
    const llm = await resolveLlmClient((await getAgentRun(run.id))!);

    const { reflectGoalCompletion } = await import('../reflection.js');
    await reflectGoalCompletion({
      inputText: 'task',
      // 一条硬失败 tool_error —— 旧 digest 只收 tool_call 会漏掉它
      steps: [
        {
          id: 's1',
          runId: run.id,
          idx: 0,
          kind: 'tool_error',
          toolName: 'search_web',
          error: 'HARDFAIL-MARK',
          output: null,
        } as unknown as import('../types.js').AgentStep,
      ],
      llm: llm!,
      signal: new AbortController().signal,
    });

    const userMsg =
      capture.getLast()!.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMsg).toMatch(/HARDFAIL-MARK/);
  });

  it('统一收尾：生产里 soft-fail 但 Reflection 判目标已达成 → 收尾，不机械盲目续跑（A）', async () => {
    installReflectCaptureFetch(true, '失败可恢复，目标其实已达成');

    // soft-fail 的 probe：机械信号(hasUnfinishedAttempted && hadSoftFail)会响
    const { toolRegistry } = await import('../toolRegistry.js');
    const probeName = 'unify_probe_' + randomUUID().slice(0, 8);
    toolRegistry.register({
      name: probeName,
      description: 'soft-fail',
      inputSchema: { type: 'object', properties: {} },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: false,
      async handler() {
        return { ok: false, error: 'recoverable' };
      },
    } as never);

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'refl5-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'refl5',
    });
    const sess = await createChatSession(user.id, 'refl5');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: '任务',
      apiKey: 'sk-fake',
      apiKeySource: 'server',
    });
    const { updateAgentRun, getAgentRun } = await import('../store.js');
    await updateAgentRun(run.id, {
      status: 'running',
      plan: {
        intentSummary: 'x',
        steps: [{ toolName: probeName, input: {}, reason: 'r', todoId: 't1' }],
        todos: [{ id: 't1', text: 't1', status: 'pending', stepRefs: [] }],
        finalReplyHint: 'h',
        reasoning: null,
        version: 1,
      },
    });

    const { executeRun } = await import('../runExecute.js');
    await executeRun(run.id);

    const after = await getAgentRun(run.id);
    // 机械信号本会续跑，但统一决策让 Reflection 拍板"目标已达成" → 收尾
    expect(after?.status).toBe('completed');
  });

  it('生产无 working reflection（无 key）→ fail-open 收尾，不机械空转续跑（review fix）', async () => {
    // 不装 reflection stub；清掉 key 让 resolveLlmClient 返回 null。
    delete process.env.DEEPSEEK_API_KEY;

    const { toolRegistry } = await import('../toolRegistry.js');
    const probeName = 'nokey_probe_' + randomUUID().slice(0, 8);
    toolRegistry.register({
      name: probeName,
      description: 'soft-fail',
      inputSchema: { type: 'object', properties: {} },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: false,
      async handler() {
        return { ok: false, error: 'x' };
      },
    } as never);

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'refl6-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'refl6',
    });
    const sess = await createChatSession(user.id, 'refl6');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: '任务',
      apiKey: 'sk-fake',
      apiKeySource: 'server',
    });
    const { updateAgentRun, getAgentRun } = await import('../store.js');
    await updateAgentRun(run.id, {
      status: 'running',
      plan: {
        intentSummary: 'x',
        steps: [{ toolName: probeName, input: {}, reason: 'r', todoId: 't1' }],
        todos: [{ id: 't1', text: 't1', status: 'pending', stepRefs: [] }],
        finalReplyHint: 'h',
        reasoning: null,
        version: 1,
      },
    });

    const { executeRun } = await import('../runExecute.js');
    await executeRun(run.id);

    const after = await getAgentRun(run.id);
    // 生产 + soft-fail + 无 LLM：机械信号本会续跑，但续跑要 LLM 重规划=空转 → 直接收尾
    expect(after?.status).toBe('completed');
  });
});
