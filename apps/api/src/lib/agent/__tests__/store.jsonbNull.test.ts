/**
 * M6 T3：updateAgentRun 把 JSONB 字段设为 null 时，DB 应是 SQL NULL（不是字符串 "null"）。
 *
 * 历史 bug：M5 review 发现 summary / plan / todos / usage / userApiKeysEnc 几个 JSONB 字段
 * 都用 `JSON.stringify(value)` 写入；当 value === null 时变成字符串 "null"，
 * `WHERE summary IS NULL` 不命中。artifact 已在 M5A 修；本测试守住其余字段。
 */
import { it, expect, beforeAll, beforeEach } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import { getPool } from '../../../db/client.js';
import { runMigrations } from '../../../db/migrate.js';
import * as store from '../store.js';
import { DEFAULT_BUDGET } from '../types.js';
import { ensureUser } from './_groupFixture.js';

async function makeRun(prefix: string) {
  const { id: ownerId } = await ensureUser(prefix);
  return store.insertAgentRun({
    ownerId,
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
}

async function isNullInDb(runId: string, column: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `SELECT ${column} IS NULL AS is_null FROM agent_runs WHERE id = $1`,
    [runId],
  );
  return rows[0]?.is_null === true;
}

describeDb('store JSONB null-clear writes SQL NULL', { timeout: 15000 }, () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('summary: null → SQL NULL', async () => {
    const run = await makeRun('jn-summary');
    await store.updateAgentRun(run.id, {
      summary: { stepCount: 3, toolCount: 1, toolBreakdown: {}, refCount: 0 },
    });
    await store.updateAgentRun(run.id, { summary: null });
    expect(await isNullInDb(run.id, 'summary')).toBe(true);
  });

  it('plan: null → SQL NULL', async () => {
    const run = await makeRun('jn-plan');
    await store.updateAgentRun(run.id, {
      plan: { goal: 'x', steps: [] },
    });
    await store.updateAgentRun(run.id, { plan: null });
    expect(await isNullInDb(run.id, 'plan')).toBe(true);
  });

  it('artifact: null → SQL NULL (regression M5A)', async () => {
    const run = await makeRun('jn-artifact');
    await store.updateAgentRun(run.id, {
      artifact: {
        finalContent: 'x',
        refs: [],
        model: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        producedAt: '2026-05-23T00:00:00Z',
      },
    });
    await store.updateAgentRun(run.id, { artifact: null });
    expect(await isNullInDb(run.id, 'artifact')).toBe(true);
  });

  it('non-null write still works (regression)', async () => {
    const run = await makeRun('jn-roundtrip');
    const summary = { stepCount: 5, toolCount: 2, toolBreakdown: { foo: 2 }, refCount: 1 };
    const updated = await store.updateAgentRun(run.id, { summary });
    expect(updated?.summary).toEqual(summary);
  });
});
