/**
 * M6 T1a：long-poll 路由测试。
 *
 * 测试约定（对齐 agent.routes.test.ts）：
 *  - 用 makeApp() 拼装 Hono router（不引整个 app.ts）
 *  - 用 tokenFor() 签 JWT，加 Authorization: Bearer header
 *  - 路由从 /api/agent/* 开始
 *
 * 覆盖：
 *   1. after=N 已有新 step → 立即 batch 返回（不 hold）
 *   2. run 已 terminal → 立即 batch 返回（hasMore=false）
 *   3. hold 期间 recordStep → 立即 batch 返回（recordStep 自己会 emit hook）
 *   4. 无新 step → hold；用 ?_holdMs=500 加快测试 → idle 返回
 *   5. jitter 数值落 [20000, 30000] 且有方差
 *   6. 403 / 404 权限
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { getPool } from '../../db/client.js';
import { runMigrations } from '../../db/migrate.js';
import * as store from '../../lib/agent/store.js';
import { recordStep } from '../../lib/agent/stepRecorder.js';
import { agentRouter } from '../agent.js';
import { signAccessToken } from '../../lib/auth.js';
import { DEFAULT_BUDGET } from '../../lib/agent/types.js';
import { ensureUser } from '../../lib/agent/__tests__/_groupFixture.js';
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

async function makeRun(prefix: string) {
  const owner = await ensureUser(prefix);
  const run = await store.insertAgentRun({
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
    apiKeySource: 'server',
    apiKeyOwnerId: null,
  });
  return { owner, run };
}

async function readNdjson(resp: Response): Promise<unknown[]> {
  const text = await resp.text();
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe('GET /api/agent/runs/:id/long-poll', { timeout: 40000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('after=-1 when steps exist → immediate batch, no hold', async () => {
    const { owner, run } = await makeRun('lp-immediate');
    await recordStep({ runId: run.id, kind: 'plan', output: { goal: 'x' } });
    const token = await tokenFor(owner);
    const app = makeApp();
    const t0 = Date.now();
    const resp = await app.fetch(
      new Request(`http://test/api/agent/runs/${run.id}/long-poll?after=-1`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const elapsed = Date.now() - t0;
    expect(resp.status).toBe(200);
    expect(elapsed).toBeLessThan(1000);
    const lines = (await readNdjson(resp)) as Array<{ type: string; [k: string]: any }>;
    const batch = lines.find((l) => l.type === 'batch');
    expect(batch).toBeDefined();
    expect(batch!.steps.length).toBe(1);
    expect(batch!.steps[0].kind).toBe('plan');
  });

  it('terminal run → immediate batch with hasMore=false', async () => {
    const { owner, run } = await makeRun('lp-terminal');
    await store.updateAgentRun(run.id, { status: 'completed' });
    const token = await tokenFor(owner);
    const app = makeApp();
    const resp = await app.fetch(
      new Request(`http://test/api/agent/runs/${run.id}/long-poll?after=-1`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(resp.status).toBe(200);
    const lines = (await readNdjson(resp)) as Array<{ type: string; [k: string]: any }>;
    const batch = lines.find((l) => l.type === 'batch');
    expect(batch!.run.status).toBe('completed');
    expect(batch!.hasMore).toBe(false);
  });

  it('hold mode: step emitted mid-hold → batch returned immediately', async () => {
    const { owner, run } = await makeRun('lp-hold');
    const token = await tokenFor(owner);
    const app = makeApp();
    const promise = app.fetch(
      new Request(`http://test/api/agent/runs/${run.id}/long-poll?after=-1`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    // 给路由 100ms 建立 hold + subscribe
    await new Promise((r) => setTimeout(r, 100));
    // recordStep 自身会 emit step.recorded hook 事件 → long-poll handler settle 返回
    await recordStep({ runId: run.id, kind: 'plan', output: { goal: 'mid' } });
    const resp = await promise;
    expect(resp.status).toBe(200);
    const lines = (await readNdjson(resp)) as Array<{ type: string; [k: string]: any }>;
    const batch = lines.find((l) => l.type === 'batch');
    expect(batch!.steps.length).toBe(1);
    expect(batch!.steps[0].output).toEqual({ goal: 'mid' });
  });

  it('no new step → hold ~500ms (override) → emits idle', async () => {
    const { owner, run } = await makeRun('lp-idle');
    const token = await tokenFor(owner);
    const app = makeApp();
    const t0 = Date.now();
    const resp = await app.fetch(
      new Request(
        `http://test/api/agent/runs/${run.id}/long-poll?after=-1&_holdMs=500`,
        { headers: { authorization: `Bearer ${token}` } },
      ),
    );
    const elapsed = Date.now() - t0;
    expect(resp.status).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(2500);
    const lines = (await readNdjson(resp)) as Array<{ type: string; [k: string]: any }>;
    const idle = lines.find((l) => l.type === 'idle');
    expect(idle).toBeDefined();
    expect(idle!.lastIdx).toBe(-1);
  });

  it('jitter samples fall in [20000, 30000] with variance', async () => {
    const { computeHoldMs } = await import('../../lib/agent/longPollJitter.js');
    const samples = Array.from({ length: 100 }, () => computeHoldMs());
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(min).toBeGreaterThanOrEqual(20000);
    expect(max).toBeLessThanOrEqual(30000);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance =
      samples.reduce((s, x) => s + (x - mean) ** 2, 0) / samples.length;
    expect(variance).toBeGreaterThan(100000); // ~10s window 的方差应远 > 0
  });

  it('non-owner → 403', async () => {
    const { run } = await makeRun('lp-owner');
    const other = await ensureUser('lp-other');
    const token = await tokenFor(other);
    const app = makeApp();
    const resp = await app.fetch(
      new Request(`http://test/api/agent/runs/${run.id}/long-poll?after=-1`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(resp.status).toBe(403);
  });

  it('unknown run → 404', async () => {
    const u = await ensureUser('lp-404');
    const token = await tokenFor(u);
    const app = makeApp();
    const resp = await app.fetch(
      new Request(
        `http://test/api/agent/runs/00000000-0000-0000-0000-000000000000/long-poll`,
        { headers: { authorization: `Bearer ${token}` } },
      ),
    );
    expect(resp.status).toBe(404);
  });
});
