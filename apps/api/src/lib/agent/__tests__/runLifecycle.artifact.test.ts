import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as store from '../store.js';
import { softComplete } from '../runLifecycle.js';
import { DEFAULT_BUDGET } from '../types.js';
import { ensureUser } from './_groupFixture.js';

describe('softComplete writes artifact', { timeout: 15000 }, () => {
  beforeAll(async () => { await runMigrations(); });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('completed run → artifact { finalContent, refs[], model, producedAt }', async () => {
    const { id: ownerId } = await ensureUser('m5-artifact');
    const run = await store.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'hello', budget: DEFAULT_BUDGET,
      apiKeySource: 'server', apiKeyOwnerId: null,
      providerId: 'deepseek', modelId: 'deepseek-chat',
    });
    // In test env, buildFinalContent calls pickFallbackFinalContent (no plan → '[任务未完成]')
    await softComplete((await store.getAgentRun(run.id))!, 'completed');
    const reloaded = (await store.getAgentRun(run.id))!;
    expect(reloaded.artifact).not.toBeNull();
    expect(reloaded.artifact!.finalContent.length).toBeGreaterThan(0);
    expect(reloaded.artifact!.finalContent).toContain('任务未完成');
    expect(reloaded.artifact!.model.providerId).toBe('deepseek');
    expect(reloaded.artifact!.model.modelId).toBe('deepseek-chat');
    expect(reloaded.artifact!.producedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(reloaded.artifact!.refs)).toBe(true);
  });

  it('failed run → artifact also written', async () => {
    const { id: ownerId } = await ensureUser('m5-fail');
    const run = await store.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'hello', budget: DEFAULT_BUDGET,
      apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await softComplete((await store.getAgentRun(run.id))!, 'failed', 'oom');
    const reloaded = (await store.getAgentRun(run.id))!;
    expect(reloaded.artifact).not.toBeNull();
    expect(reloaded.artifact!.finalContent.length).toBeGreaterThan(0);
    expect(reloaded.artifact!.refs).toEqual([]);
    expect(reloaded.artifact!.model.providerId).toBeTruthy();
  });
});
