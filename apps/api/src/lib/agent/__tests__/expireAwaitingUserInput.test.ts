import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { autoExpireAwaitingUserInput } from '../expireAwaitingUserInput.js';
import { createUser } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';

async function ensureUser(): Promise<string> {
  const u = await createUser({
    username: 'm4-exp-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: 'm4-exp-test',
  });
  return u.id;
}

async function makeAwaitingRun(ownerId: string, expiresAt: Date | null) {
  const run = await store.insertAgentRun({
    ownerId, channel: 'private', sessionId: null, groupId: null, topicId: null,
    intentTurnId: null, role: 'generalist', status: 'awaiting_user_input',
    inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
  });
  await store.updateAgentRun(run.id, {
    pendingUserPrompt: 'q?',
    pendingUserStepIdx: 0,
    pendingUserInputExpiresAt: expiresAt,
  });
  return run;
}

describe('autoExpireAwaitingUserInput', { timeout: 15000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('expired run → cancelled with reason=user_timeout', async () => {
    const u = await ensureUser();
    const r = await makeAwaitingRun(u, new Date(Date.now() - 1000));
    const n = await autoExpireAwaitingUserInput(new Date());
    expect(n).toBe(1);
    const re = await store.getAgentRun(r.id);
    expect(re?.status).toBe('cancelled');
    expect(re?.cancelReason).toBe('user_timeout');
    expect(re?.endedAt).toBeInstanceOf(Date);
  });

  it('not-yet-expired run → untouched', async () => {
    const u = await ensureUser();
    const r = await makeAwaitingRun(u, new Date(Date.now() + 30_000));
    const n = await autoExpireAwaitingUserInput(new Date());
    expect(n).toBe(0);
    const re = await store.getAgentRun(r.id);
    expect(re?.status).toBe('awaiting_user_input');
  });

  it('expires_at IS NULL → skipped（兼容 M3 老 awaiting run）', async () => {
    const u = await ensureUser();
    const r = await makeAwaitingRun(u, null);
    const n = await autoExpireAwaitingUserInput(new Date());
    expect(n).toBe(0);
    const re = await store.getAgentRun(r.id);
    expect(re?.status).toBe('awaiting_user_input');
  });

  it('non-awaiting run with past expires_at → skipped', async () => {
    const u = await ensureUser();
    const r = await store.insertAgentRun({
      ownerId: u, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'x', budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    await store.updateAgentRun(r.id, {
      pendingUserInputExpiresAt: new Date(Date.now() - 1000),
    });
    const n = await autoExpireAwaitingUserInput(new Date());
    expect(n).toBe(0);
    const re = await store.getAgentRun(r.id);
    expect(re?.status).toBe('running');
  });

  it('returns 0 when nothing to expire', async () => {
    const n = await autoExpireAwaitingUserInput(new Date());
    expect(n).toBe(0);
  });

  it('run already resumed to running → skipped（user_timeout 竞态防护）', async () => {
    // 模拟：用户先 resume，run 已变 'running'；worker tick 延迟到此时才触发
    const u = await ensureUser();
    const r = await makeAwaitingRun(u, new Date(Date.now() - 1000));
    // 手动把 status 切回 running（模拟 resume 已发生）
    await store.updateAgentRun(r.id, { status: 'running' });

    const n = await autoExpireAwaitingUserInput(new Date());
    expect(n).toBe(0);
    const re = await store.getAgentRun(r.id);
    expect(re?.status).toBe('running'); // 不应被取消
  });
});
