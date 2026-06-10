import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeDb } from '../../../testUtils/dbGuard.js';
import { runMigrations } from '../../../db/migrate.js';
import { getPool } from '../../../db/client.js';
import * as store from '../store.js';
import { recordStep } from '../stepRecorder.js';
import { DEFAULT_BUDGET } from '../types.js';
import { ensureUser } from './_groupFixture.js';
import { recallStepTool } from '../tools/recallStep.js';
import type { ToolCtx, ToolDef } from '../toolRegistry.js';
import { buildCheckpoint } from '../checkpoint.js';
import { _buildPlannerUserPromptForTest } from '../planner.js';

/**
 * Fix 2：recall_step —— Claude-Code re-Read 同款。按 stepIdx 取回某步**原始结构化全文**
 * （解 {result} wrapper + 脱敏），让滚出近窗的旧步完整内容能被模型重新取回。
 */

function ctxFor(runId: string, ownerId: string): ToolCtx {
  return {
    runId,
    stepId: 'caller-step',
    ownerId,
    channel: 'private',
    signal: new AbortController().signal,
  };
}

async function freshRun(slug: string) {
  const u = await ensureUser(slug);
  const run = await store.insertAgentRun({
    ownerId: u.id,
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
  return { run, userId: u.id };
}

describeDb('recall_step tool', () => {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM agent_steps');
  });

  it('取回指定 idx 的完整原始内容：解 {result} wrapper + 脱敏', async () => {
    const { run, userId } = await freshRun('recall1');
    const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ';
    // tool_call 步落库形态：output = { result: <tool输出>, retried }
    const s = await recordStep({
      runId: run.id,
      kind: 'tool_call',
      toolName: 'fetch_url',
      output: { result: { ok: true, marker: 'RECALL_TARGET_CONTENT', apiKey: SECRET }, retried: false },
    });

    const out = (await recallStepTool.handler({ stepIdx: s.idx }, ctxFor(run.id, userId))) as {
      ok: boolean; found: boolean; content: string;
    };

    expect(out.ok).toBe(true);
    expect(out.found).toBe(true);
    expect(out.content).toContain('RECALL_TARGET_CONTENT'); // 原文取回
    expect(out.content).not.toContain(SECRET); // 脱敏（output 落库未脱敏，工具返回前刮）
    expect(out.content).toContain('[REDACTED');
    // 解了 wrapper：content 是内层 result，不是 {"result":...,"retried":...}
    expect(out.content.startsWith('{"result"')).toBe(false);
    expect(out.content).toContain('marker'); // 内层字段直接可见
  });

  it('越界 idx → found:false 且 ok:true（能进 digestTail 让模型知道无此步）', async () => {
    const { run, userId } = await freshRun('recall2');
    const out = (await recallStepTool.handler({ stepIdx: 999 }, ctxFor(run.id, userId))) as {
      ok: boolean; found: boolean;
    };
    expect(out.ok).toBe(true); // 不是失败，进 digestTail
    expect(out.found).toBe(false);
  });

  it('分页：大 output + offset 返回切片 + hasMore', async () => {
    const { run, userId } = await freshRun('recall3');
    const big = 'B'.repeat(8000);
    const s = await recordStep({
      runId: run.id,
      kind: 'tool_call',
      toolName: 'fetch_url',
      output: { result: { ok: true, content: big }, retried: false },
    });

    const page0 = (await recallStepTool.handler({ stepIdx: s.idx }, ctxFor(run.id, userId))) as {
      content: string; hasMore: boolean; offset: number; totalChars: number;
    };
    expect(page0.offset).toBe(0);
    expect(page0.content.length).toBeLessThanOrEqual(3000);
    expect(page0.hasMore).toBe(true); // 8000 字 > 3000 一页

    const page1 = (await recallStepTool.handler({ stepIdx: s.idx, offset: 3000 }, ctxFor(run.id, userId))) as {
      content: string; offset: number;
    };
    expect(page1.offset).toBe(3000);
    expect(page1.content.length).toBeGreaterThan(0);
    // 两页内容不同（确实在分页）
    expect(page1.content).not.toBe(page0.content);
  });

  it('只读当前 run（listSteps 按 runId 限定，不串其它 run）', async () => {
    const { run: runA, userId } = await freshRun('recall4');
    const sA = await recordStep({
      runId: runA.id, kind: 'tool_call', toolName: 'fetch_url',
      output: { result: { ok: true, marker: 'RUN_A_ONLY' }, retried: false },
    });
    // 另起一个 run B（同用户），其 idx 可能与 A 重叠，但 recall 限 runId 不应取到 A 的内容
    const runB = await store.insertAgentRun({
      ownerId: userId, channel: 'private', sessionId: null, groupId: null, topicId: null,
      intentTurnId: null, role: 'generalist', status: 'running', inputText: 'x',
      budget: DEFAULT_BUDGET, apiKeySource: 'server', apiKeyOwnerId: null,
    });
    const out = (await recallStepTool.handler({ stepIdx: sA.idx }, ctxFor(runB.id, userId))) as {
      found: boolean; content?: string;
    };
    // runB 没有这个 idx → found:false（绝不串到 runA 的 RUN_A_ONLY）
    expect(out.found).toBe(false);
  });

  it('offset 越界 → content 空但带 note 提示（不是无声空内容）', async () => {
    const { run, userId } = await freshRun('recalloob');
    const s = await recordStep({
      runId: run.id, kind: 'tool_call', toolName: 'fetch_url',
      output: { result: { ok: true, x: 'short' }, retried: false },
    });
    const out = (await recallStepTool.handler({ stepIdx: s.idx, offset: 99999 }, ctxFor(run.id, userId))) as {
      found: boolean; content: string; note?: string; totalChars: number;
    };
    expect(out.found).toBe(true);
    expect(out.content).toBe(''); // 越界没内容
    expect(out.note).toBeTruthy(); // 但有 note 说明越界了（模型不会误判"这步没数据"）
  });

  it('闭环：recall_step 输出 → digestTail → 真进下一轮 planner prompt（能用上）', async () => {
    const { run, userId } = await freshRun('recallloop');
    // 旧步（idx 0）含一段关键细节
    const old = await recordStep({
      runId: run.id, kind: 'tool_call', toolName: 'fetch_url',
      output: { result: { ok: true, detail: 'OLD_STEP_DETAIL_X' }, retried: false },
    });
    // 模型调 recall_step 取回它 → 结果作为一个 tool_call 步落库（模拟 runtime 记录工具调用）
    const recalled = await recallStepTool.handler({ stepIdx: old.idx }, ctxFor(run.id, userId));
    await recordStep({
      runId: run.id, kind: 'tool_call', toolName: 'recall_step',
      output: { result: recalled, retried: false },
    });
    // buildCheckpoint → digestTail 应含召回内容
    const steps = await store.listSteps(run.id);
    const cp = buildCheckpoint(null, steps, [], {
      goal: 'g', intent: 'i', successCount: 2, toolMap: new Map<string, ToolDef>(),
    });
    expect(cp.digestTail).toContain('OLD_STEP_DETAIL_X'); // 召回内容进了近窗
    // Fix 1：近窗经 renderCheckpointState 进 planner prompt
    const usr = _buildPlannerUserPromptForTest({
      inputText: 'x',
      snapshot: { systemPrompt: '', shortSummary: '' } as never,
      checkpoint: cp,
    });
    expect(usr).toContain('OLD_STEP_DETAIL_X'); // → 召回内容真到了 planner，闭环成立
  });
});
