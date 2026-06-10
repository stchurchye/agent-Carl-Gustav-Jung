/**
 * M3 Task 2：executor ask_user 暂停语义集成测试。
 *
 * 验证当 plan 包含 ask_user 步骤、且工具返回 { ok:true, paused:true } 时：
 *   - run.status 被切换到 'awaiting_user_input'
 *   - run.pendingUserPrompt 被设为问题文本
 *   - run.pendingUserStepIdx 被设为正确的步骤 index
 *   - executeRun 提前 return，不继续执行后续步骤
 */
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import { randomUUID } from 'crypto';

import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import { createUser, createChatSession } from '../../../store/pg.js';
import { hashPassword } from '../../auth.js';
import { createAgentRun, executeRun } from '../runtime.js';
import { getAgentRun, updateAgentRun, listSteps } from '../store.js';
import { registerAskUser } from '../tools/askUser.js';
import type { Plan } from '../types.js';

async function ensureUser(tag: string) {
  return createUser({
    username: `askuser-${tag}-${randomUUID().slice(0, 6)}`,
    passwordHash: await hashPassword('password'),
    displayName: `AskUser ${tag}`,
  });
}

describeDb('executor: ask_user pause semantics (M3 Task 2)', () => {
  beforeAll(async () => {
    await runMigrations();
    registerAskUser();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
    await getPool().query('DELETE FROM agent_runs');
  });

  it('ask_user returns paused:true → run.status = awaiting_user_input', async () => {

    const user = await ensureUser('pause');
    const session = await createChatSession(user.id, 'askuser-pause');

    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: '请帮我分析一下这个数据集',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    const question = '你想分析哪一年的数据？';
    const plan: Plan = {
      intentSummary: 'ask_user pause test',
      steps: [
        {
          toolName: 'ask_user',
          input: { question },
          reason: '任务范围不明，需澄清年份',
          todoId: 't1',
        },
      ],
      todos: [{ id: 't1', text: '澄清年份', status: 'pending', stepRefs: [] }],
      finalReplyHint: '等待用户回答',
      reasoning: null,
      version: 1,
    };
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });

    await executeRun(run.id);

    const finalRun = await getAgentRun(run.id);
    expect(finalRun?.status).toBe('awaiting_user_input');
    expect(finalRun?.pendingUserPrompt).toBe(question);
    expect(finalRun?.pendingUserStepIdx).toBe(0);
    // M4 Task 5：pendingUserInputExpiresAt 落库 = now() + 24h (±5s 容错)
    const expectedExpiresMs = Date.now() + 24 * 3600 * 1000;
    const actualExpiresMs = finalRun?.pendingUserInputExpiresAt?.getTime() ?? 0;
    expect(Math.abs(actualExpiresMs - expectedExpiresMs)).toBeLessThan(5000);
  });

  it('ask_user at step 1 → subsequent steps are not executed', async () => {

    const user = await ensureUser('noskip');
    const session = await createChatSession(user.id, 'askuser-noskip');

    // Register a never-called probe to verify step 2 never runs
    const probeTag = `never_called_${randomUUID().slice(0, 8)}`;
    let probeCalled = false;
    const { toolRegistry } = await import('../toolRegistry.js');
    if (!toolRegistry.get(probeTag)) {
      toolRegistry.register({
        name: probeTag,
        description: 'probe that should never run after ask_user pauses',
        inputSchema: { type: 'object', properties: {}, required: [] },
        approvalMode: 'auto',
        hasSideEffects: false,
        idempotent: true,
        async handler() {
          probeCalled = true;
          return { ok: true };
        },
      });
    }

    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: '二步测试：先问后干',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    const question = '你要用哪个数据源？';
    const plan: Plan = {
      intentSummary: 'ask_user then probe',
      steps: [
        {
          toolName: 'ask_user',
          input: { question },
          reason: '数据源不明',
          todoId: 't1',
        },
        {
          toolName: probeTag,
          input: {},
          reason: '后续步骤（不应执行）',
          todoId: 't2',
        },
      ],
      todos: [
        { id: 't1', text: '澄清数据源', status: 'pending', stepRefs: [] },
        { id: 't2', text: '执行分析', status: 'pending', stepRefs: [] },
      ],
      finalReplyHint: '...',
      reasoning: null,
      version: 1,
    };
    await updateAgentRun(run.id, { plan, todos: plan.todos, status: 'running' });

    await executeRun(run.id);

    expect(probeCalled).toBe(false);

    const finalRun = await getAgentRun(run.id);
    expect(finalRun?.status).toBe('awaiting_user_input');
    expect(finalRun?.pendingUserPrompt).toBe(question);
    expect(finalRun?.pendingUserStepIdx).toBe(0);

    // 只有 ask_user 的 tool_call step，没有 probeTag 的 step
    const steps = await listSteps(run.id);
    const probeStep = steps.find((s) => s.toolName === probeTag);
    expect(probeStep).toBeUndefined();
  });

  it('awaiting_user_input → executeRun early-exit (re-pickup guard)', async () => {

    const user = await ensureUser('guard');
    const session = await createChatSession(user.id, 'askuser-guard');

    const { run } = await createAgentRun({
      ownerId: user.id,
      channel: 'private',
      sessionId: session.id,
      inputText: 'guard test',
      apiKey: 'fake',
      apiKeySource: 'server',
    });

    // 直接把 run 设成 awaiting_user_input，验证 executeRun 不会再跑
    await updateAgentRun(run.id, {
      status: 'awaiting_user_input',
      pendingUserPrompt: '已在等待用户',
      pendingUserStepIdx: 0,
    });

    // 不应抛错，不应改变 status
    await executeRun(run.id);

    const guard = await getAgentRun(run.id);
    expect(guard?.status).toBe('awaiting_user_input');
    expect(guard?.pendingUserPrompt).toBe('已在等待用户');
  });
});
