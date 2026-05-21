/**
 * M1e Task 12: 验证 intentExecute 把 agentOptions.providerId/modelId 透传到
 * createAgentRun → agent_runs 表，并按 providerId 选择正确的 user-key 落盘列。
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../db/migrate.js';
import { getPool } from '../../db/client.js';
import { createUser, createChatSession } from '../../store/pg.js';
import { hashPassword } from '../auth.js';
import { executeIntent } from '../intentExecute.js';
import * as store from '../agent/store.js';
import { openUserApiKey } from '../agent/secretBox.js';

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

describe('executeIntent(agent_run) honors agentOptions (M1e Task 12)', () => {
  const ORIGINAL_SECRET = process.env.AGENT_KEY_SECRET;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
    process.env.AGENT_KEY_SECRET = 'unit-test-secret-must-be-long-enough';
  });

  it('default (no agentOptions) → DB defaults provider=deepseek model=deepseek-v4-pro', async () => {
    const user = await ensureUser('a');
    const sess = await createChatSession(user.id, 'a');
    const res = await executeIntent({
      userId: user.id,
      text: 'echo 1 步',
      kind: 'agent_run',
      channel: 'private',
      sessionId: sess.id,
      apiKey: 'sk-zenmux-server',
      deepseekApiKey: undefined,
    });
    if (res.type !== 'agent') throw new Error('expected agent result');
    const dbRun = await store.getAgentRun(res.runId);
    expect(dbRun?.providerId).toBe('deepseek');
    expect(dbRun?.modelId).toBe('deepseek-v4-pro');
  });

  it('agentOptions.providerId=zenmux + modelId set → flows into agent_runs row', async () => {
    const user = await ensureUser('b');
    const sess = await createChatSession(user.id, 'b');
    const res = await executeIntent({
      userId: user.id,
      text: 'echo 1 步',
      kind: 'agent_run',
      channel: 'private',
      sessionId: sess.id,
      apiKey: 'sk-zenmux-USER-XYZ', // 来自 X-ZenMux-API-Key header
      zenmuxApiKey: 'sk-zenmux-USER-XYZ',
      deepseekApiKey: 'sk-deepseek-USER-ABC',
      agentOptions: {
        providerId: 'zenmux',
        modelId: 'moonshotai/kimi-k2.6',
      },
    });
    if (res.type !== 'agent') throw new Error('expected agent result');
    const dbRun = await store.getAgentRun(res.runId);
    expect(dbRun?.providerId).toBe('zenmux');
    expect(dbRun?.modelId).toBe('moonshotai/kimi-k2.6');

    // providerId=zenmux 时 user key 应落到 user_zenmux_key_enc，DeepSeek 列保持 null
    expect(await store.getUserApiKeyEnc(res.runId)).toBeNull();
    const zmSealed = await store.getUserZenmuxKeyEnc(res.runId);
    expect(zmSealed).toBeTruthy();
    expect(openUserApiKey(zmSealed!)).toBe('sk-zenmux-USER-XYZ');
  });

  it('agentOptions.providerId=deepseek + modelId set → DeepSeek user key path (M1d 兼容)', async () => {
    const user = await ensureUser('c');
    const sess = await createChatSession(user.id, 'c');
    const res = await executeIntent({
      userId: user.id,
      text: 'echo 1 步',
      kind: 'agent_run',
      channel: 'private',
      sessionId: sess.id,
      apiKey: 'sk-zenmux-srv',
      zenmuxApiKey: 'sk-zenmux-srv',
      deepseekApiKey: 'sk-deepseek-USER-DEF',
      agentOptions: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
      },
    });
    if (res.type !== 'agent') throw new Error('expected agent result');
    const dbRun = await store.getAgentRun(res.runId);
    expect(dbRun?.providerId).toBe('deepseek');
    expect(dbRun?.modelId).toBe('deepseek-v4-flash');

    const dsSealed = await store.getUserApiKeyEnc(res.runId);
    expect(dsSealed).toBeTruthy();
    expect(openUserApiKey(dsSealed!)).toBe('sk-deepseek-USER-DEF');
    expect(await store.getUserZenmuxKeyEnc(res.runId)).toBeNull();
  });

  it('apiKeySource derivation: zenmux+no user key → server', async () => {
    const user = await ensureUser('d');
    const sess = await createChatSession(user.id, 'd');
    const res = await executeIntent({
      userId: user.id,
      text: 'echo 1 步',
      kind: 'agent_run',
      channel: 'private',
      sessionId: sess.id,
      apiKey: 'sk-zenmux-server-fallback',
      zenmuxApiKey: undefined,
      deepseekApiKey: undefined,
      agentOptions: { providerId: 'zenmux', modelId: 'moonshotai/kimi-k2.6' },
    });
    if (res.type !== 'agent') throw new Error('expected agent result');
    const dbRun = await store.getAgentRun(res.runId);
    expect(dbRun?.apiKeySource).toBe('server');
    expect(await store.getUserZenmuxKeyEnc(res.runId)).toBeNull();
    expect(await store.getUserApiKeyEnc(res.runId)).toBeNull();
  });
});
