import { beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'crypto';

import { describeDb } from '../../../testUtils/dbGuard.js';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun, executeRun } from '../runtime.js';
import { getAgentRun, insertStep, listSteps, maxStepIdx, updateAgentRun } from '../store.js';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import type { Plan } from '../types.js';

/**
 * R2-3 端到端:连续低信号搜索(quality=empty/low_relevance)→ critique 触发
 * replanning 改写查询;每 run 只触发一次(防 refine↔垃圾结果死循环)。
 */

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

const emptySearch: ToolDef<{ q: string }, { ok: boolean; quality: string; results: unknown[]; note: string }> = {
  name: 'stub_empty_search',
  description: 'always-empty search stub',
  inputSchema: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } },
  approvalMode: 'auto',
  costHint: 'low',
  hasSideEffects: false,
  idempotent: true,
  replyMeta: { summaryKind: 'list' },
  async handler() {
    return { ok: true, quality: 'empty', results: [], note: '0 结果:换关键词' };
  },
};

function emptyPlan(): Plan {
  return {
    intentSummary: '搜资料',
    steps: [1, 2, 3].map((i) => ({
      toolName: 'stub_empty_search',
      input: { q: `q${i}` },
      reason: 'r',
      todoId: `t${i}`,
    })),
    todos: [1, 2, 3].map((i) => ({ id: `t${i}`, text: `搜 ${i}`, status: 'pending' as const, stepRefs: [] })),
    finalReplyHint: '',
    reasoning: null,
    version: 1,
  };
}

async function mkRun() {
  const user = await ensureUser('refine');
  const sess = await createChatSession(user.id, 'refine');
  const { run } = await createAgentRun({
    ownerId: user.id,
    channel: 'private',
    sessionId: sess.id,
    inputText: '查资料',
    apiKey: 'fake',
    apiKeySource: 'server',
  });
  const plan = emptyPlan();
  await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });
  return run;
}

describeDb('R2-3:低信号搜索 refine 门(端到端)', () => {
  beforeAll(async () => {
    await runMigrations();
    if (!toolRegistry.get(emptySearch.name)) toolRegistry.register(emptySearch as ToolDef);
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('连续 2 步 empty 搜索 → critique(改写查询)+ status=replanning', async () => {
    const run = await mkRun();

    await executeRun(run.id);

    const after = (await getAgentRun(run.id))!;
    expect(after.status).toBe('replanning');
    const critique = (await listSteps(run.id)).find(
      (s) => s.kind === 'critique' && JSON.stringify(s.output).includes('改写查询'),
    );
    expect(critique).toBeDefined();
  });

  it('已 refine 过一次(历史有改写查询 critique)→ 不再触发,跑完收尾', async () => {
    const run = await mkRun();
    const idx = (await maxStepIdx(run.id)) + 1;
    await insertStep({
      runId: run.id,
      idx,
      kind: 'critique',
      output: { shouldReplan: true, reason: '连续搜索无有效结果…需改写查询(历史)' },
    });

    await executeRun(run.id);

    const after = (await getAgentRun(run.id))!;
    expect(after.status).not.toBe('replanning'); // 不再二次 refine,走正常收尾路径
    const refineCritiques = (await listSteps(run.id)).filter(
      (s) => s.kind === 'critique' && JSON.stringify(s.output).includes('改写查询'),
    );
    expect(refineCritiques.length).toBe(1); // 只有预置那条
  });
});
