import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';

/**
 * M1f polish #1：critique 触发 replan 后，planner 必须能看到上一步失败原因，
 * 避免重新规划仍复现同样错。M1f Task 2 加了 `LlmPlannerInput.previousFailure`
 * 字段 + `buildPlannerUserPrompt` 渲染，但生产链路无 caller —— 本 commit 在
 * `buildInitialPlan` 里调 `buildPreviousFailureSummary` 把已有 failed step 摘要
 * 喂给 planner。
 *
 * 测试策略：直接 stub `global.fetch`（参考 runPlanGlue.notice.test.ts），让真正
 * 的 DeepSeekLlmClient → generatePlanWithLlm → buildInitialPlan 链路完整跑通，
 * 捕获 planner LLM 请求 body 后断言其 messages 含「上一步失败原因」+ 具体 error。
 */

const realFetch = global.fetch;

function plannerOkResponse(intent: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              intentSummary: intent,
              steps: [
                {
                  toolName: 'echo_after_sleep',
                  input: { text: 'x', sleepMs: 100 },
                  reason: 'r',
                  todoId: 't1',
                },
              ],
              todos: [
                { id: 't1', text: 't', status: 'pending', stepRefs: [] },
              ],
              finalReplyHint: 'done',
            }),
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

type CapturedPlannerCall = {
  body: string;
  messages: Array<{ role: string; content: string }>;
};

/**
 * 装一个 fetch stub：捕获最后一次 deepseek `/chat/completions` 调用并返回 valid
 * plan JSON；snapshot summary 那一次（如果有）也走同一路径，参考 notice 测试
 * 的同款模式（snapshot 拿到 "valid plan JSON" 当 summary text 也是无害的）。
 */
function installPlannerCaptureFetch(intent: string): {
  getLast: () => CapturedPlannerCall | null;
} {
  let last: CapturedPlannerCall | null = null;
  global.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const urlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as { url?: string })?.url ?? '';
    if (urlStr.includes('chat/completions') && init?.body) {
      const body = init.body as string;
      try {
        const parsed = JSON.parse(body) as {
          messages?: Array<{ role: string; content: string }>;
        };
        last = { body, messages: parsed.messages ?? [] };
      } catch {
        // ignore body parse failures —— 不会影响 planner 响应
      }
    }
    return plannerOkResponse(intent);
  }) as unknown as typeof fetch;
  return { getLast: () => last };
}

describe('buildInitialPlan: previousFailure plumbing (M1f polish #1)', () => {
  const ORIGINAL_VITEST = process.env.VITEST;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_DS = process.env.DEEPSEEK_API_KEY;
  const ORIGINAL_SECRET = process.env.AGENT_KEY_SECRET;

  beforeAll(async () => {
    await runMigrations();
    // planner parsePlannerJson 要求 toolName 在 toolRegistry 里。其他 test 会
    // 注册这些 tool，但本文件如果先跑就会拿到空 registry → 解析失败 → fallback
    // 到 echo plan → 测不到 LLM call 之外的事。这里手动确保 echo_after_sleep
    // 已注册。
    const { registerEchoSleep } = await import('../tools/echoSleep.js');
    registerEchoSleep();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    await getPool().query(
      `DELETE FROM agent_event_logs WHERE event_type = 'user_facing_notice'`,
    );
    // 让 buildInitialPlan 走 LLM 分支而非"测试 env → echo" 短路
    delete process.env.VITEST;
    process.env.NODE_ENV = 'production';
    process.env.DEEPSEEK_API_KEY = 'sk-fake-server-key';
    delete process.env.AGENT_KEY_SECRET;
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
    if (ORIGINAL_SECRET === undefined) delete process.env.AGENT_KEY_SECRET;
    else process.env.AGENT_KEY_SECRET = ORIGINAL_SECRET;
  });

  it('replan with prior tool_error + soft-fail tool_call → planner user prompt 含「上一步失败原因」+ 两个 error 字串', async () => {
    const capture = installPlannerCaptureFetch('replanned task');

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'pf-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'pf',
    });
    const sess = await createChatSession(user.id, 'pf');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'research family trust pros and cons',
      apiKey: 'sk-fake',
      apiKeySource: 'server',
    });

    // 插两条 failed step：一条 hard error（kind='tool_error'）+ 一条 soft-fail
    // （kind='tool_call' + 非空 error），这是 M1f #5 后 soft-fail 的实际落地形态。
    const { recordStep } = await import('../stepRecorder.js');
    await recordStep({
      runId: run.id,
      kind: 'tool_error',
      toolName: 'web_search',
      error: 'HTTP_429_RATE_LIMIT',
    });
    await recordStep({
      runId: run.id,
      kind: 'tool_call',
      toolName: 'url_fetch',
      output: { result: { ok: false, error: 'CONN_REFUSED' }, retried: false },
      error: 'CONN_REFUSED',
    });
    const { updateAgentRun, getAgentRun } = await import('../store.js');
    await updateAgentRun(run.id, { status: 'replanning' });

    const dbRun = await getAgentRun(run.id);
    const { buildInitialPlan } = await import('../runPlanGlue.js');
    const plan = await buildInitialPlan(dbRun!);

    // planner LLM 必须真的成功 —— 不能 fallback 到 echo（那就说明 fetch 没被
    // 我们的 stub 拦截 / planner 链路爆了某个外部依赖）
    expect(plan.intentSummary).toBe('replanned task');

    const last = capture.getLast();
    expect(last).not.toBeNull();
    const userMsg = last!.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMsg).toMatch(/上一步失败原因/);
    expect(userMsg).toMatch(/HTTP_429_RATE_LIMIT/);
    expect(userMsg).toMatch(/CONN_REFUSED/);
    expect(userMsg).toMatch(/web_search/);
    expect(userMsg).toMatch(/url_fetch/);
  });

  it('initial fresh run（无任何 failed step）→ planner user prompt 不含「上一步失败原因」', async () => {
    const capture = installPlannerCaptureFetch('initial plan');

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'pf2-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'pf2',
    });
    const sess = await createChatSession(user.id, 'pf2');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'fresh research request',
      apiKey: 'sk-fake',
      apiKeySource: 'server',
    });
    const dbRun = await (await import('../store.js')).getAgentRun(run.id);
    const { buildInitialPlan } = await import('../runPlanGlue.js');
    await buildInitialPlan(dbRun!);

    const last = capture.getLast();
    expect(last).not.toBeNull();
    const userMsg = last!.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMsg).not.toMatch(/上一步失败原因/);
  });

  it('helper: buildPreviousFailureSummary 直接 unit —— 取最近 3 条 failed step, format 含 tool + error', async () => {
    const { buildPreviousFailureSummary } = await import('../runPlanGlue.js');
    const now = new Date();
    type S = Parameters<typeof buildPreviousFailureSummary>[0][number];
    const baseStep = (overrides: Partial<S>): S => ({
      id: randomUUID(),
      runId: 'r',
      idx: 0,
      kind: 'tool_call',
      toolName: null,
      toolCallKey: null,
      input: null,
      output: null,
      tokens: 0,
      durationMs: 0,
      error: null,
      byUserId: null,
      createdAt: now,
      ...overrides,
    });

    expect(buildPreviousFailureSummary([])).toBeUndefined();
    expect(
      buildPreviousFailureSummary([
        baseStep({ kind: 'plan' }),
        baseStep({ kind: 'tool_call', toolName: 'ok_tool', error: null }),
      ]),
    ).toBeUndefined();

    const summary = buildPreviousFailureSummary([
      baseStep({ kind: 'tool_error', toolName: 'web_search', error: 'E1' }),
      baseStep({ kind: 'tool_call', toolName: 'url_fetch', error: 'E2' }),
      baseStep({ kind: 'plan' }), // 非失败,不计
      baseStep({ kind: 'tool_call', toolName: 'doc_export', error: 'E3' }),
      baseStep({ kind: 'tool_error', toolName: 'magi_read', error: 'E4' }),
    ]);
    expect(summary).toBeDefined();
    // 只保留最近 3 个失败
    expect(summary).not.toMatch(/E1/);
    expect(summary).toMatch(/E2/);
    expect(summary).toMatch(/E3/);
    expect(summary).toMatch(/E4/);
    expect(summary).toMatch(/url_fetch/);
    expect(summary).toMatch(/doc_export/);
    expect(summary).toMatch(/magi_read/);
  });
});
