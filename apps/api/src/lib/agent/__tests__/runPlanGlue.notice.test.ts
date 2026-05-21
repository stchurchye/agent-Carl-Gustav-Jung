import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';

/**
 * M1e Task 13.4：planner LLM 失败时 buildInitialPlan 应 emit PLANNER_LLM_FALLBACK
 * notice + 写一条 system_error step，而不是静默回 echo plan。
 *
 * 测试策略：用 `vi.mock` 把 planner.generatePlanWithLlm 替换成 throw，
 * 同时强行 unset VITEST 让 buildInitialPlan 走 LLM 分支而非"测试 env → echo"短路。
 */
vi.mock('../planner.js', async () => {
  const actual = await vi.importActual<typeof import('../planner.js')>('../planner.js');
  return {
    ...actual,
    generatePlanWithLlm: vi.fn(async () => {
      throw new Error('SIMULATED LLM FAILURE');
    }),
  };
});

describe('buildInitialPlan: PLANNER_LLM_FALLBACK on LLM error (M1e Task 13.4)', () => {
  const ORIGINAL_VITEST = process.env.VITEST;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_DS = process.env.DEEPSEEK_API_KEY;

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
  });

  afterEach(() => {
    if (ORIGINAL_VITEST === undefined) delete process.env.VITEST;
    else process.env.VITEST = ORIGINAL_VITEST;
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_DS === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = ORIGINAL_DS;
  });

  it('LLM throw → returns echo plan + emits PLANNER_LLM_FALLBACK + writes system_error step', async () => {
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
    // 必须 fallback 到 echo plan，不能 throw
    expect(plan).toBeDefined();
    expect(plan.intentSummary).toBeTruthy();

    // 应当 emit PLANNER_LLM_FALLBACK
    const { listNoticesForRun } = await import('../notices.js');
    const notices = await listNoticesForRun(run.id);
    const fallback = notices.find((n) => n.code === 'PLANNER_LLM_FALLBACK');
    expect(fallback).toBeDefined();
    expect(fallback?.severity).toBe('warn');
    expect((fallback?.context as { error: string })?.error).toContain('SIMULATED');

    // 应当写一条 system_error step
    const { listSteps } = await import('../store.js');
    const steps = await listSteps(run.id);
    const sysErr = steps.find((s) => s.kind === 'system_error');
    expect(sysErr).toBeDefined();
    expect(sysErr?.error).toContain('planner_llm_fallback');
    expect(sysErr?.error).toContain('SIMULATED');
  });
});
