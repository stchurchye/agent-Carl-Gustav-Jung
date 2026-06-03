import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';

/**
 * issue 0004：修 `/echo` 输入旁路。
 *
 * 现状 runPlanGlue.ts:`looksLikeEcho = /echo/i.test(text)` 让任何含 "echo" 的
 * 用户消息在生产模式下也跳过 LLM planner、跑写死的 echo 计划。真实用户问
 * "echo 命令怎么用" 会中招。
 *
 * 修复目标：echo-fallback 的关键词分支只在显式 dev flag(AGENT_ECHO_KEYWORD=1)
 * 下生效；生产模式(非 test、无 flag)含 "echo" 的消息走 LLM planner。
 *
 * 测试策略沿用 runPlanGlue.previousFailure.test.ts：NODE_ENV=production +
 * stub global.fetch 捕获 planner LLM 调用 → 断言走了 LLM 而非 echo 短路。
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
              todos: [{ id: 't1', text: 't', status: 'pending', stepRefs: [] }],
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

function installPlannerCaptureFetch(intent: string): { called: () => boolean } {
  let saw = false;
  global.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const urlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as { url?: string })?.url ?? '';
    if (urlStr.includes('chat/completions') && init?.body) saw = true;
    return plannerOkResponse(intent);
  }) as unknown as typeof fetch;
  return { called: () => saw };
}

describe('buildInitialPlan: /echo 输入旁路修复 (issue 0004)', () => {
  const ORIGINAL_VITEST = process.env.VITEST;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_DS = process.env.DEEPSEEK_API_KEY;
  const ORIGINAL_SECRET = process.env.AGENT_KEY_SECRET;
  const ORIGINAL_ECHO_KW = process.env.AGENT_ECHO_KEYWORD;

  beforeAll(async () => {
    await runMigrations();
    const { registerEchoSleep } = await import('../tools/echoSleep.js');
    registerEchoSleep();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    // 模拟生产模式:非 test env、无 dev echo flag
    delete process.env.VITEST;
    process.env.NODE_ENV = 'production';
    process.env.DEEPSEEK_API_KEY = 'sk-fake-server-key';
    delete process.env.AGENT_KEY_SECRET;
    delete process.env.AGENT_ECHO_KEYWORD;
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
    if (ORIGINAL_ECHO_KW === undefined) delete process.env.AGENT_ECHO_KEYWORD;
    else process.env.AGENT_ECHO_KEYWORD = ORIGINAL_ECHO_KW;
  });

  it('生产模式 + 文本含 "echo" + 无 dev flag → 走 LLM planner，不跑写死的 echo 计划', async () => {
    const capture = installPlannerCaptureFetch('llm-planned-it');

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'eb-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'eb',
    });
    const sess = await createChatSession(user.id, 'eb');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      // 关键:inputText 含 "echo" —— 真实用户问 echo 命令用法
      inputText: 'echo 命令怎么用',
      apiKey: 'sk-fake',
      apiKeySource: 'server',
    });

    const { getAgentRun } = await import('../store.js');
    const dbRun = await getAgentRun(run.id);
    const { buildInitialPlan } = await import('../runPlanGlue.js');
    const plan = await buildInitialPlan(dbRun!);

    // LLM planner 真被调用 + 返回的是 LLM 的 intentSummary，而不是 echo 计划的
    // "测试 agent 跑 N 步 echo"
    expect(capture.called()).toBe(true);
    expect(plan.intentSummary).toBe('llm-planned-it');
    expect(plan.intentSummary).not.toMatch(/echo/i);
  });

  it('生产模式 + AGENT_ECHO_KEYWORD=1 + 文本含 "echo" → 仍走 echo fallback(dev 逃生舱保留)', async () => {
    process.env.AGENT_ECHO_KEYWORD = '1';
    const capture = installPlannerCaptureFetch('should-not-be-called');

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'eb2-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'eb2',
    });
    const sess = await createChatSession(user.id, 'eb2');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'echo 2 两步',
      apiKey: 'sk-fake',
      apiKeySource: 'server',
    });

    const { getAgentRun } = await import('../store.js');
    const dbRun = await getAgentRun(run.id);
    const { buildInitialPlan } = await import('../runPlanGlue.js');
    const plan = await buildInitialPlan(dbRun!);

    // dev flag 下关键词分支生效:走写死 echo 计划,LLM 不被调
    expect(capture.called()).toBe(false);
    expect(plan.intentSummary).toMatch(/echo/i);
  });

  it('生产模式 + 文本含 "echo" + 有 plan → buildFinalContent 走 LLM replyGen，不返回写死 echo 回复 (issue 0004 第二处)', async () => {
    // replyGen 用的 fetch stub：返回纯文本回复(非 plan JSON)
    let saw = false;
    global.fetch = vi.fn(async (input: unknown) => {
      const urlStr =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as { url?: string })?.url ?? '';
      if (urlStr.includes('chat/completions')) saw = true;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'llm-final-reply' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'eb3-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'eb3',
    });
    const sess = await createChatSession(user.id, 'eb3');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'echo 命令怎么用',
      apiKey: 'sk-fake',
      apiKeySource: 'server',
    });

    // buildFinalContent 要求 run.plan 非空,否则会无条件走 fallback
    const { updateAgentRun, getAgentRun } = await import('../store.js');
    await updateAgentRun(run.id, {
      status: 'running',
      plan: {
        intentSummary: 'do the thing',
        steps: [],
        todos: [],
        finalReplyHint: 'h',
        version: 1,
        reasoning: null,
      },
    });
    const dbRun = await getAgentRun(run.id);
    const { buildFinalContent } = await import('../runReply.js');
    const content = await buildFinalContent(dbRun!, 'completed', undefined);

    // LLM replyGen 真被调用 + 返回 LLM 的回复，而不是写死 echo fallback
    expect(saw).toBe(true);
    expect(content).toBe('llm-final-reply');
  });
});
