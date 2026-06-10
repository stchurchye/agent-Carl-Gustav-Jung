import { beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'crypto';

import { describeDb } from '../../../testUtils/dbGuard.js';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun } from '../runtime.js';
import { getAgentRun } from '../store.js';
import { runChildSubagent } from '../spawnSubagent.js';

/**
 * P0-S8:spawn 咽喉递归深度守卫。此前防递归只靠 ① 工具 handler 的 parentRunId 检查
 * ② 角色白名单不含 spawn 类 —— runChildSubagent 自身无守卫(注释写"caller 负责")。
 * 本切片在咽喉处加纵深:parentRun 已是子 run → 直接 fail,不建孙 run。
 */

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

describeDb('P0-S8:runChildSubagent 递归深度守卫', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('parentRun 已是子 run(parentRunId 非空)→ 直接 fail,DB 无孙 run 行', async () => {
    const user = await ensureUser('depth');
    const sess = await createChatSession(user.id, 'depth');
    const { run: top } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'top',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    const { run: child } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'child task',
      apiKey: 'fake',
      apiKeySource: 'server',
    });
    // updateAgentRun 不支持 parentRunId(仅插入时设),直写 SQL 构造"已是子 run"的事实
    await getPool().query('UPDATE agent_runs SET parent_run_id = $1 WHERE id = $2', [
      top.id,
      child.id,
    ]);
    const childRun = (await getAgentRun(child.id))!;
    expect(childRun.parentRunId).toBe(top.id); // 前置:确实是子 run
    const before = await getPool().query('SELECT count(*)::int AS n FROM agent_runs');

    const res = await runChildSubagent({
      parentRun: childRun,
      task: 'grandchild attempt',
      role: 'researcher',
      maxSteps: 2,
      signal: new AbortController().signal,
    });

    expect(res.ok).toBe(false);
    expect(res.error ?? '').toMatch(/depth|nested|递归/i);
    const after = await getPool().query('SELECT count(*)::int AS n FROM agent_runs');
    expect(after.rows[0].n).toBe(before.rows[0].n); // 没建孙 run
  });
});
