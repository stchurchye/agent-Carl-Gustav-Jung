import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { agentRouter } from '../../../routes/agent.js';
import { signAccessToken } from '../../auth.js';
import type { AppVariables } from '../../../types.js';
import { randomUUID } from 'crypto';
import { ensureUser, ensureGroup } from './_groupFixture.js';

/**
 * 端到端路由测试：/api/agent/skills CRUD。
 * 用 hono.fetch 模拟真实 HTTP 调用。
 */
describe('agent /skills routes', () => {
  beforeAll(async () => await runMigrations());
  beforeEach(async () => {
    await getPool().query('DELETE FROM topic_skills');
  });

  async function makeApp() {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('requestId', randomUUID());
      await next();
    });
    app.route('/api/agent', agentRouter);
    return app;
  }

  async function tokenFor(userId: string, username: string, displayName: string) {
    const { accessToken } = await signAccessToken({
      id: userId,
      username,
      displayName,
      createdAt: new Date().toISOString(),
    });
    return accessToken;
  }

  it('POST user-scope skill then GET lists it', async () => {
    const u = await ensureUser('rt1');
    const token = await tokenFor(u.id, u.username, u.displayName);
    const app = await makeApp();

    const postRes = await app.fetch(
      new Request('http://test/api/agent/skills', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          scope: 'user',
          title: '我喜欢简洁',
          content: '少废话',
        }),
      }),
    );
    expect(postRes.status).toBe(200);
    const postJson = (await postRes.json()) as {
      ok: boolean;
      data: { skill: { id: string; title: string } };
    };
    expect(postJson.ok).toBe(true);
    expect(postJson.data.skill.title).toBe('我喜欢简洁');

    const getRes = await app.fetch(
      new Request('http://test/api/agent/skills', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const getJson = (await getRes.json()) as {
      data: { skills: { id: string }[] };
    };
    expect(getJson.data.skills.length).toBe(1);
    expect(getJson.data.skills[0].id).toBe(postJson.data.skill.id);
  });

  it('PATCH updates a skill, DELETE removes it', async () => {
    const u = await ensureUser('rt2');
    const token = await tokenFor(u.id, u.username, u.displayName);
    const app = await makeApp();

    const postRes = await app.fetch(
      new Request('http://test/api/agent/skills', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ scope: 'user', title: 'a', content: 'b' }),
      }),
    );
    const skillId = (await postRes.json()).data.skill.id as string;

    const patchRes = await app.fetch(
      new Request(`http://test/api/agent/skills/${skillId}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: 'a2', enabled: false }),
      }),
    );
    expect(patchRes.status).toBe(200);
    const patchJson = (await patchRes.json()) as {
      data: { skill: { title: string; enabled: boolean } };
    };
    expect(patchJson.data.skill.title).toBe('a2');
    expect(patchJson.data.skill.enabled).toBe(false);

    const delRes = await app.fetch(
      new Request(`http://test/api/agent/skills/${skillId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(delRes.status).toBe(200);

    const getRes = await app.fetch(
      new Request('http://test/api/agent/skills', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect((await getRes.json()).data.skills.length).toBe(0);
  });

  it('non-member cannot POST group-scope skill', async () => {
    const owner = await ensureUser('rt3-owner');
    const stranger = await ensureUser('rt3-stranger');
    const { groupId } = await ensureGroup(owner.id);
    const strangerToken = await tokenFor(
      stranger.id,
      stranger.username,
      stranger.displayName,
    );
    const app = await makeApp();

    const res = await app.fetch(
      new Request('http://test/api/agent/skills', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${strangerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          scope: 'group',
          groupId,
          title: 'hack',
          content: 'evil',
        }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('POST without scope returns 400', async () => {
    const u = await ensureUser('rt4');
    const token = await tokenFor(u.id, u.username, u.displayName);
    const app = await makeApp();
    const res = await app.fetch(
      new Request('http://test/api/agent/skills', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: 'x', content: 'y' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects requests without Bearer token', async () => {
    const app = await makeApp();
    const res = await app.fetch(
      new Request('http://test/api/agent/skills', { method: 'GET' }),
    );
    expect(res.status).toBe(401);
  });
});
