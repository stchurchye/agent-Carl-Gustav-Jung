import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { runMigrations } from '../../db/migrate.js';
import { getPool } from '../../db/client.js';
import * as store from '../../lib/agent/store.js';
import { agentRouter, canAccessRun } from '../agent.js';
import {
  ensureUser,
  ensureGroup,
  addMember,
} from '../../lib/agent/__tests__/_groupFixture.js';
import { DEFAULT_BUDGET } from '../../lib/agent/types.js';
import { signAccessToken } from '../../lib/auth.js';
import type { AppVariables } from '../../types.js';

/**
 * T12: agent run 鉴权（路由层暴露的 canAccessRun helper）。
 * - 私聊：仅 owner true，其他 false
 * - 群聊：owner true、群成员 true、外人 false
 */
describe('canAccessRun (T12 routes auth)', () => {
  beforeAll(async () => await runMigrations());
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('private run: owner=true, stranger=false', async () => {
    const owner = await ensureUser('pv-owner');
    const stranger = await ensureUser('pv-stranger');
    const run = await store.insertAgentRun({
      ownerId: owner.id,
      channel: 'private',
      sessionId: null,
      groupId: null,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status: 'draft',
      inputText: 'x',
      budget: DEFAULT_BUDGET,
      apiKeyOwnerId: null,
      apiKeySource: 'server',
    });
    expect(await canAccessRun(run, owner.id)).toBe(true);
    expect(await canAccessRun(run, stranger.id)).toBe(false);
  });

  it('group run: owner=true, member=true, non-member=false', async () => {
    const owner = await ensureUser('gp-owner');
    const member = await ensureUser('gp-member');
    const stranger = await ensureUser('gp-stranger');
    const { groupId, topicId } = await ensureGroup(owner.id);
    await addMember(groupId, member.id, 'member');

    const run = await store.insertAgentRun({
      ownerId: owner.id,
      channel: 'group',
      sessionId: null,
      groupId,
      topicId,
      intentTurnId: null,
      role: 'generalist',
      status: 'draft',
      inputText: 'x',
      budget: DEFAULT_BUDGET,
      apiKeyOwnerId: null,
      apiKeySource: 'server',
    });

    expect(await canAccessRun(run, owner.id)).toBe(true);
    expect(await canAccessRun(run, member.id)).toBe(true);
    expect(await canAccessRun(run, stranger.id)).toBe(false);
  });
});

/**
 * M1b-2: approve/deny/steer 路由的群成员鉴权 + happy path。
 */
describe('approve/deny/steer routes (M1b-2)', () => {
  beforeAll(async () => await runMigrations());
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

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

  async function mkAwaitingGroupRun(ownerId: string, groupId: string, topicId: string) {
    const r = await store.insertAgentRun({
      ownerId,
      channel: 'group',
      sessionId: null,
      groupId,
      topicId,
      intentTurnId: null,
      role: 'generalist',
      status: 'running',
      inputText: 'x',
      budget: DEFAULT_BUDGET,
      apiKeySource: 'server',
      apiKeyOwnerId: null,
    });
    await store.updateAgentRun(r.id, {
      status: 'awaiting_approval',
      pendingApprovalToolName: 'risky_echo',
      awaitingApprovalUntil: new Date(Date.now() + 60_000),
    });
    return r.id;
  }

  it('group member (not owner) can approve owner-initiated awaiting run', async () => {
    const owner = await ensureUser('ap-o');
    const member = await ensureUser('ap-m');
    const { groupId, topicId } = await ensureGroup(owner.id);
    await addMember(groupId, member.id);
    const id = await mkAwaitingGroupRun(owner.id, groupId, topicId);

    const token = await tokenFor(member);
    const app = makeApp();
    const res = await app.fetch(
      new Request(`http://test/api/agent/runs/${id}/approve`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    expect((await store.getAgentRun(id))?.status).toBe('running');
  });

  it('non-member gets 403 on approve', async () => {
    const owner = await ensureUser('np-o');
    const stranger = await ensureUser('np-s');
    const { groupId, topicId } = await ensureGroup(owner.id);
    const id = await mkAwaitingGroupRun(owner.id, groupId, topicId);

    const token = await tokenFor(stranger);
    const app = makeApp();
    const res = await app.fetch(
      new Request(`http://test/api/agent/runs/${id}/approve`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('deny route returns 200 and run goes to replanning', async () => {
    const owner = await ensureUser('dn-o');
    const { groupId, topicId } = await ensureGroup(owner.id);
    const id = await mkAwaitingGroupRun(owner.id, groupId, topicId);
    const token = await tokenFor(owner);
    const app = makeApp();
    const res = await app.fetch(
      new Request(`http://test/api/agent/runs/${id}/deny`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: 'nope' }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await store.getAgentRun(id))?.status).toBe('replanning');
  });

  it('steer requires non-empty instruction (400)', async () => {
    const owner = await ensureUser('st-bad');
    const { groupId } = await ensureGroup(owner.id);
    const r = await store.insertAgentRun({
      ownerId: owner.id,
      channel: 'group',
      sessionId: null,
      groupId,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status: 'running',
      inputText: 'x',
      budget: DEFAULT_BUDGET,
      apiKeySource: 'server',
      apiKeyOwnerId: null,
    });
    const token = await tokenFor(owner);
    const app = makeApp();
    const res = await app.fetch(
      new Request(`http://test/api/agent/runs/${r.id}/steer`, {
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

/**
 * M1d Task 3: retry route — terminal 状态可重跑、非 terminal 409、owner/member 鉴权。
 */
describe('POST /api/agent/runs/:id/retry (M1d)', () => {
  beforeAll(async () => await runMigrations());
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

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

  async function mkTerminalPrivateRun(ownerId: string, status: 'completed' | 'failed' | 'cancelled' | 'budget_exhausted') {
    const sess = await (await import('../../store/pg.js')).createChatSession(ownerId, 't');
    const r = await store.insertAgentRun({
      ownerId,
      channel: 'private',
      sessionId: sess.id,
      groupId: null,
      topicId: null,
      intentTurnId: null,
      role: 'generalist',
      status,
      inputText: '原始输入，retry 应该复用',
      budget: { maxSteps: 7, maxSeconds: 88, maxTokens: 999 },
      apiKeyOwnerId: null,
      apiKeySource: 'server',
    });
    return r.id;
  }

  it('terminal run: retry 创建新 run、复用 inputText/budget、返回新 runId', async () => {
    const owner = await ensureUser('rt-ok');
    const oldId = await mkTerminalPrivateRun(owner.id, 'failed');

    const token = await tokenFor(owner);
    const app = makeApp();
    const res = await app.fetch(
      new Request(`http://test/api/agent/runs/${oldId}/retry`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { runId: string } };
    expect(body.data.runId).toBeTruthy();
    expect(body.data.runId).not.toBe(oldId);

    const newRun = await store.getAgentRun(body.data.runId);
    expect(newRun?.inputText).toBe('原始输入，retry 应该复用');
    expect(newRun?.budget.maxSteps).toBe(7);
    expect(newRun?.status).toBe('draft');
  });

  it('non-terminal run: 409', async () => {
    const owner = await ensureUser('rt-running');
    const sess = await (await import('../../store/pg.js')).createChatSession(owner.id, 't');
    const r = await store.insertAgentRun({
      ownerId: owner.id,
      channel: 'private',
      sessionId: sess.id,
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
      new Request(`http://test/api/agent/runs/${r.id}/retry`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(409);
  });

  it('stranger gets 403', async () => {
    const owner = await ensureUser('rt-owner');
    const stranger = await ensureUser('rt-stranger');
    const oldId = await mkTerminalPrivateRun(owner.id, 'cancelled');

    const token = await tokenFor(stranger);
    const app = makeApp();
    const res = await app.fetch(
      new Request(`http://test/api/agent/runs/${oldId}/retry`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
  });
});

/**
 * M1d Task 4: GET /api/agent/runs 列表 — owner runs + 群成员 runs，
 * 不返回外人 / 其它 group 的 run；支持 status / limit 过滤。
 */
describe('GET /api/agent/runs (M1d task panel)', () => {
  beforeAll(async () => await runMigrations());
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

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

  it('returns owner runs + group runs where caller is a member; excludes stranger groups', async () => {
    const me = await ensureUser('list-me');
    const friend = await ensureUser('list-friend');
    const stranger = await ensureUser('list-stranger');
    const { groupId: myGroupId } = await ensureGroup(friend.id);
    await addMember(myGroupId, me.id);
    const { groupId: otherGroupId } = await ensureGroup(stranger.id);

    // 我自己的私聊 run（应被列出）
    const myRun = await store.insertAgentRun({
      ownerId: me.id, channel: 'private', sessionId: null, groupId: null,
      topicId: null, intentTurnId: null, role: 'generalist', status: 'completed',
      inputText: 'mine', budget: DEFAULT_BUDGET, apiKeyOwnerId: null, apiKeySource: 'server',
    });
    // friend 在我加入的群里发起的 run（我作为成员应能看到）
    const groupRun = await store.insertAgentRun({
      ownerId: friend.id, channel: 'group', sessionId: null, groupId: myGroupId,
      topicId: null, intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'group', budget: DEFAULT_BUDGET, apiKeyOwnerId: null, apiKeySource: 'server',
    });
    // stranger 在自己群里发起的 run（我不该看到）
    await store.insertAgentRun({
      ownerId: stranger.id, channel: 'group', sessionId: null, groupId: otherGroupId,
      topicId: null, intentTurnId: null, role: 'generalist', status: 'running',
      inputText: 'other', budget: DEFAULT_BUDGET, apiKeyOwnerId: null, apiKeySource: 'server',
    });

    const token = await tokenFor(me);
    const res = await makeApp().fetch(
      new Request('http://test/api/agent/runs', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { runs: { id: string }[] } };
    const ids = body.data.runs.map((r) => r.id);
    expect(ids).toContain(myRun.id);
    expect(ids).toContain(groupRun.id);
    expect(ids.length).toBe(2);
  });

  it('status filter narrows results', async () => {
    const me = await ensureUser('list-st');
    await store.insertAgentRun({
      ownerId: me.id, channel: 'private', sessionId: null, groupId: null,
      topicId: null, intentTurnId: null, role: 'generalist', status: 'completed',
      inputText: 'c', budget: DEFAULT_BUDGET, apiKeyOwnerId: null, apiKeySource: 'server',
    });
    await store.insertAgentRun({
      ownerId: me.id, channel: 'private', sessionId: null, groupId: null,
      topicId: null, intentTurnId: null, role: 'generalist', status: 'failed',
      inputText: 'f', budget: DEFAULT_BUDGET, apiKeyOwnerId: null, apiKeySource: 'server',
    });

    const token = await tokenFor(me);
    const res = await makeApp().fetch(
      new Request('http://test/api/agent/runs?status=failed', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const body = (await res.json()) as { data: { runs: { status: string }[] } };
    expect(body.data.runs.length).toBe(1);
    expect(body.data.runs[0].status).toBe('failed');
  });
});
