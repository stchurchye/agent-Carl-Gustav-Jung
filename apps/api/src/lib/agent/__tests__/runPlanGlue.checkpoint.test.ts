import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';

import { describeDb } from '../../../testUtils/dbGuard.js';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun } from '../runtime.js';
import { getAgentRun, insertStep, maxStepIdx, updateAgentRun } from '../store.js';
import type { AgentCheckpoint } from '../types.js';
import type { LlmChatClient, LlmChatMessage, LlmChatResult } from '../../llm/types.js';

/**
 * P0-S5 接线:buildInitialPlan 只要 run.contextCheckpoint 非空就传给 planner
 * (此前仅 continuation replan 传 → steer/deny/critique 重规划丢失早期发现)。
 * 非 continuation 用中性框架。
 */

let capturedUserPrompt = '';

const fakeLlm: LlmChatClient = {
  providerId: 'deepseek',
  modelId: 'deepseek-test',
  async chat(messages: LlmChatMessage[]): Promise<LlmChatResult> {
    if (!capturedUserPrompt) {
      capturedUserPrompt = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    }
    return {
      content: JSON.stringify({
        intentSummary: 'x',
        steps: [{ toolName: 'echo_after_sleep', input: {}, reason: 'r', todoId: 't1' }],
        todos: [{ id: 't1', text: 't' }],
        finalReplyHint: '',
      }),
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

function cp(): AgentCheckpoint {
  return {
    version: 1,
    goal: '研究荣格',
    intent: '综述',
    completed: [{ text: 'search_web', finding: '已找到 3 篇关键文献', refs: [] }],
    remainingPlan: ['写综述'],
    openQuestions: [],
    nextStep: '写综述',
    successCount: 1,
    producedAtIdx: 3,
    digestTail: '',
  };
}

async function mkRunWithCheckpoint() {
  const user = await createUser({
    username: 'gcp-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: 'gcp',
  });
  const sess = await createChatSession(user.id, 'gcp');
  const { run } = await createAgentRun({
    ownerId: user.id,
    channel: 'private',
    sessionId: sess.id,
    inputText: '研究荣格',
    apiKey: 'fake',
    apiKeySource: 'server',
  });
  await updateAgentRun(run.id, { contextCheckpoint: cp() });
  return run;
}

describeDb('P0-S5:buildInitialPlan 非 continuation replan 也传 checkpoint', () => {
  beforeAll(async () => {
    await runMigrations();
    const { registerEchoSleep } = await import('../tools/echoSleep.js');
    registerEchoSleep();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    capturedUserPrompt = '';
    vi.stubEnv('VITEST', 'false');
    vi.stubEnv('NODE_ENV', 'production');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('最近 replan 是 steer → checkpoint 以中性框架进 prompt(发现可见,无续跑话术)', async () => {
    const run = await mkRunWithCheckpoint();
    const idx = (await maxStepIdx(run.id)) + 1;
    await insertStep({
      runId: run.id,
      idx,
      kind: 'replan',
      output: { reason: 'steer', directive: '改讲共时性' },
    });
    const { buildInitialPlan } = await import('../runPlanGlue.js');

    await buildInitialPlan((await getAgentRun(run.id))!);

    expect(capturedUserPrompt).toContain('已找到 3 篇关键文献'); // 早期发现不再丢
    expect(capturedUserPrompt).toContain('已有任务进展');
    expect(capturedUserPrompt).not.toContain('自动续跑');
  });

  it('最近 replan 是 continuation → 沿用续跑框架(原行为不回归)', async () => {
    const run = await mkRunWithCheckpoint();
    const idx = (await maxStepIdx(run.id)) + 1;
    await insertStep({
      runId: run.id,
      idx,
      kind: 'replan',
      output: { reason: 'continuation', progress: '已完成第一步' },
    });
    const { buildInitialPlan } = await import('../runPlanGlue.js');

    await buildInitialPlan((await getAgentRun(run.id))!);

    expect(capturedUserPrompt).toContain('自动续跑中');
    expect(capturedUserPrompt).toContain('已找到 3 篇关键文献');
  });
});
