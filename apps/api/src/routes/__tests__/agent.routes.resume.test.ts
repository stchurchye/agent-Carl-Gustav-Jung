/**
 * M3 Task 3：POST /api/agent/runs/:id/resume 路由测试。
 */
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { describeDb } from '../../testUtils/dbGuard.js';
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

describeDb('POST /api/agent/runs/:id/resume', () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('200: awaiting_user_input → running, returns updated run', async () => {

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

type TestUser = Awaited<ReturnType<typeof ensureUser>>;

describeDb('M7 T6d ask_user group resume permission', () => {
  let owner: TestUser;
  let other: TestUser;
  let outsider: TestUser;
  let groupId: string;
  let topicId: string;
  let runId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-resume-o');
    other = await ensureUser('m7-resume-x');
    outsider = await ensureUser('m7-resume-z');
    const g = await ensureGroup(owner.id, 'rt-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
    await getPool().query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING`,
      [groupId, other.id],
    );
    runId = randomUUID();
    await getPool().query(
      `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
         status, input_text, budget, api_key_source,
         pending_user_prompt, pending_user_step_idx, pending_user_input_expires_at,
         ask_user_target_user_id, ask_user_started_at)
       VALUES ($1, $2, 'group', $3, $4, 'generalist',
         'awaiting_user_input', 'q', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
         'server', 'pick A or B', 1, NOW() + INTERVAL '1 hour',
         $2, NOW())`,
      [runId, owner.id, groupId, topicId],
    );
  });

  async function resume(user: TestUser) {
    const app = makeApp();
    const token = await tokenFor(user);
    return app.fetch(
      new Request(`http://x/api/agent/runs/${runId}/resume`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userInput: '我来答' }),
      }),
    );
  }

  it('TB8: non-owner within owner-lock window → 403', async () => {
    const res = await resume(other);
    expect(res.status).toBe(403);
  });

  it('TB9: after openedForAll, group member can answer', async () => {
    await getPool().query(
      `UPDATE agent_runs SET ask_user_opened_for_all_at = NOW() WHERE id = $1`,
      [runId],
    );
    const res = await resume(other);
    expect(res.status).toBe(200);
  });

  it('TB10: non-member always 403 even after openedForAll', async () => {
    await getPool().query(
      `UPDATE agent_runs SET ask_user_opened_for_all_at = NOW() WHERE id = $1`,
      [runId],
    );
    const res = await resume(outsider);
    expect(res.status).toBe(403);
  });

  it('TB10b: non-member set as askUserTargetUserId still 403 (membership 优先)', async () => {
    await getPool().query(
      `UPDATE agent_runs SET ask_user_target_user_id = $2 WHERE id = $1`,
      [runId, outsider.id],
    );
    const res = await resume(outsider);
    expect(res.status).toBe(403);
  });
});
