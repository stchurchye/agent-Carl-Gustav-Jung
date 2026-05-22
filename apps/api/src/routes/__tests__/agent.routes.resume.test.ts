/**
 * M3 Task 3：POST /api/agent/runs/:id/resume 路由测试。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../db/migrate.js';
import { getPool } from '../../db/client.js';
import * as store from '../../lib/agent/store.js';
import { agentRouter } from '../agent.js';
import { ensureUser, ensureGroup } from '../../lib/agent/__tests__/_groupFixture.js';
import { DEFAULT_BUDGET } from '../../lib/agent/types.js';
import { signAccessToken } from '../../lib/auth.js';
import type { AppVariables } from '../../types.js';

function makeApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('requestId', randomUUID());
    await next();
  });
  app.route('/api/agent', agentRouter);
  return app;
}

async function tokenFor(u: { id: string; username: string; displayName: string }) {
  const { accessToken } = await signAccessToken({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    createdAt: new Date().toISOString(),
  });
  return accessToken;
}

async function mkAwaitingRun(ownerId: string) {
  const r = await store.insertAgentRun({
    ownerId,
    channel: 'private',
    sessionId: null,
    groupId: null,
    topicId: null,
    intentTurnId: null,
    role: 'generalist',
    status: 'draft',
    inputText: 'test question',
    budget: DEFAULT_BUDGET,
    apiKeyOwnerId: null,
    apiKeySource: 'server',
  });
  await store.updateAgentRun(r.id, {
    status: 'awaiting_user_input',
    pendingUserPrompt: '哪个年份？',
    pendingUserStepIdx: 0,
  });
  return r;
}

describe('POST /api/agent/runs/:id/resume', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    await runMigrations();
  });
  beforeEach(async () => {
    if (!process.env.DATABASE_URL) return;
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('200: awaiting_user_input → running, returns updated run', async () => {
    if (!process.env.DATABASE_URL) return;

    const owner = await ensureUser('resume-owner');
    const run = await mkAwaitingRun(owner.id);
    const token = await tokenFor(owner);
    const app = makeApp();

    const res = await app.fetch(
      new Request(`http://test/api/agent/runs/${run.id}/resume`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ userInput: '2024 年' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { run: { status: string } } };
    expect(body.ok).toBe(true);
    expect(body.data.run.status).toBe('running');

    const reloaded = await store.getAgentRun(run.id);
    expect(reloaded?.status).toBe('running');
    expect(reloaded?.pendingUserPrompt).toBeNull();
  });

  it('404: run not found', async () => {
    if (!process.env.DATABASE_URL) return;

    const owner = await ensureUser('resume-404');
    const token = await tokenFor(owner);
    const app = makeApp();

    const res = await app.fetch(
      new Request(`http://test/api/agent/runs/00000000-0000-0000-0000-000000000000/resume`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ userInput: '答案' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('403: non-owner gets forbidden', async () => {
    if (!process.env.DATABASE_URL) return;

    const owner = await ensureUser('resume-priv-owner');
    const stranger = await ensureUser('resume-stranger');
    const run = await mkAwaitingRun(owner.id);
    const token = await tokenFor(stranger);
    const app = makeApp();

    const res = await app.fetch(
      new Request(`http://test/api/agent/runs/${run.id}/resume`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ userInput: '答案' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('409: status is not awaiting_user_input', async () => {
    if (!process.env.DATABASE_URL) return;

    const owner = await ensureUser('resume-409');
    const r = await store.insertAgentRun({
      ownerId: owner.id,
      channel: 'private',
      sessionId: null,
      groupId: null,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status: 'running',
      inputText: 'x',
      budget: DEFAULT_BUDGET,
      apiKeyOwnerId: null,
      apiKeySource: 'server',
    });
    const token = await tokenFor(owner);
    const app = makeApp();

    const res = await app.fetch(
      new Request(`http://test/api/agent/runs/${r.id}/resume`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ userInput: '答案' }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it('400: empty userInput', async () => {
    if (!process.env.DATABASE_URL) return;

    const owner = await ensureUser('resume-400');
    const run = await mkAwaitingRun(owner.id);
    const token = await tokenFor(owner);
    const app = makeApp();

    const res = await app.fetch(
      new Request(`http://test/api/agent/runs/${run.id}/resume`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ userInput: '  ' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('400: missing userInput field', async () => {
    if (!process.env.DATABASE_URL) return;

    const owner = await ensureUser('resume-400b');
    const run = await mkAwaitingRun(owner.id);
    const token = await tokenFor(owner);
    const app = makeApp();

    const res = await app.fetch(
      new Request(`http://test/api/agent/runs/${run.id}/resume`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });
});
