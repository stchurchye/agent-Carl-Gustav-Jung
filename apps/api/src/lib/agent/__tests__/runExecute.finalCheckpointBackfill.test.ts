import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';

import { describeDb } from '../../../testUtils/dbGuard.js';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createChatSession } from '../../../store/pg.js';
import { ensureUser } from './_groupFixture.js';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import type { AgentCheckpoint, Plan } from '../types.js';

/**
 * 收尾兜底(2026-06-10 code-review,预存在):收尾点 computeCheckpoint→updateAgentRun
 * 抛错(网络超时/DB 抖动)时,外层 catch 只 softComplete 不补 checkpoint →
 * contextCheckpoint 停留在续跑时刻旧值,末轮(往往是决定性的)发现丢失。
 *
 * 注入方式:收尾点写 checkpoint 的 patch 形态是「仅 contextCheckpoint 一个 key」
 * (续跑点是 {status, contextCheckpoint} 两 key)。用 hoisted 开关让这种写入抛错 N 次,
 * 模拟收尾点 DB 抖动;其余 updateAgentRun 调用透传真实现。
 */
const ctl = vi.hoisted(() => ({ failCheckpointOnlyWrites: 0 }));
vi.mock('../store.js', async (importActual) => {
  const actual = await importActual<typeof import('../store.js')>();
  return {
    ...actual,
    updateAgentRun: vi.fn(
      async (...args: Parameters<typeof actual.updateAgentRun>) => {
        const [, patch] = args;
        const keys = Object.keys(patch);
        if (
          ctl.failCheckpointOnlyWrites > 0 &&
          keys.length === 1 &&
          keys[0] === 'contextCheckpoint'
        ) {
          ctl.failCheckpointOnlyWrites -= 1;
          throw new Error('simulated db timeout (checkpoint write)');
        }
        return actual.updateAgentRun(...args);
      },
    ),
  };
});

import * as store from '../store.js';
import { createAgentRun } from '../runtime.js';
import { executeRun } from '../runExecute.js';

/** 模拟「续跑时刻的旧 checkpoint」:本轮 steps 尚未折叠(producedAtIdx=-1)。 */
function priorCheckpoint(): AgentCheckpoint {
  return {
    version: 1,
    goal: '研究荣格红书',
    intent: '续跑前的意图',
    completed: [
      { text: 'round1_tool', finding: '早期发现:红书成书于1913-1930', refs: [] },
    ],
    remainingPlan: ['完成末轮'],
    openQuestions: [],
    nextStep: '完成末轮',
    successCount: 1,
    producedAtIdx: -1,
    digestTail: '',
    completedTodos: ['第一轮已完成项'],
  };
}

/** 一步成功探针 plan 的 run:执行后直达收尾段(无续跑)。 */
async function mkRunAtFinalRound(probeName: string) {
  toolRegistry.register({
    name: probeName,
    description: 'success probe',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
    },
    approvalMode: 'auto',
    hasSideEffects: false,
    idempotent: false,
    async handler() {
      return { ok: true, value: '末轮关键发现' };
    },
  } as unknown as ToolDef);

  const u = await ensureUser('cpfin');
  const sess = await createChatSession(u.id, 'cpfin');
  const { run } = await createAgentRun({
    ownerId: u.id,
    channel: 'private',
    sessionId: sess.id,
    inputText: '研究荣格红书',
    apiKey: 'fake',
    apiKeySource: 'server',
  });
  const plan: Plan = {
    intentSummary: '一步成功收尾',
    steps: [{ toolName: probeName, input: { q: 'a' }, reason: 'r', todoId: 't1' }],
    todos: [{ id: 't1', text: '末轮步骤', status: 'pending', stepRefs: [] }],
    finalReplyHint: '',
    reasoning: null,
    version: 1,
  };
  await store.updateAgentRun(run.id, {
    plan,
    todos: plan.todos,
    status: 'running',
    contextCheckpoint: priorCheckpoint(),
  });
  return run;
}

describeDb('收尾点 checkpoint 写入抛错 → catch 兜底补写(fail-open)', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    ctl.failCheckpointOnlyWrites = 0;
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('收尾点写入抛错一次 → catch 补写机械版:末轮发现进 checkpoint 且旧发现不回退', async () => {
    const probeName = 'final_ok_' + randomUUID().slice(0, 8);
    const run = await mkRunAtFinalRound(probeName);
    ctl.failCheckpointOnlyWrites = 1; // 只打掉收尾点那一笔写

    await executeRun(run.id);

    const after = (await store.getAgentRun(run.id))!;
    const cp = after.contextCheckpoint;
    expect(cp).not.toBeNull();
    // 末轮发现(成功探针步)已补进 checkpoint —— 旧行为停留在续跑旧值,此断言红
    expect(cp!.completed.some((f) => f.text === probeName)).toBe(true);
    // 旧发现与跨轮已完成项不回退(producedAtIdx 增量语义:prior 原样保留)
    expect(cp!.completed.some((f) => f.finding.includes('早期发现'))).toBe(true);
    expect(cp!.completedTodos).toContain('第一轮已完成项');
    expect(cp!.producedAtIdx).toBeGreaterThanOrEqual(0);
    // 原收尾语义不变:主 try 的异常仍走 softComplete('failed')
    expect(after.status).toBe('failed');
  });

  it('补写自身也失败(DB 持续坏)→ fail-open:不抛、checkpoint 保旧值不回退、run 正常收尾', async () => {
    const probeName = 'final_ok_' + randomUUID().slice(0, 8);
    const run = await mkRunAtFinalRound(probeName);
    ctl.failCheckpointOnlyWrites = 99; // 收尾点 + 兜底补写全部失败

    await expect(executeRun(run.id)).resolves.toBeUndefined(); // 兜底不得反向炸掉收尾

    const after = (await store.getAgentRun(run.id))!;
    expect(after.status).toBe('failed'); // softComplete 仍正常走完
    // 补不上只能停留旧值,但绝不回退成 null/清空
    expect(after.contextCheckpoint).not.toBeNull();
    expect(
      after.contextCheckpoint!.completed.some((f) =>
        f.finding.includes('早期发现'),
      ),
    ).toBe(true);
  });
});
