import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R3-2:spawn_subagent tasks[](2-5)并行派多个研究员,lead 聚合报告+引用去重。
 * 「派 3 个研究员并行查、回来汇总」—— 决策①:并行在工具 handler 内,主循环零侵入。
 */

const calls: Array<{ task: string; enteredAt: number }> = [];
let maxConcurrent = 0;
let inFlight = 0;
let failTasks: string[] = [];

vi.mock('../spawnSubagent.js', () => ({
  runChildSubagent: vi.fn(async ({ task }: { task: string }) => {
    inFlight++;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
    calls.push({ task, enteredAt: Date.now() });
    await new Promise((r) => setTimeout(r, 20)); // 让并行窗口真实重叠
    inFlight--;
    if (failTasks.includes(task)) {
      return { ok: false, report: '', citations: [], stepsUsed: 1, childRunId: '', error: 'boom' };
    }
    return {
      ok: true,
      report: `关于「${task}」的报告`,
      citations: [
        { kind: 'url', id: `https://x.example/${task}` },
        { kind: 'url', id: 'https://shared.example/dup' }, // 跨子任务重复引用
      ],
      stepsUsed: 2,
      childRunId: `child-${task}`,
    };
  }),
}));

vi.mock('../store.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../store.js')>();
  return {
    ...orig,
    getAgentRun: vi.fn(async () => ({
      id: 'parent-1',
      parentRunId: null,
      channel: 'private',
      ownerId: 'u1',
      apiKeySource: 'server',
      providerId: null,
      modelId: null,
      groupId: null,
      topicId: null,
    })),
  };
});

const { spawnSubagentTool } = await import('../tools/spawnSubagentTool.js');
const ctx = { runId: 'parent-1', signal: new AbortController().signal } as never;

beforeEach(() => {
  calls.length = 0;
  maxConcurrent = 0;
  inFlight = 0;
  failTasks = [];
});

describe('R3-2:tasks[] 并行扇出', () => {
  it('3 个 task → 并行执行(并发≥2),childRunIds×3,报告分节,citations 去重', async () => {
    const out = (await spawnSubagentTool.handler(
      { tasks: ['历史脉络', '当代研究', '批评观点'], role: 'researcher' },
      ctx,
    )) as never as {
      ok: boolean; report: string; childRunIds?: string[]; childRunId: string;
      citations: Array<{ id: string }>; stepsUsed: number;
    };
    expect(out.ok).toBe(true);
    expect(maxConcurrent).toBeGreaterThanOrEqual(2); // 真并行,非串行 await
    expect(out.childRunIds).toHaveLength(3);
    expect(out.childRunId).toBe('child-历史脉络'); // 向后兼容字段
    expect(out.report).toContain('历史脉络');
    expect(out.report).toContain('当代研究');
    expect(out.report).toContain('批评观点');
    // 跨子任务重复引用去重:3 个独立 + 1 个 shared
    expect(out.citations.filter((c) => c.id === 'https://shared.example/dup')).toHaveLength(1);
    expect(out.citations).toHaveLength(4);
    expect(out.stepsUsed).toBe(6);
  });

  it('部分失败 → ok=true,失败 task 在报告中标注;全失败 → ok=false', async () => {
    failTasks = ['当代研究'];
    const partial = (await spawnSubagentTool.handler(
      { tasks: ['历史脉络', '当代研究'], role: 'researcher' },
      ctx,
    )) as never as { ok: boolean; report: string };
    expect(partial.ok).toBe(true);
    expect(partial.report).toMatch(/当代研究[\s\S]*?(失败|boom)/);

    failTasks = ['历史脉络', '当代研究'];
    const all = (await spawnSubagentTool.handler(
      { tasks: ['历史脉络', '当代研究'], role: 'researcher' },
      ctx,
    )) as never as { ok: boolean };
    expect(all.ok).toBe(false);
  });

  it('单 task 旧用法行为不变(无分节标题,childRunId 原样)', async () => {
    const out = (await spawnSubagentTool.handler(
      { task: '单一任务研究', role: 'researcher' },
      ctx,
    )) as never as { ok: boolean; report: string; childRunId: string };
    expect(out.ok).toBe(true);
    expect(out.report).toBe('关于「单一任务研究」的报告');
    expect(out.childRunId).toBe('child-单一任务研究');
  });

  it('task 与 tasks 都缺 → ok=false 带错误', async () => {
    const out = (await spawnSubagentTool.handler({ role: 'researcher' }, ctx)) as never as {
      ok: boolean; error?: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/task/);
  });
});
