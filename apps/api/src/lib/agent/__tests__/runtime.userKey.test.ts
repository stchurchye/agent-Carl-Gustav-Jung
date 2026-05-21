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

/**
 * M1e Task 3：resolveEffectiveApiKey 在降级时必须 emitNotice，让用户能在 UI 看到
 * "你的 key 没用上，走了 server key" 的告警。
 */
describe('resolveEffectiveApiKey emits user-facing notice on degradation (M1e blocker 3)', () => {
  const ORIGINAL_SECRET = process.env.AGENT_KEY_SECRET;
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
    const shared = await import('../runtimeShared.js');
    shared._resetResolveKeyNoticeDedup();
  });
  afterAll(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.AGENT_KEY_SECRET;
    else process.env.AGENT_KEY_SECRET = ORIGINAL_SECRET;
    if (ORIGINAL_DS === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = ORIGINAL_DS;
  });

  it('apiKeySource=user but sealed=null → emits USER_KEY_MISSING + falls back to server key', async () => {
    process.env.AGENT_KEY_SECRET = 'unit-test-secret-must-be-long-enough';
    process.env.DEEPSEEK_API_KEY = 'sk-server-fallback';
    const user = await ensureUser('uk-missing');
    const sess = await createChatSession(user.id, 'm');
    // 故意：用 apiKeySource=user 但传 apiKey='' → seal 不会写
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'no sealed key',
      apiKey: '',
      apiKeySource: 'user',
    });
    expect(await getUserApiKeyEnc(run.id)).toBeNull();

    const { resolveEffectiveApiKey } = await import('../runtimeShared.js');
    const dbRun = await (await import('../store.js')).getAgentRun(run.id);
    const key = await resolveEffectiveApiKey(dbRun!);
    expect(key).toBe('sk-server-fallback');

    const { listNoticesForRun } = await import('../notices.js');
    const notices = await listNoticesForRun(run.id);
    expect(notices.map((n) => n.code)).toContain('USER_KEY_MISSING');
  });

  it('apiKeySource=user but secret rotated (decrypt throws) → emits USER_KEY_DECRYPT_FAILED', async () => {
    process.env.AGENT_KEY_SECRET = 'original-secret-must-be-long-enough';
    process.env.DEEPSEEK_API_KEY = 'sk-server-fb-2';
    const user = await ensureUser('uk-rot');
    const sess = await createChatSession(user.id, 'r');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'sealed with A, will rotate',
      apiKey: 'sk-deepseek-USER-ABC',
      apiKeySource: 'user',
    });
    expect(await getUserApiKeyEnc(run.id)).toBeTruthy();

    // 轮换 secret，此时 openUserApiKey 会 throw
    process.env.AGENT_KEY_SECRET = 'rotated-secret-totally-different-xx';
    const { resolveEffectiveApiKey } = await import('../runtimeShared.js');
    const dbRun = await (await import('../store.js')).getAgentRun(run.id);
    const key = await resolveEffectiveApiKey(dbRun!);
    expect(key).toBe('sk-server-fb-2');

    const { listNoticesForRun } = await import('../notices.js');
    const notices = await listNoticesForRun(run.id);
    expect(notices.map((n) => n.code)).toContain('USER_KEY_DECRYPT_FAILED');
  });

  it('no user key + no server env → emits NO_API_KEY + returns undefined', async () => {
    delete process.env.AGENT_KEY_SECRET;
    delete process.env.DEEPSEEK_API_KEY;
    const user = await ensureUser('uk-none');
    const sess = await createChatSession(user.id, 'n');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'totally no key',
      apiKey: '',
      apiKeySource: 'server',
    });
    const { resolveEffectiveApiKey } = await import('../runtimeShared.js');
    const dbRun = await (await import('../store.js')).getAgentRun(run.id);
    const key = await resolveEffectiveApiKey(dbRun!);
    expect(key).toBeUndefined();

    const { listNoticesForRun } = await import('../notices.js');
    const notices = await listNoticesForRun(run.id);
    expect(notices.map((n) => n.code)).toContain('NO_API_KEY');
  });

  it('same notice code emitted only once per run (process-local dedup)', async () => {
    process.env.AGENT_KEY_SECRET = 'unit-test-secret-must-be-long-enough';
    process.env.DEEPSEEK_API_KEY = 'sk-server';
    const user = await ensureUser('uk-dedup');
    const sess = await createChatSession(user.id, 'd');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'dedup',
      apiKey: '',
      apiKeySource: 'user',
    });
    const { resolveEffectiveApiKey } = await import('../runtimeShared.js');
    const dbRun = await (await import('../store.js')).getAgentRun(run.id);
    await resolveEffectiveApiKey(dbRun!);
    await resolveEffectiveApiKey(dbRun!);
    await resolveEffectiveApiKey(dbRun!);

    const { listNoticesForRun } = await import('../notices.js');
    const notices = await listNoticesForRun(run.id);
    const missing = notices.filter((n) => n.code === 'USER_KEY_MISSING');
    expect(missing).toHaveLength(1);
  });
});
