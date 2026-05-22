import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import type { RunArtifact } from '../types.js';
import { ensureUser } from './_groupFixture.js';

const sampleArtifact: RunArtifact = {
  finalContent: '最終産物内容',
  refs: [{ kind: 'document', id: 'd1', label: '測試文档' }],
  model: { providerId: 'deepseek', modelId: 'deepseek-chat' },
  producedAt: '2026-05-23T00:00:00Z',
};

describe('store M5A: artifact column', { timeout: 15000 }, () => {
  beforeAll(async () => { await runMigrations(); });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  async function makeRun(ownerId: string) {
    return store.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
  }

  it('insertAgentRun → artifact defaults to null', async () => {
    const { id: ownerId } = await ensureUser('m5-store-a');
    const run = await makeRun(ownerId);
    expect(run.artifact).toBeNull();
  });

  it('updateAgentRun({ artifact }) round-trips via DB', async () => {
    const { id: ownerId } = await ensureUser('m5-store-b');
    const run = await makeRun(ownerId);
    const updated = await store.updateAgentRun(run.id, { artifact: sampleArtifact });
    expect(updated?.artifact).toEqual(sampleArtifact);
    const reloaded = await store.getAgentRun(run.id);
    expect(reloaded?.artifact).toEqual(sampleArtifact);
  });

  it('updateAgentRun({ artifact: null }) clears artifact', async () => {
    const { id: ownerId } = await ensureUser('m5-store-c');
    const run = await makeRun(ownerId);
    await store.updateAgentRun(run.id, { artifact: sampleArtifact });
    await store.updateAgentRun(run.id, { artifact: null });
    const reloaded = await store.getAgentRun(run.id);
    expect(reloaded?.artifact).toBeNull();
  });
});
