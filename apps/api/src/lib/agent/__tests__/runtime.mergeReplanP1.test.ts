/**
 * M7 TB13：P1 追问消化 → 触发 replan 测试。
 *
 * 流程：
 *   1. 创建一个 group run，写 1 步 echo plan
 *   2. 在第 0 步执行之前，往 merged_inputs append 一条追问
 *   3. executeRun → 第 0 步前检测到未消化 → record replan(reason='merge_trigger')
 *      → status='replanning' → return
 *   4. 校验 agent_runs.inputText 未被修改（关键 ADR-M7-13）
 *   5. 校验 agent_steps 含 1 条 replan(reason='merge_trigger')
 */
import { it, expect, beforeEach } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import * as store from '../store.js';
import { createAgentRun, executeRun } from '../runtime.js';
import { applyMergeInTx } from '../store.js';
import { ensureUser, ensureGroup } from './_groupFixture.js';

describeDb('P1 merged_input triggers replan (M7 TB13)', () => {
  let owner: { id: string };
  let groupId: string;
  let topicId: string;

  beforeEach(async () => {
    owner = await ensureUser('m7-p1');
    const g = await ensureGroup(owner.id, 'p1-' + Math.random());
    groupId = g.groupId;
    topicId = g.topicId;
  });

  it('records replan(reason=merge_trigger) and switches to replanning; inputText untouched', async () => {
    const r = await createAgentRun({
      ownerId: owner.id,
      channel: 'group',
      groupId, topicId,
      inputText: 'echo 三步', // 用 echo 关键词跳过 LLM planner（test env）
      apiKey: '',
      apiKeySource: 'server',
    });
    const runId = r.run.id;
    const originalInput = r.run.inputText;

    // 模拟追问：append 1 条 merged_input
    await applyMergeInTx(runId, {
      text: '能不能再加一句',
      byUserId: owner.id,
      byUsername: 'tester',
      at: new Date().toISOString(),
    });

    await executeRun(runId);

    const after = (await store.getAgentRun(runId))!;
    // 关键：inputText 未被改写（ADR-M7-13）
    expect(after.inputText).toBe(originalInput);
    expect(after.status).toBe('replanning');
    expect(after.mergedInputsConsumedCount).toBe(1);

    const steps = await store.listSteps(runId);
    const replan = steps.find((s) => s.kind === 'replan');
    expect(replan).toBeDefined();
    expect((replan!.output as { reason: string }).reason).toBe('merge_trigger');
  });
});
