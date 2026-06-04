import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';

/**
 * issue 0001 B2+B3：续跑(continuation-replan)重建 plan 时，planner prompt 必须带上
 * 「进展摘要」—— 已完成的 todo + 成功步骤的观察 —— 这样新 plan 能接着未完成的干、
 * 不重做已完成的活，并基于已学到的结果规划(observe-then-act 的务实版)。
 *
 * 测试策略沿用 runPlanGlue.previousFailure.test.ts：NODE_ENV=production + 捕获
 * planner LLM 请求 body，断言其 messages 含「已完成进展」段 + 成功观察标记。
 */

const realFetch = global.fetch;

function installPlannerCaptureFetch(intent: string): {
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
        choices: [
          {
            message: {
              content: JSON.stringify({
                intentSummary: intent,
                steps: [
                  { toolName: 'echo_after_sleep', input: { text: 'x', sleepMs: 1 }, reason: 'r', todoId: 't2' },
                ],
                todos: [{ id: 't2', text: 't2', status: 'pending', stepRefs: [] }],
                finalReplyHint: 'done',
              }),
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { getLast: () => last };
}

describe('buildProgressSummary 脱敏（送 planner 投影必须刮密钥）', () => {
  it('成功观察里的密钥不进 progress 摘要（与 digestTail/findings 脱敏纪律一致）', async () => {
    const { buildProgressSummary } = await import('../runPlanGlue.js');
    const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ';
    const step = {
      id: 's1', runId: 'r', idx: 1, kind: 'tool_call' as const,
      toolName: 'fetch_url', toolCallKey: null, input: null,
      output: { result: { ok: true, leaked: SECRET } },
      tokens: 0, durationMs: 0, error: null, byUserId: null, createdAt: new Date(),
    };
    const todos = [{ id: 't1', text: '抓取', status: 'completed' as const, stepRefs: [] }];
    const summary = buildProgressSummary([step], todos) ?? '';
    expect(summary).not.toContain(SECRET); // 密钥不泄漏给 planner
    expect(summary).toContain('[REDACTED');
  });
});

describe('buildInitialPlan: 续跑重建带「进展摘要」(issue 0001 B2+B3)', () => {
  const ORIGINAL_VITEST = process.env.VITEST;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_DS = process.env.DEEPSEEK_API_KEY;

  beforeAll(async () => {
    await runMigrations();
    const { registerEchoSleep } = await import('../tools/echoSleep.js');
    registerEchoSleep();
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

  it('续跑重建的 planner prompt 含「已完成进展」+ 成功步骤观察 + 已完成 todo，不只带失败', async () => {
    const capture = installPlannerCaptureFetch('rebuilt with progress');

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'prog-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'prog',
    });
    const sess = await createChatSession(user.id, 'prog');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'multi-part task',
      apiKey: 'sk-fake',
      apiKeySource: 'server',
    });

    // review #2 修复后的真实路径：续跑触发时(todos 还在)算好进展、塞进 continuation
    // replan step；之后 applyReplanningIfNeeded 会把 todos 清空。这里模拟该状态：
    // 进展在 replan step 里，run.todos 已被清空 —— 验证 buildInitialPlan 从 step 读，
    // 而非从(已空的) run.todos 读（旧 bug：那样"已完成 todo"段永远空）。
    const { recordStep } = await import('../stepRecorder.js');
    await recordStep({
      runId: run.id,
      kind: 'replan',
      output: {
        reason: 'continuation',
        progress:
          '已完成的 todo（不要重做）：\n- DONE-TODO-ONE\n已得到的结果：\n- search_web: {"result":{"ok":true,"note":"OBS-T1-MARKER"}}',
      },
    });

    const { updateAgentRun, getAgentRun } = await import('../store.js');
    // applyReplanningIfNeeded 在真实路径会清空 todos —— 模拟之
    await updateAgentRun(run.id, { status: 'replanning', todos: [] });

    const dbRun = await getAgentRun(run.id);
    const { buildInitialPlan } = await import('../runPlanGlue.js');
    await buildInitialPlan(dbRun!);

    const last = capture.getLast();
    expect(last).not.toBeNull();
    const userMsg = last!.messages.find((m) => m.role === 'user')?.content ?? '';
    // 进展段存在
    expect(userMsg).toMatch(/已完成进展/);
    // 带上已完成 todo（不重做）
    expect(userMsg).toMatch(/DONE-TODO-ONE/);
    // 带上成功步骤的观察（observe-then-act）
    expect(userMsg).toMatch(/OBS-T1-MARKER/);
  });
});
