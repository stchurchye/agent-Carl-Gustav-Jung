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

  it('M1e blocker 1: retry copies sealed user_api_key_enc from old run', async () => {
    const owner = await ensureUser('rt-sealed');
    const sess = await (await import('../../store/pg.js')).createChatSession(owner.id, 's');
    const oldRun = await store.insertAgentRun({
      ownerId: owner.id, channel: 'private', sessionId: sess.id, groupId: null,
      topicId: null, intentTurnId: null, role: 'generalist', status: 'failed',
      inputText: 'sealed retry', budget: DEFAULT_BUDGET,
      apiKeyOwnerId: owner.id, apiKeySource: 'user',
      userApiKeyEnc: 'fake-sealed-blob-from-m1d',
    });
    expect(await store.getUserApiKeyEnc(oldRun.id)).toBe('fake-sealed-blob-from-m1d');

    const token = await tokenFor(owner);
    const res = await makeApp().fetch(
      new Request(`http://test/api/agent/runs/${oldRun.id}/retry`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { runId: string } };
    const newSealed = await store.getUserApiKeyEnc(body.data.runId);
    expect(newSealed).toBe('fake-sealed-blob-from-m1d');
  });

  it('M1e blocker 2: two retries within 10s → 409 AGENT_RETRY_DEDUPED with existingRunId', async () => {
    const owner = await ensureUser('rt-dedup');
    const oldId = await mkTerminalPrivateRun(owner.id, 'failed');
    const token = await tokenFor(owner);
    const app = makeApp();

    // 第一次成功
    const res1 = await app.fetch(
      new Request(`http://test/api/agent/runs/${oldId}/retry`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { data: { runId: string } };
    const firstNewId = body1.data.runId;

    // 立即第二次：应 409 + existingRunId 等于上一次的新 run
    const res2 = await app.fetch(
      new Request(`http://test/api/agent/runs/${oldId}/retry`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res2.status).toBe(409);
    const body2 = (await res2.json()) as { error: { code: string; existingRunId?: string } };
    expect(body2.error.code).toBe('AGENT_RETRY_DEDUPED');
    expect(body2.error.existingRunId).toBe(firstNewId);
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

  it('M1e task 2: GET /runs/:id includes notices field and SSE emits notice events with n: id', async () => {
    const me = await ensureUser('notice-route');
    const sess = await (await import('../../store/pg.js')).createChatSession(me.id, 'notice');
    const r = await store.insertAgentRun({
      ownerId: me.id, channel: 'private', sessionId: sess.id, groupId: null,
      topicId: null, intentTurnId: null, role: 'generalist', status: 'completed',
      inputText: 'notice run', budget: DEFAULT_BUDGET, apiKeyOwnerId: null, apiKeySource: 'server',
    });
    // 写 1 个 step + 2 条 notice
    await store.insertStep({
      runId: r.id, idx: 0, kind: 'tool_call', toolName: 'fake', input: {}, output: {},
    });
    const { emitNotice } = await import('../../lib/agent/notices.js');
    await emitNotice({ runId: r.id, severity: 'warn', code: 'USER_KEY_DECRYPT_FAILED', message: 'key 解密失败' });
    await new Promise((r) => setTimeout(r, 5));
    await emitNotice({ runId: r.id, severity: 'error', code: 'NO_API_KEY', message: '没可用 key' });

    const token = await tokenFor(me);
    // GET /runs/:id 响应里应带 notices
    const detail = await makeApp().fetch(
      new Request(`http://test/api/agent/runs/${r.id}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      data: { run: { id: string }; steps: unknown[]; notices: Array<{ code: string; severity: string }> };
    };
    expect(detailBody.data.notices).toHaveLength(2);
    expect(detailBody.data.notices[0].code).toBe('NO_API_KEY'); // desc 顺序

    // SSE 应该 emit 2 个 notice 事件 + 1 个 step 事件 + 1 个 end
    const sse = await makeApp().fetch(
      new Request(`http://test/api/agent/runs/${r.id}/stream`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(sse.status).toBe(200);
    const text = await readSseUntilEnd(sse);
    // step 事件用 s: 前缀
    expect(text).toMatch(/event: step[\s\S]*id: s:0/);
    // notice 事件用 n: 前缀（uuid id 不可枚举，用 regex 匹配存在）
    expect(text).toMatch(/event: notice[\s\S]*id: n:[a-f0-9-]+/);
    // 两条 notice 都应在流里出现
    expect(text).toContain('USER_KEY_DECRYPT_FAILED');
    expect(text).toContain('NO_API_KEY');
  });

  it('SSE stream resumes from Last-Event-ID, skipping prior steps', async () => {
    const me = await ensureUser('sse-resume');
    const sess = await (await import('../../store/pg.js')).createChatSession(me.id, 'sse');
    const r = await store.insertAgentRun({
      ownerId: me.id, channel: 'private', sessionId: sess.id, groupId: null,
      topicId: null, intentTurnId: null, role: 'generalist', status: 'completed',
      inputText: 'sse', budget: DEFAULT_BUDGET, apiKeyOwnerId: null, apiKeySource: 'server',
    });
    // 注入 3 条 step：idx 0/1/2
    for (let i = 0; i < 3; i++) {
      await store.insertStep({
        runId: r.id,
        idx: i,
        kind: 'tool_call',
        toolName: 'fake',
        input: { i },
        output: { i },
      });
    }

    const token = await tokenFor(me);
    const res = await makeApp().fetch(
      new Request(`http://test/api/agent/runs/${r.id}/stream`, {
        headers: {
          authorization: `Bearer ${token}`,
          'last-event-id': '0', // 断点：客户端只见过 idx 0，要从 idx 1 开始
        },
      }),
    );
    expect(res.status).toBe(200);

    const text = await readSseUntilEnd(res);
    // 应包含 idx 1 / 2，不包含 idx 0
    expect(text).toMatch(/"idx":1/);
    expect(text).toMatch(/"idx":2/);
    expect(text).not.toMatch(/"idx":0/);
    // M1e task 2：SSE id 字段加了命名空间前缀 `s:`（向后兼容裸数字 last-event-id='0'）
    expect(text).toMatch(/id: s:1/);
    expect(text).toMatch(/id: s:2/);
  });

  async function readSseUntilEnd(res: Response): Promise<string> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let acc = '';
    const stopAt = Date.now() + 4000;
    while (Date.now() < stopAt) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) acc += decoder.decode(value);
      if (acc.includes('event: end')) break;
    }
    try { reader.cancel(); } catch {}
    return acc;
  }

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
