import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun } from '../runtime.js';
import { getUserApiKeyEnc } from '../store.js';
import { openUserApiKey } from '../secretBox.js';

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

describe('createAgentRun persists per-user DeepSeek key (M1d Task 6)', () => {
  const ORIGINAL = process.env.AGENT_KEY_SECRET;
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    process.env.AGENT_KEY_SECRET = 'unit-test-secret-must-be-long-enough';
  });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.AGENT_KEY_SECRET;
    else process.env.AGENT_KEY_SECRET = ORIGINAL;
  });

  it('apiKeySource=user + AGENT_KEY_SECRET set: sealed key stored, decrypts to original', async () => {
    const user = await ensureUser('uk');
    const sess = await createChatSession(user.id, 'uk');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'user provided key path',
      apiKey: 'sk-deepseek-USER-XYZ',
      apiKeySource: 'user',
    });
    const sealed = await getUserApiKeyEnc(run.id);
    expect(sealed).toBeTruthy();
    expect(sealed).not.toContain('USER-XYZ');
    expect(openUserApiKey(sealed!)).toBe('sk-deepseek-USER-XYZ');
  });

  it('apiKeySource=server: no sealed key stored', async () => {
    const user = await ensureUser('sk');
    const sess = await createChatSession(user.id, 'sk');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'server key path',
      apiKey: 'sk-deepseek-SERVER',
      apiKeySource: 'server',
    });
    const sealed = await getUserApiKeyEnc(run.id);
    expect(sealed).toBeNull();
  });

  it('AGENT_KEY_SECRET missing: user key dropped silently (warn logged), run still created', async () => {
    delete process.env.AGENT_KEY_SECRET;
    const user = await ensureUser('nokeysecret');
    const sess = await createChatSession(user.id, 'no');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'no secret env',
      apiKey: 'sk-deepseek-FOO',
      apiKeySource: 'user',
    });
    const sealed = await getUserApiKeyEnc(run.id);
    expect(sealed).toBeNull();
  });
});
