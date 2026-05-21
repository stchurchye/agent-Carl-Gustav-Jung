import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';

/**
 * M1e Task 13.4 + review followup：buildInitialPlan 必须真的能 emit
 * PLANNER_LLM_FALLBACK notice + 写一条 system_error step。
 *
 * 原来的测试用 `vi.mock('../planner.js')` 直接 stub `generatePlanWithLlm` 抛错；
 * 但 reviewer 指出生产代码里 `generatePlanWithLlm` 自己 try/catch 把异常吃掉了，
 * 所以 buildInitialPlan 的 catch 块在生产里永远走不到，notice 永远 emit 不出。
 *
 * 这版测试**不再 mock planner**。改成 stub `global.fetch` 抛错，让真正的
 * DeepSeekLlmClient → generatePlanWithLlm → buildInitialPlan 链路完整跑通。
 */

const realFetch = global.fetch;

describe('buildInitialPlan: PLANNER_LLM_FALLBACK on LLM error (M1e Task 13.4 + review)', () => {
  const ORIGINAL_VITEST = process.env.VITEST;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_DS = process.env.DEEPSEEK_API_KEY;
  const ORIGINAL_SECRET = process.env.AGENT_KEY_SECRET;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    await getPool().query(
      `DELETE FROM agent_event_logs WHERE event_type = 'user_facing_notice'`,
    );
    // 让 buildInitialPlan 不走"测试 env → echo" 短路
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

  it('production: LLM fetch throws → emits PLANNER_LLM_FALLBACK + system_error step', async () => {
    // 让所有 fetch 都抛错（模拟 LLM 网络故障）。注意 snapshotForAgent 内部可能也 fetch
    // —— 但 buildInitialPlan 已经把 snapshot 的失败包在 try/catch 里。
    global.fetch = vi.fn(async () => {
      throw new Error('SIMULATED_LLM_NETWORK_DOWN');
    }) as unknown as typeof fetch;

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'plg-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'plg',
    });
    const sess = await createChatSession(user.id, 'plg');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'research family trust pros and cons',
      apiKey: 'sk-fake',
      apiKeySource: 'server',
    });
    const dbRun = await (await import('../store.js')).getAgentRun(run.id);
    const { buildInitialPlan } = await import('../runPlanGlue.js');
    const plan = await buildInitialPlan(dbRun!);

    // 必须 fallback 到 echo plan（不能 throw）
    expect(plan).toBeDefined();
    expect(plan.intentSummary).toBeTruthy();

    // 必须 emit PLANNER_LLM_FALLBACK notice（这是 reviewer 指出的死代码激活验证）
    const { listNoticesForRun } = await import('../notices.js');
    const notices = await listNoticesForRun(run.id);
    const fallback = notices.find((n) => n.code === 'PLANNER_LLM_FALLBACK');
    expect(fallback).toBeDefined();
    expect(fallback?.severity).toBe('warn');
    expect((fallback?.context as { error?: string })?.error).toMatch(
      /SIMULATED_LLM_NETWORK_DOWN/,
    );

    // 必须写一条 system_error step
    const { listSteps } = await import('../store.js');
    const steps = await listSteps(run.id);
    const sysErr = steps.find((s) => s.kind === 'system_error');
    expect(sysErr).toBeDefined();
    expect(sysErr?.error).toContain('planner_llm_fallback');
  });

  it('production: LLM returns garbage JSON → also emits PLANNER_LLM_FALLBACK + falls back', async () => {
    // 这次让 fetch 返回 200 + 无效 JSON 内容，触发 PlannerJsonParseError 路径。
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'this is definitely not a plan' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const { createUser, createChatSession } = await import('../../../store/pg.js');
    const { hashPassword } = await import('../../auth.js');
    const user = await createUser({
      username: 'plg2-' + randomUUID().slice(0, 6),
      passwordHash: await hashPassword('xxxxxxxx'),
      displayName: 'plg2',
    });
    const sess = await createChatSession(user.id, 'plg2');
    const { createAgentRun } = await import('../runtime.js');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'research family trust pros and cons',
      apiKey: 'sk-fake',
      apiKeySource: 'server',
    });
    const dbRun = await (await import('../store.js')).getAgentRun(run.id);
    const { buildInitialPlan } = await import('../runPlanGlue.js');
    const plan = await buildInitialPlan(dbRun!);
    expect(plan).toBeDefined();

    const { listNoticesForRun } = await import('../notices.js');
    const notices = await listNoticesForRun(run.id);
    const fallback = notices.find((n) => n.code === 'PLANNER_LLM_FALLBACK');
    expect(fallback).toBeDefined();
    expect((fallback?.context as { error?: string })?.error).toMatch(
      /PlannerJsonParseError|unparseable JSON|definitely not a plan/i,
    );
  });
});
