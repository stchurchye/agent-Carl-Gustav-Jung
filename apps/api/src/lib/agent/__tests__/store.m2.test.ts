import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as agentStore from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';

async function ensureUser(): Promise<string> {
  const u = await createUser({
    username: 'm2-store-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: 'm2-store-test',
  });
  return u.id;
}

// Round-trip test for new columns
describe('M2 Task 1A: agent_runs new columns', { timeout: 15000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('sandbox_id and user_api_keys_enc columns exist and round-trip', async () => {
    const ownerId = await ensureUser();

    // Insert via store (new columns default to null / {})
    const run = await agentStore.insertAgentRun({
      ownerId,
      channel: 'private',
      sessionId: null,
      groupId: null,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status: 'draft',
      inputText: 'hi',
      budget: DEFAULT_BUDGET,
      apiKeySource: 'server',
      apiKeyOwnerId: null,
    });

    // Verify defaults via store read
    const fetched = await agentStore.getAgentRun(run.id);
    expect(fetched?.sandboxId).toBeNull();
    expect(fetched?.userApiKeysEnc).toEqual({});

    // Update via updateAgentRun
    const updated = await agentStore.updateAgentRun(run.id, {
      sandboxId: 'sbx_abc123',
      userApiKeysEnc: { e2b: 'blob' },
    });
    expect(updated?.sandboxId).toBe('sbx_abc123');
    expect(updated?.userApiKeysEnc).toEqual({ e2b: 'blob' });

    // Read it back
    const re = await agentStore.getAgentRun(run.id);
    expect(re?.sandboxId).toBe('sbx_abc123');
    expect(re?.userApiKeysEnc).toEqual({ e2b: 'blob' });

    // Clear sandboxId (mimics softComplete)
    const cleared = await agentStore.updateAgentRun(run.id, { sandboxId: null });
    expect(cleared?.sandboxId).toBeNull();
  });
});
