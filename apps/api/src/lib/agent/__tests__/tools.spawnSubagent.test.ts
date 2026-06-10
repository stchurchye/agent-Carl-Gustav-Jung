import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSubagentTool, registerSpawnSubagent } from '../tools/spawnSubagentTool.js';
import { toolRegistry } from '../toolRegistry.js';

vi.mock('../store.js', async (importActual) => {
  const actual = await importActual<typeof import('../store.js')>();
  return {
    ...actual,
    getAgentRun: vi.fn(),
    listSteps: vi.fn(async () => []),
    copyLlmKeysFromParent: vi.fn(async () => {}),
  };
});

vi.mock('../runLifecycle.js', () => ({
  createAgentRun: vi.fn(),
  cancelRun: vi.fn(async () => {}),
}));

vi.mock('../childExecutor.js', () => ({
  dispatchChildRun: vi.fn(async () => {}),
}));

import * as store from '../store.js';
import { createAgentRun } from '../runLifecycle.js';
import { dispatchChildRun } from '../childExecutor.js';

const PARENT_RUN = {
  id: 'parent-1', ownerId: 'u', channel: 'private' as const, parentRunId: null,
  pendingUserPrompt: null, pendingUserStepIdx: null, status: 'running' as const,
  inputText: 'top level', plan: null, todos: [],
  budget: { maxSteps: 10, maxSeconds: 60, maxTokens: 10000 },
  usage: { steps: 0, elapsedSeconds: 0, tokens: 0, costCny: 0 },
  apiKeyOwnerId: null, apiKeySource: 'server' as const, providerId: 'deepseek' as const,
  modelId: 'deepseek-chat', sandboxId: null, userApiKeysEnc: {},
  resultMessageId: null, invokeMessageId: null, lastHeartbeatAt: null,
  awaitingApprovalUntil: null, awaitingApprovalStepIdx: null, pendingApprovalToolName: null,
  cancelledByUserId: null, cancelReason: null, createdAt: new Date(), startedAt: null, endedAt: null,
  sessionId: 'sess1', groupId: null, topicId: null, intentTurnId: null, role: 'generalist' as const,
  steerDirective: null, deniedTools: [], contextCheckpoint: null,
  mergedInputs: [], mergedInputsConsumedCount: 0, queuePosition: null,
  askUserTargetUserId: null, askUserStartedAt: null, askUserOpenedForAllAt: null,
  pendingUserInputExpiresAt: null, summary: null, artifact: null,
};
const CHILD_COMPLETED = { ...PARENT_RUN, id: 'child-1', parentRunId: 'parent-1', status: 'completed' as const, role: 'analyst' as const, usage: { steps: 4, elapsedSeconds: 5, tokens: 100, costCny: 0 } };
const fakeCtx = { runId: 'parent-1', stepId: 's', ownerId: 'u', channel: 'private' as const, signal: new AbortController().signal };

describe('spawn_subagent tool (M3-S1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers idempotently', () => {
    registerSpawnSubagent();
    registerSpawnSubagent();
    expect(toolRegistry.get('spawn_subagent')).toBeDefined();
  });

  it('invalid role → ok:false（不 spawn，列出合法 role）', async () => {
    const out = await spawnSubagentTool.handler({ task: 'do x', role: 'hacker' as never }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/invalid role/);
    expect(out.error).toMatch(/researcher/);
    expect(createAgentRun).not.toHaveBeenCalled();
  });

  it('防递归：父本身是子 run → ok:false /nested/', async () => {
    vi.mocked(store.getAgentRun).mockResolvedValueOnce({ ...PARENT_RUN, parentRunId: 'grandparent' });
    const out = await spawnSubagentTool.handler({ task: 'do x', role: 'researcher' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/nested/);
    expect(createAgentRun).not.toHaveBeenCalled();
  });

  it('happy path：analyst spawn → createAgentRun 带 role=analyst + 返回报告', async () => {
    vi.mocked(store.getAgentRun).mockResolvedValueOnce(PARENT_RUN).mockResolvedValueOnce(CHILD_COMPLETED);
    vi.mocked(createAgentRun).mockResolvedValueOnce({
      run: { ...CHILD_COMPLETED, status: 'running' as const }, userMessageId: null, placeholderMessageId: null, llmJobId: null,
    } as never);
    vi.mocked(store.listSteps).mockResolvedValueOnce([
      { id: 's1', runId: 'child-1', kind: 'reply', toolName: null, toolCallKey: null, input: null,
        output: { content: '## 分析报告\n图表已生成' }, idx: 0, tokens: 0, durationMs: null, error: null,
        status: 'succeeded', createdAt: new Date() } as never,
    ]);

    const out = await spawnSubagentTool.handler({ task: '算一下相关系数并画图', role: 'analyst' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.role).toBe('analyst');
    expect(out.report).toContain('分析报告');
    expect(out.citations).toEqual([]); // artifact:null(极端写失败)→ 引用退化为空,不抛
    expect(out.childRunId).toBe('child-1');
    // 关键：子 run 以 role=analyst 创建(决定其工具子集含 run_python/render_diagram)。
    const callArg = vi.mocked(createAgentRun).mock.calls[0]![0] as { role?: string };
    expect(callArg.role).toBe('analyst');
    expect(dispatchChildRun).toHaveBeenCalledWith('child-1');
  });

  it('parent run not found → ok:false', async () => {
    vi.mocked(store.getAgentRun).mockResolvedValueOnce(null);
    const out = await spawnSubagentTool.handler({ task: 'do x', role: 'researcher' }, fakeCtx);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not found/);
  });

  it('citations 来自子 run artifact.refs（step.output 无 ref 也能拿到）', async () => {
    const childWithArtifact = {
      ...CHILD_COMPLETED,
      artifact: {
        finalContent: '报告正文',
        refs: [
          { kind: 'url' as const, id: 'https://arxiv.org/abs/2304.1', label: 'Paper One (2023)' },
          { kind: 'url' as const, id: 'https://doi.org/10.1/x', label: 'Paper Two' },
        ],
        model: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        producedAt: new Date().toISOString(),
      },
    };
    vi.mocked(store.getAgentRun)
      .mockResolvedValueOnce(PARENT_RUN)
      .mockResolvedValueOnce(childWithArtifact);
    vi.mocked(createAgentRun).mockResolvedValueOnce({
      run: { ...childWithArtifact, status: 'running' as const }, userMessageId: null, placeholderMessageId: null, llmJobId: null,
    } as never);
    vi.mocked(store.listSteps).mockResolvedValueOnce([
      { id: 's1', runId: 'child-1', kind: 'reply', toolName: null, toolCallKey: null, input: null,
        output: { content: '报告正文', synthesized: true }, idx: 0, tokens: 0, durationMs: null, error: null,
        status: 'succeeded', createdAt: new Date() } as never,
    ]);

    const out = await spawnSubagentTool.handler({ task: '查文献', role: 'researcher' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.citations).toEqual([
      { kind: 'url', id: 'https://arxiv.org/abs/2304.1', label: 'Paper One (2023)' },
      { kind: 'url', id: 'https://doi.org/10.1/x', label: 'Paper Two' },
    ]);
  });

  it('citations 只回流 url 类——子 run 的 diagram/document 产物不冒充父交付物', async () => {
    const childMixedRefs = {
      ...CHILD_COMPLETED,
      artifact: {
        finalContent: '报告',
        refs: [
          { kind: 'diagram' as const, id: 'dg-1', label: '中间草图' },
          { kind: 'url' as const, id: 'https://a.com/p', label: 'Paper' },
          { kind: 'document' as const, id: 'doc-1', label: '子导出' },
        ],
        model: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        producedAt: new Date().toISOString(),
      },
    };
    vi.mocked(store.getAgentRun)
      .mockResolvedValueOnce(PARENT_RUN)
      .mockResolvedValueOnce(childMixedRefs);
    vi.mocked(createAgentRun).mockResolvedValueOnce({
      run: { ...childMixedRefs, status: 'running' as const }, userMessageId: null, placeholderMessageId: null, llmJobId: null,
    } as never);
    vi.mocked(store.listSteps).mockResolvedValueOnce([]);

    const out = await spawnSubagentTool.handler({ task: '查文献', role: 'researcher' }, fakeCtx);
    expect(out.citations).toEqual([{ kind: 'url', id: 'https://a.com/p', label: 'Paper' }]);
  });

  it('report 取自 artifact.finalContent 且子 run 的 [n] 引用标记被剥离（防父清单错误解引）', async () => {
    const childWithMarkers = {
      ...CHILD_COMPLETED,
      artifact: {
        finalContent: '损失厌恶系数约 2.25 [1]，后续研究有争议 [12]。',
        refs: [{ kind: 'url' as const, id: 'https://a.com/p', label: 'P' }],
        model: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        producedAt: new Date().toISOString(),
      },
    };
    vi.mocked(store.getAgentRun)
      .mockResolvedValueOnce(PARENT_RUN)
      .mockResolvedValueOnce(childWithMarkers);
    vi.mocked(createAgentRun).mockResolvedValueOnce({
      run: { ...childWithMarkers, status: 'running' as const }, userMessageId: null, placeholderMessageId: null, llmJobId: null,
    } as never);
    // artifact.finalContent 在手 → 不应再为取报告全量拉 steps
    vi.mocked(store.listSteps).mockResolvedValueOnce([]);

    const out = await spawnSubagentTool.handler({ task: '查文献', role: 'researcher' }, fakeCtx);
    expect(out.report).toBe('损失厌恶系数约 2.25，后续研究有争议。');
    expect(store.listSteps).not.toHaveBeenCalled();
  });

  it('子 run 引用超 10 条时截到 10（防洪）', async () => {
    const manyRefs = Array.from({ length: 14 }, (_, i) => ({
      kind: 'url' as const, id: `https://example.com/${i}`, label: `Ref ${i}`,
    }));
    const childWithManyRefs = {
      ...CHILD_COMPLETED,
      artifact: {
        finalContent: '报告', refs: manyRefs,
        model: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        producedAt: new Date().toISOString(),
      },
    };
    vi.mocked(store.getAgentRun)
      .mockResolvedValueOnce(PARENT_RUN)
      .mockResolvedValueOnce(childWithManyRefs);
    vi.mocked(createAgentRun).mockResolvedValueOnce({
      run: { ...childWithManyRefs, status: 'running' as const }, userMessageId: null, placeholderMessageId: null, llmJobId: null,
    } as never);
    vi.mocked(store.listSteps).mockResolvedValueOnce([]);

    const out = await spawnSubagentTool.handler({ task: '查文献', role: 'researcher' }, fakeCtx);
    expect(out.ok).toBe(true);
    expect(out.citations).toHaveLength(10);
    expect(out.citations[0]!.id).toBe('https://example.com/0');
  });
});
