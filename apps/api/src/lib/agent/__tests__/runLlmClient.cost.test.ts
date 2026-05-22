import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { resolveLlmClient, _resetRunLlmClientNoticeDedup } from '../runLlmClient.js';
import { listNoticesForRun } from '../notices.js';

vi.mock('../../llm/factory.js', () => ({
  buildLlmClient: vi.fn((spec) => ({
    providerId: spec.providerId,
    modelId: spec.modelId,
    chat: vi.fn(async () => ({
      content: 'mocked',
      usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
      providerId: spec.providerId,
      modelId: spec.modelId,
    })),
  })),
}));

async function ensureUser(): Promise<string> {
  const u = await createUser({
    username: 'm4-llm-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: 'm4-llm-test',
  });
  return u.id;
}

async function makeRun(ownerId: string, modelId: string) {
  return store.insertAgentRun({
    ownerId,
    channel: 'private',
    sessionId: null,
    groupId: null,
    topicId: null,
    intentTurnId: null,
    role: 'generalist',
    status: 'running',
    inputText: 'x',
    budget: DEFAULT_BUDGET,
    apiKeySource: 'server',
    apiKeyOwnerId: null,
    providerId: 'deepseek',
    modelId,
  });
}

describe('runLlmClient cost accounting', { timeout: 15000 }, () => {
  beforeAll(async () => {
    process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key';
    await runMigrations();
  });
  beforeEach(async () => {
    _resetRunLlmClientNoticeDedup();
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_event_logs');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('known model: chat() returns → usage.costCny 累加到 run', async () => {
    const ownerId = await ensureUser();
    const run = await makeRun(ownerId, 'deepseek-chat');
    const client = await resolveLlmClient(run);
    expect(client).not.toBeNull();
    await client!.chat([{ role: 'user', content: 'hi' }], { signal: new AbortController().signal });

    const reloaded = await store.getAgentRun(run.id);
    // 1000 prompt × 0.002/1000 + 500 completion × 0.008/1000 = 0.002 + 0.004 = 0.006
    expect(reloaded?.usage.costCny).toBeCloseTo(0.006, 4);
    expect(reloaded?.usage.tokens).toBe(1500);
  });

  it('multiple chat() calls: costCny accumulates', async () => {
    const ownerId = await ensureUser();
    const run = await makeRun(ownerId, 'deepseek-chat');
    const client = await resolveLlmClient(run);
    await client!.chat([{ role: 'user', content: 'a' }], { signal: new AbortController().signal });
    await client!.chat([{ role: 'user', content: 'b' }], { signal: new AbortController().signal });

    const reloaded = await store.getAgentRun(run.id);
    expect(reloaded?.usage.costCny).toBeCloseTo(0.012, 4);
    expect(reloaded?.usage.tokens).toBe(3000);
  });

  it('unknown model: emits COST_UNKNOWN_MODEL notice once', async () => {
    const ownerId = await ensureUser();
    const run = await makeRun(ownerId, 'fictional/model-xyz');
    const client = await resolveLlmClient(run);
    await client!.chat([{ role: 'user', content: 'x' }], { signal: new AbortController().signal });
    await client!.chat([{ role: 'user', content: 'y' }], { signal: new AbortController().signal });

    const reloaded = await store.getAgentRun(run.id);
    expect(reloaded?.usage.costCny).toBe(0); // unknown → 0
    const notices = await listNoticesForRun(run.id, { limit: 20 });
    const costNotices = notices.filter((n) => n.code === 'COST_UNKNOWN_MODEL');
    expect(costNotices.length).toBe(1); // 仅一次（dedup 生效）
  });
});
