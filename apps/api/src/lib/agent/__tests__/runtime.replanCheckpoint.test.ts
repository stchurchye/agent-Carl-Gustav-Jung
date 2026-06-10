import { beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'crypto';

import { describeDb } from '../../../testUtils/dbGuard.js';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun } from '../runtime.js';
import { getAgentRun, insertStep, maxStepIdx, updateAgentRun } from '../store.js';
import { applyReplanningIfNeeded } from '../runExecuteHelpers.js';
import type { Plan } from '../types.js';

/**
 * P0-S5:所有 replan 重进路径(critique/steer/deny/merge/unknown_tool)统一在清 plan 前
 * 累积 checkpoint(机械版)。此前只有 continuation 在 loop 尾算 —— steer/deny/critique
 * 触发的首次 replan 读到 contextCheckpoint=null,planner 看不到早期发现 → 重复搜索。
 */

async function ensureUser(name: string) {
  return createUser({
    username: name + '-' + randomUUID().slice(0, 6),
    passwordHash: await hashPassword('xxxxxxxx'),
    displayName: name,
  });
}

function mkPlan(): Plan {
  return {
    intentSummary: '研究目标',
    steps: [
      { toolName: 'echo_after_sleep', input: { text: 'a' }, reason: 'r', todoId: 't1' },
      { toolName: 'echo_after_sleep', input: { text: 'b' }, reason: 'r', todoId: 't2' },
    ],
    todos: [
      { id: 't1', text: '第一步', status: 'completed', stepRefs: [] },
      { id: 't2', text: '第二步', status: 'pending', stepRefs: [] },
    ],
    finalReplyHint: '',
    reasoning: null,
    version: 1,
  };
}

async function mkReplanningRun() {
  const user = await ensureUser('cpset');
  const sess = await createChatSession(user.id, 'cpset');
  const { run } = await createAgentRun({
    ownerId: user.id,
    channel: 'private',
    sessionId: sess.id,
    inputText: '研究荣格阴影理论',
    apiKey: 'fake',
    apiKeySource: 'server',
  });
  const plan = mkPlan();
  await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'replanning' });
  // 一条成功的工具步:replan 前的"早期发现",必须进 checkpoint
  const idx = (await maxStepIdx(run.id)) + 1;
  await insertStep({
    runId: run.id,
    idx,
    kind: 'tool_call',
    toolName: 'echo_after_sleep',
    input: { text: 'a' },
    output: { result: { ok: true, echoed: '阴影即被压抑的自我面向' } },
  });
  return run;
}

describeDb('P0-S5:replan 统一写 checkpoint(applyReplanningIfNeeded 咽喉)', () => {
  beforeAll(async () => {
    await runMigrations();
    const { registerEchoSleep } = await import('../tools/echoSleep.js');
    registerEchoSleep();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('critique replan(无 steer/deny)→ contextCheckpoint 非空且含此前成功步发现', async () => {
    const run = await mkReplanningRun();
    const stale = (await getAgentRun(run.id))!;
    expect(stale.contextCheckpoint).toBeNull(); // 前置:此前为 null

    const updated = await applyReplanningIfNeeded(stale);

    expect(updated.plan).toBeNull(); // 原行为不变
    const cp = (await getAgentRun(run.id))!.contextCheckpoint;
    expect(cp).not.toBeNull();
    expect(cp!.completed.some((f) => f.text === 'echo_after_sleep')).toBe(true);
    expect(cp!.goal).toBe('研究荣格阴影理论');
  });

  it('steer replan → checkpoint 同样写入(改向不丢早期发现)', async () => {
    const run = await mkReplanningRun();
    const idx = (await maxStepIdx(run.id)) + 1;
    await insertStep({
      runId: run.id,
      idx,
      kind: 'steer',
      input: { instruction: '改讲共时性' },
    });
    const stale = (await getAgentRun(run.id))!;

    await applyReplanningIfNeeded(stale);

    const after = (await getAgentRun(run.id))!;
    expect(after.contextCheckpoint).not.toBeNull();
    expect(after.contextCheckpoint!.completed.length).toBeGreaterThan(0);
    // steer 分支原行为不变:replan step 已记 + plan 清空
    expect(after.plan).toBeNull();
  });

  it('steerRun 清 todos 前先累积 checkpoint → round1 已完成 todo 不丢(review #5)', async () => {
    const { steerRun } = await import('../steer.js');
    const run = await mkReplanningRun();
    // mkPlan 的 t1 已是 completed;steer 前 run.todos 含它
    await updateAgentRun(run.id, { status: 'running' });

    const res = await steerRun({ runId: run.id, byUserId: run.ownerId, instruction: '改讲共时性' });
    expect(res.accepted).toBe(true);

    const after = (await getAgentRun(run.id))!;
    expect(after.todos).toEqual([]); // steer 原行为:todos 已清
    expect(after.contextCheckpoint?.completedTodos).toContain('第一步'); // 但完成项已先进 checkpoint
  });

  it('已有 checkpoint 时按 producedAtIdx 增量累积,不重复折叠旧步', async () => {
    const run = await mkReplanningRun();
    const stale = (await getAgentRun(run.id))!;
    await applyReplanningIfNeeded(stale);
    const first = (await getAgentRun(run.id))!.contextCheckpoint!;
    const firstCount = first.completed.length;

    // 再次进入 replanning(无新步)→ checkpoint 不应重复累积同一发现
    await updateAgentRun(run.id, { status: 'replanning' });
    const stale2 = (await getAgentRun(run.id))!;
    await applyReplanningIfNeeded(stale2);
    const second = (await getAgentRun(run.id))!.contextCheckpoint!;
    expect(second.completed.length).toBe(firstCount);
  });
});
