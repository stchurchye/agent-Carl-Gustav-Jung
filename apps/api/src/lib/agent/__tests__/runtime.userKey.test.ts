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
 * M1e Task 3 + Task 11d：resolveEffectiveApiKeyForProvider 在降级时必须 emitNotice，
 * 让用户能在 UI 看到"你的 key 没用上，走了 server key"的告警。
 * M1e Task 11d 之后接口签名是 (run, providerId)，dedup 维度是 (runId, providerId, code)。
 */
describe('resolveEffectiveApiKeyForProvider emits notice on degradation (M1e blocker 3 + Task 11d)', () => {
  const ORIGINAL_SECRET = process.env.AGENT_KEY_SECRET;
  const ORIGINAL_DS = process.env.DEEPSEEK_API_KEY;
  const ORIGINAL_ZM = process.env.ZENMUX_API_KEY;

  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    await getPool().query(
      `DELETE FROM agent_event_logs WHERE event_type = 'user_facing_notice'`,
    );
    const mod = await import('../runLlmClient.js');
    mod._resetRunLlmClientNoticeDedup();
  });
  afterAll(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.AGENT_KEY_SECRET;
    else process.env.AGENT_KEY_SECRET = ORIGINAL_SECRET;
    if (ORIGINAL_DS === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = ORIGINAL_DS;
    if (ORIGINAL_ZM === undefined) delete process.env.ZENMUX_API_KEY;
    else process.env.ZENMUX_API_KEY = ORIGINAL_ZM;
  });

  it('deepseek: apiKeySource=user but sealed=null → USER_KEY_MISSING + falls back to server', async () => {
    process.env.AGENT_KEY_SECRET = 'unit-test-secret-must-be-long-enough';
    process.env.DEEPSEEK_API_KEY = 'sk-server-fallback';
    const user = await ensureUser('uk-missing');
    const sess = await createChatSession(user.id, 'm');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'no sealed key',
      apiKey: '',
      apiKeySource: 'user',
    });
    expect(await getUserApiKeyEnc(run.id)).toBeNull();

    const { resolveEffectiveApiKeyForProvider } = await import('../runLlmClient.js');
    const dbRun = await (await import('../store.js')).getAgentRun(run.id);
    const key = await resolveEffectiveApiKeyForProvider(dbRun!, 'deepseek');
    expect(key).toBe('sk-server-fallback');

    const { listNoticesForRun } = await import('../notices.js');
    const notices = await listNoticesForRun(run.id);
    expect(notices.map((n) => n.code)).toContain('USER_KEY_MISSING');
  });

  it('deepseek: secret rotated (decrypt throws) → USER_KEY_DECRYPT_FAILED', async () => {
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

    process.env.AGENT_KEY_SECRET = 'rotated-secret-totally-different-xx';
    const { resolveEffectiveApiKeyForProvider } = await import('../runLlmClient.js');
    const dbRun = await (await import('../store.js')).getAgentRun(run.id);
    const key = await resolveEffectiveApiKeyForProvider(dbRun!, 'deepseek');
    expect(key).toBe('sk-server-fb-2');

    const { listNoticesForRun } = await import('../notices.js');
    const notices = await listNoticesForRun(run.id);
    expect(notices.map((n) => n.code)).toContain('USER_KEY_DECRYPT_FAILED');
  });

  it('deepseek: decrypt success but plaintext only-whitespace → USER_KEY_DECRYPT_FAILED + falls back (review #6)', async () => {
    process.env.AGENT_KEY_SECRET = 'unit-test-secret-must-be-long-enough';
    process.env.DEEPSEEK_API_KEY = 'sk-server-fb-empty';
    const user = await ensureUser('uk-empty');
    const sess = await createChatSession(user.id, 'e');
    const { sealUserApiKey } = await import('../secretBox.js');
    const sealedWhitespace = sealUserApiKey('   ');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'empty plaintext',
      apiKey: 'placeholder-will-be-replaced',
      apiKeySource: 'user',
    });
    await getPool().query(
      `UPDATE agent_runs SET user_api_key_enc = $1 WHERE id = $2`,
      [sealedWhitespace, run.id],
    );
    const { resolveEffectiveApiKeyForProvider } = await import('../runLlmClient.js');
    const dbRun = await (await import('../store.js')).getAgentRun(run.id);
    const key = await resolveEffectiveApiKeyForProvider(dbRun!, 'deepseek');
    expect(key).toBe('sk-server-fb-empty');

    const { listNoticesForRun } = await import('../notices.js');
    const notices = await listNoticesForRun(run.id);
    const decrypt = notices.find((n) => n.code === 'USER_KEY_DECRYPT_FAILED');
    expect(decrypt).toBeDefined();
    expect(decrypt?.context).toMatchObject({ reason: 'empty_plaintext' });
  });

  it('zenmux: per-provider env split — DEEPSEEK_API_KEY ignored, ZENMUX_API_KEY used', async () => {
    delete process.env.AGENT_KEY_SECRET;
    process.env.DEEPSEEK_API_KEY = 'sk-deepseek-IGNORE';
    process.env.ZENMUX_API_KEY = 'sk-zenmux-WIN';
    const user = await ensureUser('zm-srv');
    const sess = await createChatSession(user.id, 'z');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'no user key',
      apiKey: '',
      apiKeySource: 'server',
      providerId: 'zenmux',
      modelId: 'moonshotai/kimi-k2.6',
    });
    const { resolveEffectiveApiKeyForProvider } = await import('../runLlmClient.js');
    const dbRun = await (await import('../store.js')).getAgentRun(run.id);
    const key = await resolveEffectiveApiKeyForProvider(dbRun!, 'zenmux');
    expect(key).toBe('sk-zenmux-WIN');
  });

  it('resolveLlmClient: missing both user key and server env → emits NO_API_KEY + returns null', async () => {
    delete process.env.AGENT_KEY_SECRET;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ZENMUX_API_KEY;
    const user = await ensureUser('llm-none');
    const sess = await createChatSession(user.id, 'n');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'totally no key',
      apiKey: '',
      apiKeySource: 'server',
    });
    const { resolveLlmClient } = await import('../runLlmClient.js');
    const dbRun = await (await import('../store.js')).getAgentRun(run.id);
    const client = await resolveLlmClient(dbRun!);
    expect(client).toBeNull();

    const { listNoticesForRun } = await import('../notices.js');
    const notices = await listNoticesForRun(run.id);
    expect(notices.map((n) => n.code)).toContain('NO_API_KEY');
  });

  it('resolveLlmClient: server key present → returns built LlmChatClient with run.providerId+modelId', async () => {
    delete process.env.AGENT_KEY_SECRET;
    process.env.DEEPSEEK_API_KEY = 'sk-srv-llm';
    const user = await ensureUser('llm-srv');
    const sess = await createChatSession(user.id, 's');
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'happy path',
      apiKey: '',
      apiKeySource: 'server',
    });
    const { resolveLlmClient } = await import('../runLlmClient.js');
    const dbRun = await (await import('../store.js')).getAgentRun(run.id);
    const client = await resolveLlmClient(dbRun!);
    expect(client).not.toBeNull();
    expect(client!.providerId).toBe('deepseek');
    expect(client!.modelId).toBe('deepseek-v4-pro');
  });

  it('same notice code emitted only once per (run, provider) — process-local dedup', async () => {
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
    const { resolveEffectiveApiKeyForProvider } = await import('../runLlmClient.js');
    const dbRun = await (await import('../store.js')).getAgentRun(run.id);
    await resolveEffectiveApiKeyForProvider(dbRun!, 'deepseek');
    await resolveEffectiveApiKeyForProvider(dbRun!, 'deepseek');
    await resolveEffectiveApiKeyForProvider(dbRun!, 'deepseek');

    const { listNoticesForRun } = await import('../notices.js');
    const notices = await listNoticesForRun(run.id);
    const missing = notices.filter((n) => n.code === 'USER_KEY_MISSING');
    expect(missing).toHaveLength(1);
  });
});
