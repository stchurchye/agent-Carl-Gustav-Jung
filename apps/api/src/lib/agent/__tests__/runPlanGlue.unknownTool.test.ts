import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';

import { describeDb } from '../../../testUtils/dbGuard.js';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun } from '../runtime.js';
import { getAgentRun, listSteps } from '../store.js';
import type { LlmChatClient, LlmChatResult } from '../../llm/types.js';

/**
 * issue 0005(P0-S4)buildInitialPlan 层:重试一次后仍未知工具 → 不再静默 echo 降级,
 * 记 system_error + notice 后抛错,让 executeRun 收尾 failed(AC②)。
 *
 * buildInitialPlan 在 VITEST 下短路 echo,所以 stubEnv 关掉测试短路 + mock LLM/快照链路。
 */

const seqReplies: string[] = [];
let chatCalls = 0;

function planJson(toolName: string): string {
  return JSON.stringify({
    intentSummary: 'x',
    steps: [{ toolName, input: {}, reason: 'r', todoId: 't1' }],
    todos: [{ id: 't1', text: 't' }],
    finalReplyHint: '',
  });
}

const fakeLlm: LlmChatClient = {
  providerId: 'deepseek',
  modelId: 'deepseek-test',
  async chat(): Promise<LlmChatResult> {
    const content = seqReplies[Math.min(chatCalls, seqReplies.length - 1)];
    chatCalls++;
    return {
      content,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      providerId: 'deepseek',
      modelId: 'deepseek-test',
    };
  },
};

vi.mock('../runLlmClient.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../runLlmClient.js')>();
  return {
    ...orig,
    resolveLlmClient: vi.fn(async () => fakeLlm),
    resolveEffectiveApiKeyForProvider: vi.fn(async () => ''),
  };
});

vi.mock('../contextAdapter.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../contextAdapter.js')>();
  return {
    ...orig,
    snapshotForAgent: vi.fn(async () => ({
      systemPrompt: 'sys',
      history: [],
      shortSummary: 's',
      usage: { usedTokens: 0, limitTokens: 0, breakdown: { history: 0, system: 0, persona: 0 } },
      source: { channel: 'private' },
    })),
  };
});

async function mkRun() {
  const user = await createUser({
    username: 'glue-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: 'glue',
  });
  const sess = await createChatSession(user.id, 'glue');
  const { run } = await createAgentRun({
    ownerId: user.id,
    channel: 'private',
    sessionId: sess.id,
    inputText: '研究荣格',
    apiKey: 'fake',
    apiKeySource: 'server',
  });
  return (await getAgentRun(run.id))!;
}

describeDb('buildInitialPlan:未知工具两连败 → system_error + 抛错,不 echo 降级 (issue 0005 AC②)', () => {
  beforeAll(async () => {
    await runMigrations();
    const { registerEchoSleep } = await import('../tools/echoSleep.js');
    const { registerWebSearch } = await import('../tools/webSearch.js');
    registerEchoSleep();
    registerWebSearch();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    seqReplies.length = 0;
    chatCalls = 0;
    // 关掉 buildInitialPlan 的测试环境 echo 短路,走真 LLM(mock)路径
    vi.stubEnv('VITEST', 'false');
    vi.stubEnv('NODE_ENV', 'production');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('两次都未知 → 抛 PlannerUnknownToolError + system_error step 点名工具', async () => {
    seqReplies.push(planJson('risky_echo'), planJson('ghost_tool'));
    const run = await mkRun();
    const { buildInitialPlan } = await import('../runPlanGlue.js');
    const { PlannerUnknownToolError } = await import('../planner.js');

    const err = await buildInitialPlan(run).catch((e) => e);
    expect(err).toBeInstanceOf(PlannerUnknownToolError);
    expect(chatCalls).toBe(2);

    const steps = await listSteps(run.id);
    const sysErr = steps.find((s) => s.kind === 'system_error');
    expect(sysErr).toBeDefined();
    expect(sysErr!.error ?? '').toContain('ghost_tool');
    expect(sysErr!.error ?? '').toContain('planner_unknown_tool');
  });

  it('首次未知二次合法 → 正常返回 plan(重试在 generatePlanWithLlm 内消化,无 system_error)', async () => {
    seqReplies.push(planJson('risky_echo'), planJson('search_web'));
    const run = await mkRun();
    const { buildInitialPlan } = await import('../runPlanGlue.js');

    const plan = await buildInitialPlan(run);
    expect(plan.steps[0].toolName).toBe('search_web');
    expect(chatCalls).toBe(2);

    const steps = await listSteps(run.id);
    expect(steps.find((s) => s.kind === 'system_error')).toBeUndefined();
  });
});
