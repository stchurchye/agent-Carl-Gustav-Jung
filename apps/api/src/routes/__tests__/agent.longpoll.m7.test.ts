/**
 * M7 TB15：long-poll 在 hold 期间订阅 4 个新 hook，命中立即出 batch。
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { getPool } from '../../db/client.js';
import { runMigrations } from '../../db/migrate.js';
import { agentHookBus } from '../../lib/agent/hooks.js';
import { ensureUser, ensureGroup } from '../../lib/agent/__tests__/_groupFixture.js';
import { agentRouter } from '../agent.js';
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

type TestUser = Awaited<ReturnType<typeof ensureUser>>;

describe('long-poll subscribes to M7 status-only events (TB15)', () => {
  let owner: TestUser;
  let groupId: string;
  let topicId: string;
  let runId: string;

  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    owner = await ensureUser('m7-lp');
    const g = await ensureGroup(owner.id, 'lp-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
    runId = randomUUID();
    await getPool().query(
      `INSERT INTO agent_runs (id, owner_id, channel, group_id, topic_id, role,
         status, input_text, budget, api_key_source)
       VALUES ($1, $2, 'group', $3, $4, 'generalist',
         'running', 'main', '{"maxSteps":5,"maxSeconds":60,"maxTokens":1000}'::jsonb,
         'server')`,
      [runId, owner.id, groupId, topicId],
    );
  });

  async function startLongPollAndEmit(emit: () => void) {
    const app = makeApp();
    const token = await tokenFor(owner);
    const fetchPromise = app.fetch(
      new Request(
        `http://x/api/agent/runs/${runId}/long-poll?after=-1&_holdMs=3000`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    setTimeout(emit, 50);
    const res = await fetchPromise;
    return await res.text();
  }

  it('returns batch immediately when run.status_changed fires', async () => {
    const txt = await startLongPollAndEmit(() => {
      agentHookBus.emitEvent({
        type: 'run.status_changed',
        run: { id: runId } as never,
        from: 'running', to: 'replanning',
      });
    });
    expect(txt).toContain('"type":"batch"');
  }, 5000);

  it('returns batch immediately when run.dequeued fires', async () => {
    const txt = await startLongPollAndEmit(() => {
      agentHookBus.emitEvent({ type: 'run.dequeued', run: { id: runId } as never });
    });
    expect(txt).toContain('"type":"batch"');
  }, 5000);

  it('returns batch immediately when ask_user.opened_for_all fires', async () => {
    const txt = await startLongPollAndEmit(() => {
      agentHookBus.emitEvent({
        type: 'ask_user.opened_for_all',
        runId,
        run: { id: runId } as never,
      });
    });
    expect(txt).toContain('"type":"batch"');
  }, 5000);

  it('returns batch immediately when run.merged_input_appended fires', async () => {
    const txt = await startLongPollAndEmit(() => {
      agentHookBus.emitEvent({
        type: 'run.merged_input_appended',
        runId,
        mergedInputsCount: 2,
      });
    });
    expect(txt).toContain('"type":"batch"');
  }, 5000);
});
