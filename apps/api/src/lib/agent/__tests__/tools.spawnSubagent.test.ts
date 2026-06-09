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
});
