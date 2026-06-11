import { beforeAll, beforeEach, expect } from 'vitest';
import { describeDb, itDb } from '../../../testUtils/dbGuard.js';
import { randomUUID } from 'crypto';

import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun, executeRun } from '../runtime.js';
import { getAgentRun, listSteps, updateAgentRun, applyMergeInTx } from '../store.js';
import { steerRun } from '../steer.js';
import { toolRegistry, type ToolDef } from '../toolRegistry.js';
import { agentHookBus } from '../hooks.js';
import type { AgentHookEvent } from '../hooks.js';
import type { Plan } from '../types.js';

/**
 * Review 2026-06-11 [P1][agent-runtime] runExecute.ts:467 / :254
 * steer 与执行循环的两个竞态:
 *  1. 工具重试二连败 → recordStep(tool_error) await 期间 steer 落地
 *     (status='replanning' + abort)。旧版直接 throw err2 → 外层 catch 走
 *     softComplete('failed'),把 steer 设好的 replanning 覆盖成 failed,
 *     用户的改向指令被静默丢弃。
 *  2. merge_trigger 检测后、status 写入前 steer 落地。旧版无视 steer 再写一次
 *     status='replanning' 并 emit 重复 run.status_changed 事件(审计污染)。
 */

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

function onePlanStep(toolName: string): Plan {
  return {
    intentSummary: 'race probe',
    steps: [
      { toolName, input: { q: 'a' }, reason: 'p1', todoId: 't1' },
      { toolName, input: { q: 'b' }, reason: 'p2', todoId: 't2' },
    ],
    todos: [
      { id: 't1', text: 'p1', status: 'pending', stepRefs: [] },
      { id: 't2', text: 'p2', status: 'pending', stepRefs: [] },
    ],
    finalReplyHint: 'done',
    reasoning: null,
    version: 1,
  };
}

describeDb('runExecute × steer 竞态', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  itDb('工具重试二连败期间 steer 落地 → run 保持 replanning,不被打成 failed', async () => {
    const user = await ensureUser('race1');
    const sess = await createChatSession(user.id, 'race1');
    const toolName = 'hard_fail_steer_' + randomUUID().slice(0, 6);
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'steer race probe',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    let calls = 0;
    const probe: ToolDef<{ q: string }, { ok: boolean }> = {
      name: toolName,
      description: 'hard-fails twice; steers during 2nd failure',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: false,
      async handler() {
        calls += 1;
        if (calls === 2) {
          // 第二次(重试)失败前 steer 落地:status→replanning + abort 信号
          await steerRun({ runId: run.id, byUserId: user.id, instruction: '换个方向' });
        }
        throw new Error(`simulated hard fail #${calls}`);
      },
    };
    toolRegistry.register(probe);

    const plan = onePlanStep(toolName);
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });

    await executeRun(run.id);

    const cur = (await getAgentRun(run.id))!;
    // 旧版:err2 直接抛 → softComplete('failed') 覆盖 replanning,steer 被吞
    expect(cur.status).toBe('replanning');
    const steps = await listSteps(run.id);
    expect(steps.some((s) => s.kind === 'steer')).toBe(true);
    expect(steps.some((s) => s.kind === 'system_error')).toBe(false);
    // tool_error 审计仍在(重试失败本身要可见)
    expect(steps.some((s) => s.kind === 'tool_error')).toBe(true);
  });

  itDb('merge_trigger 与 steer 同时落地 → 不重复写 status/不重复发 status_changed', async () => {
    const user = await ensureUser('race2');
    const sess = await createChatSession(user.id, 'race2');
    const toolName = 'merge_steer_' + randomUUID().slice(0, 6);
    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: sess.id,
      inputText: 'merge race probe',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    const probe: ToolDef<{ q: string }, { ok: boolean }> = {
      name: toolName,
      description: 'step1 注入追问 + steer,随后循环顶部撞 merge 检查',
      inputSchema: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
      approvalMode: 'auto',
      hasSideEffects: false,
      idempotent: false,
      async handler() {
        await applyMergeInTx(run.id, {
          text: '补充一个要求',
          byUserId: user.id,
          byUsername: 'u',
          at: new Date().toISOString(),
        });
        await steerRun({ runId: run.id, byUserId: user.id, instruction: '换方向' });
        return { ok: true };
      },
    };
    toolRegistry.register(probe);

    const plan = onePlanStep(toolName);
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });

    const replanningEvents: AgentHookEvent[] = [];
    const off = agentHookBus.onEvent((e) => {
      if (e.type === 'run.status_changed' && e.to === 'replanning' && e.run.id === run.id) {
        replanningEvents.push(e);
      }
    });
    try {
      await executeRun(run.id);
    } finally {
      off();
    }

    const cur = (await getAgentRun(run.id))!;
    expect(cur.status).toBe('replanning');
    // 追问仍被标记消化(不会下次 pickup 再触发一轮幻影 merge replan)
    expect(cur.mergedInputsConsumedCount).toBe(1);
    // steer 指令持久化保留
    expect(cur.steerDirective).toBe('换方向');
    // steer 已把 status 置为 replanning(steerRun 不发事件);merge 路径不该
    // 在状态未变的情况下再发一条假的 running→replanning 事件(旧版会发)
    expect(replanningEvents.length).toBe(0);
  });
});
