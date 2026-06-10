import { it, expect, beforeAll, beforeEach } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as store from '../store.js';
import { cancelRun } from '../runLifecycle.js';
import { DEFAULT_BUDGET } from '../types.js';
import { ensureUser } from './_groupFixture.js';

describeDb('cancelRun idle path writes artifact', { timeout: 15000 }, () => {
  beforeAll(async () => { await runMigrations(); });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('cancelled run (no controller) → artifact.finalContent = "[任务已取消]"', async () => {
    const { id: ownerId } = await ensureUser('m5-cancel-artifact');
    const run = await store.insertAgentRun({
      ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });

    // No active controller → idle path: writes artifact directly (no softComplete).
    // byUserId is required by the signature; passing ownerId is the natural caller for user-cancel.
    await cancelRun(run.id, ownerId);

    const reloaded = (await store.getAgentRun(run.id))!;
    expect(reloaded.status).toBe('cancelled');
    expect(reloaded.artifact).not.toBeNull();
    expect(reloaded.artifact!.finalContent).toBe('[任务已取消]');
    expect(Array.isArray(reloaded.artifact!.refs)).toBe(true);
    expect(reloaded.artifact!.model.providerId).toBeTruthy();
    expect(reloaded.artifact!.producedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
